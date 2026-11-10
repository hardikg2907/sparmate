import { randomBytes } from "node:crypto";
import { unwatchFile, watch, watchFile, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { z } from "zod";
import { deriveChecklist } from "../../shared/checklist";
import { gapDividerText, gapForTeachMessage } from "../../shared/gaps";
import { frameEvidence, pinTargets, pinTargetsText, stepFrames, withFrameMembership } from "../../shared/graph/frames";
import { graphToText, sceneToGraph } from "../../shared/graph/sceneToGraph";
import { lintProse } from "../../shared/lint";
import { isPhaseOf, phasePlan, phasesFor, type PhaseDef } from "../../shared/phases";
import type { Problem } from "../../shared/problem";
import { LIMITS, type ClientMsg, type ServerMsg } from "../../shared/protocol";
import { checkQuotes, checkStepQuotes } from "../../shared/quotes";
import { MAX_STEP_LINES, codeScopeFor, newLines, stepCodeText, unnumberedCode, withStepLines } from "../../shared/stepCode";
import { evidenceStepFor } from "../../shared/stepFrames";
import {
  ScorecardSchema,
  ScribeOutputSchema,
  type BoardPin,
  type Channel,
  type CompileDiagnostic,
  type PublicSession,
  type RunResult,
  type Scorecard,
  type Session,
  type SessionStatus,
  type GapProgress,
  type GapPractice,
  type GapRoundSource,
  type TranscriptEntry,
} from "../../shared/types";
import { applyGapPractice, practisesGap } from "./gap-practice";
import type { PrivacyGuard } from "../guard/privacy";
import type { CppRunner } from "../runner/cpp";
import { applyProposal, planProposal } from "../study/bookkeeping";
import { atomicWrite, resolveInside } from "../study/files";
import { CheckerOutputSchema, checkerMessage, evidenceKey, mergeCheck, stepReadingText, type CheckerEvidence } from "./checker";
import {
  CheckpointScheduler,
  formatClock,
  phaseOverCheckpoint,
  phaseWindows,
  planCheckpoints,
  roundTimeMs,
  SILENCE_GAP_MS,
  SILENCE_SETTLE_MS,
  SILENCE_WINDOW_MS,
  silenceCheckpoint,
  type Checkpoint,
} from "./clock";
import type { ServerConfig } from "./config";
import {
  candidateLines,
  candidateText,
  enforceRules,
  failedQuoteNote,
  failedRatio,
  judgeMessage,
  lintCard,
  phaseTiming,
  stepSources,
  tidyTesterOutput,
  type JudgeInput,
  type JudgedCard,
  type QuoteCheck,
  type StepQuoteCheck,
} from "./debrief";
import {
  DriverError,
  defineTool,
  textOutput,
  type Conversation,
  type ConversationSetup,
  type Driver,
  type RoleName,
  type RoomTool,
  type ToolOutput,
  type UserTurn,
} from "./driver";
import {
  SilentFilter,
  candidateEnvelope,
  checkSummaryText,
  clockTurn,
  countLines,
  diagnosticsText,
  numberedCode,
  parseStamp,
  replayTurn,
  requestTurn,
  roundTranscript,
  runResultText,
  runSummary,
  startTurn,
  stepEntries,
  stepNotesText,
  summarizeDiagnostics,
  transcriptLines,
  type ContextView,
  type RunView,
  type TimeView,
} from "./envelope";
import { decodePng, localDate, randomId, sha256Hex } from "./fsutil";
import { describeError, type Logger } from "./log";
import { validatePin, withPin } from "./pins";
import { computeReadiness } from "./readiness";
import {
  checksCountOnly,
  emptyStepRefusalText,
  NAMED_CHECKS,
  openCountPhrase,
  openCountText,
  parseStepVerdict,
  passCheck,
  passNeed,
  passRefusalText,
  recordStepVerdict,
  stepStatusLine,
  StepVerdictShape,
} from "./step-verdict";
import { PromptError, commonVars, extensionMinute, focusText, formatPhasePlan, type PromptLoader, type PromptName } from "./prompts";
import { toPublicSession } from "./public";
import { TesterOutputSchema, toApiSchema, toCompatSchema, type TesterOutput } from "./schemas";
import { buildScribeInput } from "./scribe";
import type { SettingsStore } from "./settings";
import { scorecardWithCurrentPlan, type SessionStore } from "./store";

export const ATTEMPT_PATH = /^lld\/[a-z0-9][a-z0-9-]*\/attempt-\d{4}-\d{2}-\d{2}(?:-\d+)?\.cpp$/;

/** A live round with no open socket for this long is paused, so an abandoned room costs no model calls. */
export const AWAY_PAUSE_MS = 60_000;
const PNG_TIMEOUT_MS = 15_000;
const CHECK_DEBOUNCE_MS = 1_500;
const WATCH_DEBOUNCE_MS = 120;
const MAX_EXTERNAL_CODE_BYTES = 1_000_000;
const MAX_HARNESS_RUNS = 4;
const MAX_BOARD_LOOKS_PER_TURN = 3;
/** Each re-read is a model call, so one guide reply cannot loop on it. */
const MAX_RECHECKS_PER_TURN = 3;
const RECHECK_WAIT_MS = 60_000;
/** The guide's step feedback waits this long for the checker, then goes ahead with the last finished reading. */
const FEEDBACK_WAIT_MS = 30_000;
/** The page flushes unsaved edits when it sees time run out, so they may land just after the round has ended. */
const LATE_EDIT_GRACE_MS = 2_000;

interface StepCheckRun {
  /** Settles once the running check, and any follow-up folded into it, has finished. Null while none runs. */
  settled: Promise<void> | null;
  /** A trigger arrived while a check ran; one more check follows with the newest evidence. */
  again: boolean;
  againWithImage: boolean;
  againFresh: boolean;
  /** Evidence fingerprint of the last finished check, and of the last one that saw the frame image. */
  lastKey: string | null;
  imageKey: string | null;
  /** Counts finished re-reads, so a caller can tell whether the one it asked for completed. */
  freshDone: number;
  /** Counts every finished reading, so a caller can tell whether one finished while it waited. */
  done: number;
}

/** Resolves true when `p` settles within `ms`, false after `ms`; it never rejects. */
/** The hidden note that records a move-on offer, which also tells a restarted round the step was already offered. */
function phaseOverLabel(phase: string): string {
  return `clock: twice the planned time in phase "${phase}"`;
}

/** The hidden note a clock turn leaves in the transcript. */
function clockLabel(cp: Checkpoint): string {
  switch (cp.kind) {
    case "phase_end":
      return `clock: planned end of phase "${cp.phase}"`;
    case "phase_over":
      return phaseOverLabel(cp.phase ?? "");
    case "extension":
      return "clock: extension point";
    case "five_minutes":
      return "clock: five minutes left";
    case "time_up":
      return "clock: time up";
    case "silence":
      return "clock: candidate quiet";
    case "overtime":
      return "clock: planned length reached";
  }
}

function settleWithin(p: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    timer.unref?.();
    const done = () => {
      clearTimeout(timer);
      resolve(true);
    };
    p.then(done, done);
  });
}

export interface Peer {
  readonly id: string;
  send(msg: ServerMsg): void;
  close(): void;
}

export interface RuntimeDeps {
  config: ServerConfig;
  store: SessionStore;
  settings: SettingsStore;
  driver: Driver;
  guard: PrivacyGuard;
  runner: CppRunner;
  prompts: PromptLoader;
  log: Logger;
  /** Sets (or, with null, clears) the practised mark of a gap round's source gap. */
  gapPractice?: (source: GapRoundSource, mark: GapPractice | null, roundId: string) => Promise<void> | void;
}

/** A failure caused by what the user asked for; the message is shown as is. */
export class UserError extends Error {
  override name = "UserError";
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface BuiltTurn {
  turn: UserTurn;
  /** Marks the context as seen; runs only once the model has answered. */
  commit(): void;
}

interface QueuedTurn {
  kind: "start" | "candidate" | "clock" | "request" | "replay";
  /** The channel waits on this before building the turn, holding its place in the queue. It must never reject. */
  ready?: Promise<unknown>;
  /** Built when the turn is sent, so it carries the context of that moment. Null skips the turn. */
  build(): BuiltTurn | null;
  after?(storedText: string): Promise<void> | void;
  /** For a clock turn: the checkpoint it answers. */
  checkpoint?: Checkpoint["kind"];
}

interface ChannelState {
  name: Channel;
  conv: Conversation | null;
  queue: QueuedTurn[];
  busy: boolean;
  status: "idle" | "thinking" | "error";
  error: string | null;
  /** The current conversation was resumed from the SDK session and has not answered yet. */
  freshResume: boolean;
  /** The next conversation starts fresh, with the transcript replayed as its first message. */
  replayNext: boolean;
  closed: boolean;
  boardSeen: number;
  notesSeen: number;
  codeSeen: number;
}

function newChannel(name: Channel): ChannelState {
  return {
    name,
    conv: null,
    queue: [],
    busy: false,
    status: "idle",
    error: null,
    freshResume: false,
    replayNext: false,
    closed: false,
    boardSeen: -1,
    notesSeen: -1,
    codeSeen: -1,
  };
}

/**
 * A chat channel shows its error beside a prompt to try again, so the bare "Retry." that ends a driver message would
 * read as part of the sentence. Other advice in the message stays.
 */
export function channelErrorText(message: string): string {
  const text = message
    .replace(/,\s*then retry\.\s*$/, ".")
    .replace(/\bRetry in a moment\.\s*$/, "Wait a moment.")
    .replace(/\s*\bRetry\.\s*$/, "")
    .trim();
  return text || message;
}

function newEntryId(): string {
  return `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

type DebriefStage = Extract<ServerMsg, { type: "debrief.progress" }>["stage"];

export class SessionRuntime {
  private readonly peers = new Set<Peer>();
  private readonly interview = newChannel("interview");
  private readonly coach = newChannel("coach");
  private readonly phases: readonly PhaseDef[];
  private readonly plan: { id: string; label: string; minutes: number }[];
  private scheduler: CheckpointScheduler | null = null;
  /** The list the scheduler reads. A guided round swaps its one move-on offer in and out as he changes step. */
  private checkpoints: Checkpoint[] = [];
  private firedCheckpoints = new Set<string>();
  private readonly checkRuns = new Map<string, StepCheckRun>();
  /** The latest scene, kept so the checker and the pin tools read the board as it is now. */
  private boardElements: Record<string, unknown>[] = [];
  private readonly pngWaits = new Map<string, { remaining: number; finish: (png: Buffer | null) => void }>();
  private pendingRun: RunView | null = null;
  private lastCandidateAt: number | null = null;
  /** Round time of his last sign of work: chat, a board, code or notes edit, a run, a button, a step move, a resume. */
  private activeAt = 0;
  /** Round time of the interviewer's last shown line. */
  private spokeAt = 0;
  /** The start of the quiet stretch that already had its check-in. */
  private silenceSpentFor: number | null = null;
  private endRequested = false;
  private boardLooksThisTurn = 0;
  private rechecksThisTurn = 0;
  /** True while the guide answers "I'm stuck": a model answer never earns a pass, whatever the guide says. */
  private passBarredThisTurn = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private boardWrites: Promise<void> = Promise.resolve();
  /** Wall time until which board and code edits still count after time ran out; null when none may land. */
  private lateEditsUntil: number | null = null;
  private debriefRunning = false;
  private lastProgress: Extract<ServerMsg, { type: "debrief.progress" }> | null = null;
  private drafting = false;
  private applying: Promise<void> = Promise.resolve();
  private disposed = false;
  private discarded = false;
  private awayTimer: ReturnType<typeof setTimeout> | null = null;
  private coachAwayTimer: ReturnType<typeof setTimeout> | null = null;
  /** The away timer fired while the interviewer was mid-reply; the pause waits for the reply to end. */
  private awayPending = false;
  private readonly warned = new Set<string>();
  lastActivity = Date.now();

  private codeAbs: string | null = null;
  private codeContent = "";
  private codeHash: string | null = null;
  private readonly ownHashes: string[] = [];
  private codeWrites: Promise<void> = Promise.resolve();
  private watcher: FSWatcher | null = null;
  private watchTimer: ReturnType<typeof setTimeout> | null = null;
  private checkTimer: ReturnType<typeof setTimeout> | null = null;
  private checkRunning = false;
  private checkAgain = false;
  private lastCheck: { version: number; diagnostics: CompileDiagnostic[] } | null = null;
  private programRunning = false;

  constructor(
    private readonly deps: RuntimeDeps,
    readonly session: Session,
    readonly problem: Problem,
  ) {
    this.phases = phasesFor(session.track);
    this.plan = phasePlan(session.track, this.durationMin);
    this.lastCandidateAt = [...session.transcript].reverse().find((e) => e.channel === "interview" && e.role === "candidate")?.at ?? null;
  }

  private get durationMin(): number {
    return Math.round(this.session.durationMs / 60_000);
  }

  private get log(): Logger {
    return this.deps.log;
  }

  async init(): Promise<void> {
    const s = this.session;
    // A mark lost to a failed write or a stop between two saves is written again; the write does nothing when held.
    const source = s.focus?.source;
    if (source && practisesGap(s)) void this.deps.gapPractice?.(source, { sessionId: s.id, at: new Date().toISOString() }, s.id);
    this.boardElements = (await this.deps.store.readBoard(s.id)).elements;
    if (Object.keys(s.checklist).length === 0 && (s.status === "live" || s.status === "paused")) {
      s.checklist = deriveChecklist(s.track, this.problem.sections);
    }
    if (s.track === "lld" && s.code) {
      if (!ATTEMPT_PATH.test(s.code.path)) throw new Error("The session has an unexpected attempt file path");
      try {
        this.codeAbs = await resolveInside(this.deps.config.studyRoot, s.code.path);
        this.codeContent = await readFile(this.codeAbs, "utf8");
        this.codeHash = sha256Hex(this.codeContent);
      } catch (err) {
        this.log.warn(`Attempt file for session ${s.id} is unavailable`, err);
      }
    }
    if (s.stepCode === undefined) {
      // A round saved before step code was kept: the method writes the clarify answer at the top of the file before
      // any other code, so the first step gets the whole file.
      const first = this.phases[0]?.id;
      const open = s.status === "live" || s.status === "paused";
      s.stepCode = s.track === "lld" && open && first ? { [first]: newLines("", this.codeContent).slice(0, MAX_STEP_LINES) } : {};
      if (open) this.saveSoon();
    }
    this.checkpoints = planCheckpoints(s.track, s.mode, s.durationMs, this.plan);
    this.firedCheckpoints = CheckpointScheduler.restoreFired(this.checkpoints, this.roundNow(), s.extension !== null);
    // The planned-length line leaves a hidden note when it is spoken, so a line a restart cut off still comes.
    if (!s.transcript.some((e) => e.kind === "clock" && e.text === clockLabel({ id: "overtime", kind: "overtime", atMs: 0 }))) {
      this.firedCheckpoints.delete("overtime");
    }
    this.scheduler = new CheckpointScheduler({
      checkpoints: this.checkpoints,
      fired: this.firedCheckpoints,
      roundTime: () => this.roundNow(),
      running: () => this.session.status === "live" && !this.disposed,
      onDue: (cp) => this.onCheckpoint(cp),
    });
    // What he did before a restart is not all saved, so the quiet window starts again from here.
    this.activeAt = this.roundNow();
    this.spokeAt = [...s.transcript].reverse().find((e) => e.channel === "interview" && e.role === "interviewer" && !e.hidden)?.at ?? 0;
    if (s.status === "live" || s.status === "paused") {
      this.startWatcher();
      // A round that stopped before its opening reply still owes him the opening, ahead of anything he said.
      if (!s.transcript.some((e) => e.channel === "interview" && e.role === "interviewer")) this.interview.queue.push(this.openingTurn());
      const last = [...s.transcript].reverse().find((e) => e.channel === "interview" && e.role !== "system");
      if (last?.role === "candidate") this.interview.queue.push(this.candidateTurn(last.text));
      if (s.status === "paused" && s.pauseReason === "error") {
        this.interview.status = "error";
        this.interview.error = "The interviewer could not answer. Press Retry to continue.";
      }
      this.armPhaseOver();
      this.armSilence();
      this.scheduler.reschedule();
      this.syncAwayTimer();
    }
    this.syncCoachAwayTimer();
  }

  /** First start of a brand-new round: the interviewer opens it. `init` has already queued the opening. */
  start(): void {
    if (!this.interview.queue.some((t) => t.kind === "start")) this.interview.queue.push(this.openingTurn());
    void this.pump(this.interview);
  }

  private openingTurn(): QueuedTurn {
    return {
      kind: "start",
      build: () => {
        const { view, commit } = this.interviewContext(this.interview);
        return { turn: { text: startTurn(view), meta: { kind: "start" } }, commit };
      },
    };
  }

  attach(peer: Peer): void {
    if (this.discarded) {
      peer.send({ type: "session.discarded" });
      peer.close();
      return;
    }
    this.peers.add(peer);
    this.lastActivity = Date.now();
    this.syncAwayTimer();
    this.syncCoachAwayTimer();
    peer.send({ type: "session.state", session: this.publicSession() });
    for (const ch of [this.interview, this.coach]) {
      if (ch.status !== "idle") peer.send({ type: "agent.status", channel: ch.name, state: ch.status, ...(ch.error ? { error: ch.error } : {}) });
    }
    if (this.session.status === "debriefing" && this.lastProgress) peer.send(this.lastProgress);
    // A check-in that fell while the room was empty was dropped, so one that is now overdue comes back shortly.
    if (this.session.status === "live" && !this.disposed) this.armSilence();
  }

  detach(peer: Peer): void {
    this.peers.delete(peer);
    this.lastActivity = Date.now();
    this.syncAwayTimer();
    this.syncCoachAwayTimer();
  }

  /** Arms the away timer while a live round has no socket, and disarms it as soon as that stops being true. */
  private syncAwayTimer(): void {
    const away = !this.disposed && this.peers.size === 0 && this.session.status === "live";
    if (!away) {
      if (this.awayTimer) clearTimeout(this.awayTimer);
      this.awayTimer = null;
      this.awayPending = false;
      return;
    }
    if (this.awayTimer || this.awayPending) return;
    this.awayTimer = setTimeout(() => this.onAwayTimer(), this.deps.config.awayPauseMs ?? AWAY_PAUSE_MS);
    this.awayTimer.unref?.();
  }

  private onAwayTimer(): void {
    this.awayTimer = null;
    if (this.peers.size > 0 || this.session.status !== "live" || this.disposed) return;
    if (this.interview.busy) {
      this.awayPending = true;
      return;
    }
    void this.pauseRound("away");
  }

  /** Arms a timer while a debrief has no socket, closing the idle coach process once the room stays empty. */
  private syncCoachAwayTimer(): void {
    const away = !this.disposed && this.peers.size === 0 && this.session.status === "debriefed";
    if (!away) {
      if (this.coachAwayTimer) clearTimeout(this.coachAwayTimer);
      this.coachAwayTimer = null;
      return;
    }
    if (this.coachAwayTimer) return;
    this.coachAwayTimer = setTimeout(() => this.onCoachAwayTimer(), this.deps.config.awayPauseMs ?? AWAY_PAUSE_MS);
    this.coachAwayTimer.unref?.();
  }

  private onCoachAwayTimer(): void {
    this.coachAwayTimer = null;
    if (this.peers.size > 0 || this.session.status !== "debriefed" || this.disposed) return;
    if (this.coach.busy) return;
    this.coach.conv?.close();
    this.coach.conv = null;
  }

  /** Called when a turn ends: the reply that was streaming when the room emptied is complete, so the pause can go ahead. */
  private settleAwayPause(): void {
    if (!this.awayPending) return;
    this.awayPending = false;
    if (this.peers.size === 0 && this.session.status === "live" && !this.disposed) void this.pauseRound("away");
  }

  get peerCount(): number {
    return this.peers.size;
  }

  /** Hidden notes for the interviewer's next turn. They live on the session so a restart keeps them. */
  private pending(): string[] {
    return (this.session.pendingEvents ??= []);
  }

  /** True when nothing is running and nobody is watching, so the runtime can be dropped from memory. */
  isDormant(): boolean {
    const s = this.session.status;
    // A paused round's hidden notes and queued requests for the interviewer live only here, so dropping it loses them.
    const owesInterviewer = s === "paused" && (this.interview.queue.length > 0 || this.pending().length > 0);
    return (
      this.peers.size === 0 &&
      s !== "live" &&
      s !== "debriefing" &&
      !owesInterviewer &&
      !this.debriefRunning &&
      !this.drafting &&
      !this.interview.busy &&
      !this.coach.busy &&
      this.coach.queue.length === 0
    );
  }

  dispose(): void {
    this.stop(true);
  }

  /**
   * Stops the round's agents, clock and file watcher for good and waits for writes already under way. It never
   * saves: the caller is about to delete the session's files.
   */
  async discard(): Promise<void> {
    this.discarded = true;
    this.stop(false);
    await Promise.allSettled([this.codeWrites, this.boardWrites]);
  }

  /** Tells every open socket the round is gone and closes it. */
  announceDiscard(): void {
    const peers = [...this.peers];
    this.peers.clear();
    for (const peer of peers) {
      peer.send({ type: "session.discarded" });
      peer.close();
    }
  }

  private stop(save: boolean): void {
    this.disposed = true;
    this.closeChannel(this.interview);
    this.closeChannel(this.coach);
    this.scheduler?.stop();
    this.stopWatcher();
    this.syncAwayTimer();
    this.syncCoachAwayTimer();
    if (this.checkTimer) clearTimeout(this.checkTimer);
    this.checkTimer = null;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      if (save) void this.saveNow();
    }
    for (const wait of [...this.pngWaits.values()]) wait.finish(null);
  }

  publicSession(): PublicSession {
    return toPublicSession(this.session, this.problem);
  }

  /** The code the browser should show: the live file during the round, the frozen copy the judge saw after it. */
  async codeSnapshot(): Promise<{ version: number; content: string; path: string } | null> {
    const code = this.session.code;
    if (!code || !this.codeAbs) return null;
    const after = this.session.status === "debriefing" || this.session.status === "debriefed" || this.session.status === "failed";
    const frozen = after ? await this.deps.store.readFinalCode(this.session.id) : null;
    return { version: code.version, content: frozen ?? this.codeContent, path: this.codeAbs };
  }

  async handle(msg: ClientMsg, peer: Peer): Promise<void> {
    if (this.discarded) return;
    this.lastActivity = Date.now();
    try {
      switch (msg.type) {
        case "hello":
          return;
        case "chat.send":
          return this.onChat(msg.channel, msg.text, msg.clientMsgId);
        case "board.update":
          return await this.onBoardUpdate(msg.version, msg.elements);
        case "notes.update":
          return this.onNotesUpdate(msg.phase, msg.text, msg.version, peer);
        case "board.png.result":
          return this.onPngResult(msg.requestId, msg.pngBase64);
        case "code.update":
          return await this.onCodeUpdate(msg.version, msg.content, peer);
        case "chat.composing":
          if (this.session.status === "live") this.markActive();
          return;
        case "code.run":
          await this.onCodeRun();
          return;
        case "phase.set":
          return this.onPhaseSet(msg.phase);
        case "guided.feedback":
          return this.onGuided("feedback");
        case "guided.hint":
          return this.onGuided("hint");
        case "guided.stuck":
          return this.onGuided("stuck");
        case "session.pause":
          return await this.onPause();
        case "session.resume":
          return await this.onResume();
        case "session.discard":
          // The manager owns it, because it also deletes the session's files and drops this runtime.
          return;
        case "session.end":
          return await this.onEnd();
        case "debrief.retry":
          return await this.onDebriefRetry();
        case "coach.open":
          return this.onCoachOpen();
        case "bookkeeping.draft":
          return await this.onDraft();
        case "bookkeeping.apply":
          return await this.onApply(msg.proposalId, msg.opIds);
      }
    } catch (err) {
      if (err instanceof UserError) {
        peer.send({ type: "error", code: err.code, message: err.message });
      } else {
        this.log.error(`Handling ${msg.type} failed in session ${this.session.id}`, err);
        peer.send({ type: "error", code: "server_error", message: "Something went wrong. Try again." });
      }
    }
  }

  private requireLiveRound(): void {
    const s = this.session.status;
    if (s === "paused") throw new UserError("paused", this.session.pauseReason === "error" ? "The round is paused. Press Retry first." : "The round is paused. Resume it first.");
    if (s !== "live") throw new UserError("not_live", "The round is over.");
  }

  private onChat(channel: Channel, text: string, clientMsgId: string): void {
    if (channel === "coach") {
      if (this.session.status !== "debriefed") throw new UserError("coach_unavailable", "The coach is available once the debrief is ready.");
      this.addEntry({ channel: "coach", role: "candidate", text }, clientMsgId);
      this.noteTeachRequest(text);
      if (this.coach.status === "error") this.retry(this.coach);
      this.enqueue(this.coach, this.coachCandidateTurn(text));
      return;
    }
    this.requireLiveRound();
    const entry = this.addEntry({ channel: "interview", role: "candidate", text }, clientMsgId);
    this.lastCandidateAt = entry.at;
    this.markActive();
    this.enqueue(this.interview, this.candidateTurn(text));
  }

  private async onBoardUpdate(version: number, elements: Record<string, unknown>[]): Promise<void> {
    const s = this.session;
    if (s.status !== "live" && s.status !== "paused" && !this.acceptsLateEdit()) return;
    if (version <= s.board.version) return;
    const json = JSON.stringify(elements);
    if (Buffer.byteLength(json) > LIMITS.sceneBytes) throw new UserError("too_large", "The board is too large to save.");
    let graphText = s.board.graphText;
    let warnings: string[] = [];
    this.boardElements = elements;
    try {
      const graph = sceneToGraph(withFrameMembership(elements));
      graphText = graphToText(graph);
      warnings = graph.warnings;
    } catch (err) {
      this.warnOnce("graph", "Could not build the board graph; keeping the previous text", err);
    }
    s.board = { version, graphText, updatedAt: this.roundNow() };
    this.markActive();
    this.saveSoon();
    const board = { version, elements };
    this.boardWrites = this.boardWrites
      .catch(() => undefined)
      .then(() => this.deps.store.writeBoard(s.id, board))
      .catch((err) => this.log.warn(`Could not save the board of session ${s.id}`, err));
    this.broadcast({ type: "board.graph", version, graphText, warnings });
  }

  private onNotesUpdate(phase: string, text: string, version: number, from: Peer): void {
    const s = this.session;
    if (s.status !== "live" && s.status !== "paused") return;
    if (!isPhaseOf(s.track, phase)) throw new UserError("bad_phase", "That step does not belong to this round.");
    if (version <= s.stepNotesVersion) return;
    s.stepNotes = { ...s.stepNotes, [phase]: text };
    s.stepNotesVersion = version;
    this.markActive();
    this.saveSoon();
    for (const p of this.peers) if (p !== from) p.send({ type: "notes.changed", phase, text, version });
  }

  private onPngResult(requestId: string, pngBase64: string | null): void {
    const wait = this.pngWaits.get(requestId);
    if (!wait) return;
    const png = pngBase64 ? decodePng(pngBase64) : null;
    if (png) {
      wait.finish(png);
      return;
    }
    wait.remaining -= 1;
    if (wait.remaining <= 0) wait.finish(null);
  }

  private onPhaseSet(phase: string): void {
    const s = this.session.status;
    if (s !== "live" && s !== "paused") throw new UserError("not_live", "The round is over.");
    if (!isPhaseOf(this.session.track, phase)) throw new UserError("bad_phase", "That phase is not part of this round.");
    this.changePhase(phase, "candidate");
  }

  private onGuided(kind: "feedback" | "hint" | "stuck"): void {
    if (this.session.mode !== "guided") throw new UserError("not_guided", "Step checks, hints and model answers are only for guided rounds.");
    this.requireLiveRound();
    this.markActive();
    const label = this.currentPhase()?.label ?? this.session.phase;
    const noted = kind === "feedback" ? `Asked for a check of ${label}.` : kind === "hint" ? `Asked for a hint on ${label}.` : `Asked for a model answer for ${label}.`;
    this.addEntry({ channel: "interview", role: "system", kind: "note", text: noted });
    if (kind === "hint") {
      this.enqueue(this.interview, this.hintTurn());
      return;
    }
    if (kind === "stuck") {
      // The server keeps this count itself: a step with a model answer never counts as unaided, whatever the guide does next.
      const phase = this.session.phase;
      this.session.assists = [...(this.session.assists ?? []), { at: this.roundNow(), phase }];
      this.saveSoon();
      this.sendState();
      this.revokePractice(phase);
      this.enqueue(this.interview, this.stuckTurn(phase));
      return;
    }
    // The checker's reading goes to the guide as evidence, so its turn holds its place and waits for the checker.
    const phase = this.session.phase;
    const checked = settleWithin(this.checkStep(phase), FEEDBACK_WAIT_MS);
    this.enqueue(this.interview, this.feedbackTurn(phase, checked));
  }

  private async onPause(): Promise<void> {
    if (this.session.status !== "live") return;
    await this.pauseRound("user");
  }

  private async pauseRound(reason: "user" | "away"): Promise<void> {
    this.pauseClock(reason);
    const at = formatClock(this.roundNow());
    this.pending().push(reason === "user" ? `the candidate paused the clock at ${at}` : `the candidate left the room, so the clock was paused at ${at}`);
    if (!this.interview.busy) {
      this.interview.conv?.close();
      this.interview.conv = null;
    }
    await this.saveNow();
    this.sendState();
  }

  private async onResume(): Promise<void> {
    const s = this.session;
    if (s.status === "paused") {
      const now = Date.now();
      if (s.pauseStartedAt) s.pausedMs += Math.max(0, now - Date.parse(s.pauseStartedAt));
      s.pauseStartedAt = null;
      s.pauseReason = null;
      s.status = "live";
      this.markActive();
      await this.saveNow();
      this.sendState();
      this.scheduler?.reschedule();
      this.syncAwayTimer();
    }
    if (s.status === "live") {
      if (this.interview.status === "error") this.retry(this.interview);
      else void this.pump(this.interview);
    }
    if (s.status === "debriefed" && this.coach.status === "error") this.retry(this.coach);
  }

  statusNow(): SessionStatus {
    return this.session.status;
  }

  endByRequest(): Promise<void> {
    return this.onEnd();
  }

  private async onEnd(): Promise<void> {
    const s = this.session.status;
    if (s !== "live" && s !== "paused") throw new UserError("not_live", "The round has already ended.");
    await this.endRound("candidate");
  }

  private async onDebriefRetry(): Promise<void> {
    const s = this.session.status;
    if (s !== "failed" && s !== "ended") throw new UserError("no_retry", "There is no failed debrief to retry.");
    void this.startDebrief();
  }

  private roundNow(): number {
    return roundTimeMs(this.session, Date.now());
  }

  private currentPhase(): PhaseDef | undefined {
    return this.phases.find((p) => p.id === this.session.phase);
  }

  private pauseClock(reason: NonNullable<Session["pauseReason"]>): void {
    const s = this.session;
    if (s.status !== "live") return;
    s.status = "paused";
    s.pauseStartedAt = new Date().toISOString();
    s.pauseReason = reason;
    this.scheduler?.stop();
    this.syncAwayTimer();
  }

  private changePhase(phase: string, by: "candidate" | "interviewer"): void {
    const s = this.session;
    if (phase === s.phase) return;
    const at = this.roundNow();
    const left = s.phase;
    s.phase = phase;
    s.phaseHistory.push({ phase, at, by });
    const label = this.phases.find((p) => p.id === phase)?.label ?? phase;
    this.addEntry({ channel: "interview", role: "system", kind: "phase", text: by === "candidate" ? `Moved to ${label}.` : `The interviewer moved the round to ${label}.` });
    if (by === "candidate") {
      this.markActive();
      this.pending().push(`candidate moved to phase "${phase}" at ${formatClock(at)}`);
      this.saveSoon();
    }
    this.broadcast({ type: "phase.changed", phase, by });
    this.sendState();
    this.armPhaseOver();
    this.scheduler?.reschedule();
    void this.checkStep(left, { leaving: true });
  }

  /**
   * Keeps exactly one pending move-on offer, for the step on the rail, timed by his total time in that step. Leaving a
   * step drops its offer. A step that already got its offer, in this run or before a restart, never gets another.
   */
  private armPhaseOver(): void {
    const s = this.session;
    if (s.mode !== "guided") return;
    this.checkpoints = this.checkpoints.filter((c) => c.kind !== "phase_over");
    this.scheduler?.setCheckpoints(this.checkpoints);
    const offered = s.transcript.some((e) => e.kind === "clock" && e.text === phaseOverLabel(s.phase));
    if (offered || this.firedCheckpoints.has(`phase_over:${s.phase}`)) return;
    const cp = phaseOverCheckpoint(this.plan, s.phaseHistory, s.phase, this.roundNow());
    if (cp) {
      this.checkpoints.push(cp);
      this.scheduler?.setCheckpoints(this.checkpoints);
    }
  }

  /** Any sign that he is working starts a new quiet stretch, which may earn its own check-in. */
  private markActive(): void {
    this.activeAt = this.roundNow();
  }

  /** The quiet stretch runs from his last activity or the interviewer's last shown line, whichever is later. */
  private quietSince(): number {
    return Math.max(this.activeAt, this.spokeAt);
  }

  private get silenceWindowMs(): number {
    return SILENCE_WINDOW_MS[this.session.track][this.session.mode];
  }

  /**
   * A check-in is due when the round is live with someone in the room, the stretch has had none yet, and it has been
   * quiet for the whole window. The timer only says when to look; activity is read here, so edits never re-arm it.
   */
  private silenceDue(): boolean {
    return this.session.status === "live" && this.peers.size > 0 && this.silenceSpentFor !== this.quietSince() && this.roundNow() - this.quietSince() >= this.silenceWindowMs;
  }

  /** Keeps exactly one pending silence check, timed from the current quiet stretch. */
  private armSilence(): void {
    const s = this.session;
    this.checkpoints = this.checkpoints.filter((c) => c.kind !== "silence");
    if (s.status === "live" || s.status === "paused") {
      // A step nudge only speaks while he is still in that step, so only those can crowd the check-in.
      const others = this.checkpoints.filter((c) => c.phase === undefined || c.phase === s.phase);
      const now = this.roundNow();
      // A stretch that is already a full window old and never had its check-in (it fell while nobody was in the room)
      // gets it shortly, once someone is there to see it. One already waiting in the queue needs no second.
      const queued = this.interview.queue.some((t) => t.checkpoint === "silence");
      const overdue = this.peers.size > 0 && !queued && this.silenceSpentFor !== this.quietSince() && now - this.quietSince() >= this.silenceWindowMs;
      const quietFrom = overdue ? now + SILENCE_SETTLE_MS - this.silenceWindowMs : this.quietSince();
      this.checkpoints.push(silenceCheckpoint(quietFrom, this.silenceWindowMs, now, others, this.firedCheckpoints));
    }
    this.scheduler?.setCheckpoints(this.checkpoints);
    this.scheduler?.reschedule();
  }

  private checkRun(phase: string): StepCheckRun {
    let run = this.checkRuns.get(phase);
    if (!run) {
      run = { settled: null, again: false, againWithImage: false, againFresh: false, lastKey: null, imageKey: null, freshDone: 0, done: 0 };
      this.checkRuns.set(phase, run);
    }
    return run;
  }

  /** The board text of each step's frame, as the checker reads it; a board with no step frames gives none, so steps read the whole board. */
  private stepBoardText(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const p of this.phases) {
      const frameStep = evidenceStepFor(this.session.track, p.id);
      if (frameStep === null) continue;
      const frame = frameEvidence(this.boardElements, frameStep);
      if (frame.frameId) out[p.id] = frame.text;
    }
    return out;
  }

  /** What the checker reads for a step: its chat, its frame on the board, his written answer, and the code in a machine-coding round. */
  private stepEvidence(phase: string): { evidence: CheckerEvidence; frameId: string | null; needsImage: boolean; drawn: boolean; empty: boolean } | null {
    const s = this.session;
    const def = this.phases.find((p) => p.id === phase);
    const items = s.checklist[phase] ?? [];
    if (!def || items.length === 0) return null;
    const chat = stepEntries(s.transcript, s.phaseHistory, phase, this.roundNow());
    const frameStep = evidenceStepFor(s.track, phase);
    const frame = frameStep === null ? null : frameEvidence(this.boardElements, frameStep);
    // A board drawn before the app laid out step frames has no frames, so every step reads the whole board.
    const unframed = s.track === "hld" && stepFrames(this.boardElements).size === 0;
    const boardText = unframed ? this.boardText() : frame?.frameId ? frame.text : "";
    const scope = codeScopeFor(s.track, phase);
    const codeText =
      scope === "step" ? stepCodeText(this.codeContent, s.stepCode[phase] ?? []) : scope === "file" && this.codeContent.trim() !== "" ? numberedCode(this.codeContent) : "";
    const notesText = (s.stepNotes[phase] ?? "").trim();
    const said = chat.some((e) => e.role === "candidate") || notesText !== "";
    const drawn = unframed ? s.board.graphText.trim() !== "" : frame !== null && !frame.empty;
    return {
      evidence: { stepLabel: def.label, goal: def.goal, items, chat, boardText, codeText, notesText, imageAttached: false },
      frameId: unframed ? null : (frame?.frameId ?? null),
      needsImage: frame?.needsImage ?? false,
      drawn,
      empty: !said && !drawn && codeText === "",
    };
  }

  /**
   * Reads one step against its checklist. It runs when he leaves a step, when the round ends, when he asks for a check
   * in a guided round, and when the guide re-reads a step; never while he works, because a list that ticks as he talks
   * acts as a hint. A check asked for while one runs is folded into a single follow-up with the newest evidence, and
   * the returned promise settles once that follow-up has finished too; it never rejects. `leaving` adds the frame
   * image once, so a step he walks away from is read in full even when its text form looked complete. `fresh` reads
   * the step even when nothing changed and replaces its items, and a step with no evidence at all is cleared at once.
   */
  private checkStep(phase: string, how: { leaving?: boolean; fresh?: boolean } = {}): Promise<void> {
    const leaving = how.leaving ?? false;
    const fresh = how.fresh ?? false;
    if (this.disposed) return Promise.resolve();
    const run = this.checkRun(phase);
    if (run.settled) {
      run.again = true;
      run.againWithImage ||= leaving;
      run.againFresh ||= fresh;
      return run.settled;
    }
    const built = this.stepEvidence(phase);
    if (!built) return Promise.resolve();
    const s = this.session;
    const key = evidenceKey(built.evidence);
    if (built.empty) {
      if (fresh) {
        s.stepChecks = { ...s.stepChecks, [phase]: { status: "done", checkedAt: this.roundNow(), usedImage: false, items: {} } };
        run.lastKey = key;
        run.freshDone += 1;
        run.done += 1;
        this.saveSoon();
        this.sendState();
      }
      return Promise.resolve();
    }
    const withImage = built.frameId !== null && (built.needsImage || (fresh && built.drawn) || (leaving && run.imageKey !== key));
    if (!fresh && key === run.lastKey && !withImage) return Promise.resolve();
    const before = s.stepChecks[phase];
    s.stepChecks = { ...s.stepChecks, [phase]: { status: "checking", checkedAt: before?.checkedAt ?? null, usedImage: before?.usedImage ?? false, items: before?.items ?? {} } };
    this.sendState();
    const settled = this.runStepCheck(phase, built.evidence, withImage ? built.frameId : null, key, fresh)
      .catch((err) => this.log.warn(`Step check for ${phase} stopped in session ${s.id}`, err))
      .then(() => {
        run.settled = null;
        if (this.disposed || !run.again) return;
        const next = { leaving: run.againWithImage, fresh: run.againFresh };
        run.again = false;
        run.againWithImage = false;
        run.againFresh = false;
        return this.checkStep(phase, next);
      });
    run.settled = settled;
    return settled;
  }

  private async runStepCheck(phase: string, base: CheckerEvidence, frameId: string | null, key: string, fresh: boolean): Promise<void> {
    const s = this.session;
    const run = this.checkRun(phase);
    let next: Session["stepChecks"][string] | null = null;
    try {
      const png = frameId === null ? null : await this.requestPng(frameId);
      const evidence: CheckerEvidence = { ...base, imageAttached: png !== null };
      const res = await this.deps.driver.runOnce({
        role: "checker",
        ...this.roleModel("checker"),
        systemPrompt: async () => this.deps.prompts.render("checker", await this.baseVars()),
        tools: [],
        fake: {
          track: s.track,
          mode: s.mode,
          checkItems: evidence.items,
          candidateLines: evidence.chat.filter((e) => e.role === "candidate").map((e) => e.text),
          frameText: evidence.boardText,
          codeText: unnumberedCode(evidence.codeText),
          notesText: evidence.notesText,
          imageAttached: evidence.imageAttached,
        },
        usage: { sessionId: s.id, problemId: s.problemId, track: s.track, mode: s.mode },
        turn: {
          text: checkerMessage(evidence),
          ...(png ? { images: [{ data: png.toString("base64"), mimeType: "image/png" as const }] } : {}),
          meta: { kind: "oneshot" },
        },
        output: { schema: CheckerOutputSchema, jsonSchema: toApiSchema(CheckerOutputSchema), fallbackJsonSchema: toCompatSchema(CheckerOutputSchema) },
        maxTurns: 3,
      });
      if (!res.output) throw new DriverError("The checker returned nothing.");
      next = mergeCheck(fresh ? undefined : this.session.stepChecks[phase], res.output, evidence, this.roundNow());
      run.lastKey = key;
      run.done += 1;
      if (png) run.imageKey = key;
      if (fresh) run.freshDone += 1;
    } catch (err) {
      this.log.warn(`Step check for ${phase} failed in session ${s.id}: ${err instanceof DriverError ? err.detail : describeError(err)}`);
    }
    if (this.disposed) return;
    const prev = this.session.stepChecks[phase];
    this.session.stepChecks = {
      ...this.session.stepChecks,
      [phase]: next ?? { status: prev?.checkedAt != null ? "done" : "failed", checkedAt: prev?.checkedAt ?? null, usedImage: prev?.usedImage ?? false, items: prev?.items ?? {} },
    };
    this.saveSoon();
    this.sendState();
  }

  /** Adds or replaces a pin a model asked for, after checking it against the board as it is now. */
  private addPin(req: { elementId: string; note: string; tone: BoardPin["tone"]; by: BoardPin["by"] }, into?: BoardPin[]): ToolOutput {
    const existing = into ?? this.session.pins;
    const result = validatePin(this.boardElements, existing, { ...req, at: this.roundNow() }, () => randomId(8));
    if ("error" in result) return textOutput(result.error, true);
    // A guide pin would name what a count-only check must not, so it is refused for the step the element sits in.
    if (req.by === "guide" && this.countsOnly(result.pin.phase ?? this.session.phase))
      return textOutput("Checks of that step give only a count of what is open, so pin nothing there.", true);
    if (into) {
      const kept = withPin(into, result.pin, result.replaces);
      into.splice(0, into.length, ...kept);
    } else {
      this.session.pins = withPin(this.session.pins, result.pin, result.replaces);
      this.saveSoon();
      this.sendState();
    }
    return textOutput(result.replaces ? "Pinned, replacing your earlier note on that element." : "Pinned.");
  }

  private pinTargetsBlock(): string {
    return `Pin targets (id: what it is, and its step):\n${pinTargetsText(pinTargets(this.boardElements))}`;
  }

  private onCheckpoint(cp: Checkpoint): void {
    if (this.session.status !== "live") return;
    if (cp.kind === "silence") {
      if (this.silenceDue()) this.enqueue(this.interview, this.clockQueued(cp));
      // The scheduler is still walking its list, so the next check-in is armed once it has finished.
      queueMicrotask(() => {
        if (!this.disposed) this.armSilence();
      });
      return;
    }
    if ((cp.kind === "phase_end" || cp.kind === "phase_over") && this.session.phase !== cp.phase) return;
    if (cp.kind === "time_up") {
      void this.endRound("time");
      return;
    }
    this.enqueue(this.interview, this.clockQueued(cp));
  }

  private async endRound(by: "candidate" | "interviewer" | "time"): Promise<void> {
    const s = this.session;
    if (s.status !== "live" && s.status !== "paused") return;
    const now = Date.now();
    if (s.pauseStartedAt) s.pausedMs += Math.max(0, now - Date.parse(s.pauseStartedAt));
    s.pauseStartedAt = null;
    s.pauseReason = null;
    s.status = "ended";
    s.endedAt = new Date(now).toISOString();
    if (by === "time") this.lateEditsUntil = now + LATE_EDIT_GRACE_MS;
    this.scheduler?.stop();
    this.syncAwayTimer();
    const note = by === "candidate" ? "The candidate ended the round." : by === "interviewer" ? "The interviewer ended the round." : "Time is up.";
    this.addEntry({ channel: "interview", role: "system", kind: "note", text: note });
    void this.checkStep(s.phase, { leaving: true });
    await this.saveNow();
    this.sendState();
    if (by === "time") {
      // The interviewer closes in a line or two first; the debrief starts once that reply is in (or fails).
      this.enqueue(
        this.interview,
        this.clockQueued({ id: "time_up", kind: "time_up", atMs: s.durationMs }, () => this.startDebrief()),
      );
    } else {
      this.closeChannel(this.interview);
      void this.startDebrief();
    }
  }

  private enqueue(ch: ChannelState, turn: QueuedTurn): void {
    if (ch.closed) return;
    ch.queue.push(turn);
    void this.pump(ch);
  }

  private setChannelStatus(ch: ChannelState, status: ChannelState["status"], error: string | null = null): void {
    ch.status = status;
    ch.error = error;
    this.broadcast({ type: "agent.status", channel: ch.name, state: status, ...(error ? { error } : {}) });
  }

  private closeChannel(ch: ChannelState): void {
    ch.closed = true;
    ch.queue = [];
    ch.conv?.close();
    ch.conv = null;
    if (ch.status !== "idle" && !this.disposed) this.setChannelStatus(ch, "idle");
  }

  private retry(ch: ChannelState): void {
    if (ch.status !== "error") return;
    this.setChannelStatus(ch, "idle");
    void this.pump(ch);
  }

  private sdkIdFor(ch: ChannelState): string | null {
    return ch.name === "interview" ? this.session.sdk.interviewerSessionId : this.session.sdk.coachSessionId;
  }

  private rememberSdkSession(ch: ChannelState, conv: Conversation): void {
    const id = conv.sdkSessionId();
    if (!id || id === this.sdkIdFor(ch)) return;
    if (ch.name === "interview") this.session.sdk.interviewerSessionId = id;
    else this.session.sdk.coachSessionId = id;
    this.saveSoon();
  }

  private ensureConversation(ch: ChannelState): Conversation {
    if (ch.conv) return ch.conv;
    const setup = ch.name === "interview" ? this.interviewSetup(ch) : this.coachSetup(ch);
    if (ch.replayNext) {
      ch.replayNext = false;
      ch.freshResume = false;
      if (ch === this.interview) this.endRequested = false;
      ch.conv = this.deps.driver.startConversation({ ...setup, resumeSessionId: null });
      const speaker = ch.name === "coach" ? "coach" : "interviewer";
      // Until the model has spoken there is nothing to replay: the queued turns, opening first, simply run again.
      if (this.session.transcript.some((e) => e.channel === ch.name && e.role === speaker)) {
        // The replay carries every message, so queued candidate turns would only repeat them.
        ch.queue = [this.replayQueued(ch), ...ch.queue.filter((t) => t.kind !== "candidate")];
      }
      return ch.conv;
    }
    const resumeId = this.sdkIdFor(ch);
    ch.freshResume = resumeId !== null;
    ch.conv = this.deps.driver.startConversation({ ...setup, resumeSessionId: resumeId });
    return ch.conv;
  }

  private canRun(ch: ChannelState): boolean {
    return !ch.busy && this.channelOpen(ch);
  }

  private channelOpen(ch: ChannelState): boolean {
    if (ch.closed || ch.status === "error" || this.disposed) return false;
    if (ch.name === "interview") return this.session.status === "live" || this.session.status === "ended";
    return true;
  }

  private async pump(ch: ChannelState): Promise<void> {
    if (!this.canRun(ch) || ch.queue.length === 0) return;
    ch.busy = true;
    let filter: SilentFilter | null = null;
    let entryId = "";
    let failed = false;
    try {
      const conv = this.ensureConversation(ch);
      const next = ch.queue[0];
      if (!next) return;
      if (next.ready) {
        // The page reads "thinking" as busy, so he cannot stack requests while the turn waits.
        this.setChannelStatus(ch, "thinking");
        await next.ready;
        // A pause, an end or a discard can land during the wait; the turn keeps its place until the channel runs again.
        if (!this.channelOpen(ch)) {
          if (!ch.closed && !this.disposed) this.setChannelStatus(ch, "idle");
          return;
        }
      }
      const built = next.build();
      if (!built) {
        ch.queue.shift();
        if (ch.status === "thinking") this.setChannelStatus(ch, "idle");
        return;
      }
      if (ch.status !== "thinking") this.setChannelStatus(ch, "thinking");
      this.boardLooksThisTurn = 0;
      this.rechecksThisTurn = 0;
      this.passBarredThisTurn = built.turn.meta.request === "stuck";
      entryId = newEntryId();
      const f = new SilentFilter((text) => this.broadcast({ type: "chat.delta", channel: ch.name, messageId: entryId, textDelta: text }));
      filter = f;
      const reply = await conv.send(built.turn, { onTextDelta: (d) => f.push(d) });
      if (ch.closed) {
        this.keepPartial(ch, f, entryId);
        return;
      }
      const text = f.finish();
      ch.queue.shift();
      built.commit();
      ch.freshResume = false;
      this.rememberSdkSession(ch, conv);
      if (text) this.addEntry({ id: entryId, channel: ch.name, role: ch.name === "coach" ? "coach" : "interviewer", text });
      this.setChannelStatus(ch, "idle");
      this.log.info(`${ch.name} turn (${next.kind}) in ${reply.stats.durationMs} ms for session ${this.session.id}`);
      try {
        await next.after?.(text);
      } catch (err) {
        this.log.error(`After-turn step failed in session ${this.session.id}`, err);
      }
    } catch (err) {
      failed = true;
      // An end asked for in a turn that never completed must not end the round after some later reply.
      if (ch === this.interview) this.endRequested = false;
      if (filter) this.keepPartial(ch, filter, entryId);
      await this.onTurnError(ch, err);
    } finally {
      ch.busy = false;
      this.passBarredThisTurn = false;
      if (ch === this.interview) {
        if (this.session.status === "paused") {
          ch.conv?.close();
          ch.conv = null;
        }
        this.settleAwayPause();
      } else if (ch === this.coach) {
        if (this.peers.size === 0 && this.session.status === "debriefed") {
          this.syncCoachAwayTimer();
        }
      }
      // Every exit, a skipped turn included, hands the channel to the next turn in line.
      if (!failed || ch.status !== "error") void this.pump(ch);
    }
  }

  /** Text the browser already saw stays in the transcript, so its copy and ours never disagree. */
  private keepPartial(ch: ChannelState, filter: SilentFilter, entryId: string): void {
    if (!filter.streamed) return;
    const text = filter.partial();
    if (text) this.addEntry({ id: entryId, channel: ch.name, role: ch.name === "coach" ? "coach" : "interviewer", text });
  }

  private async onTurnError(ch: ChannelState, err: unknown): Promise<void> {
    if (ch.closed || this.disposed) return;
    const detail = err instanceof DriverError ? err.detail : describeError(err);
    this.log.error(`Model turn failed on ${ch.name} in session ${this.session.id}: ${detail}`);
    ch.conv?.close();
    ch.conv = null;
    if (ch.freshResume) {
      // The SDK session could not be resumed; start over from the app's own transcript at once.
      ch.freshResume = false;
      ch.replayNext = true;
      return;
    }
    if (ch.name === "interview" && this.session.status === "ended") {
      // The closing line failed. The round is over anyway, so the debrief goes ahead.
      this.closeChannel(ch);
      void this.startDebrief();
      return;
    }
    const message =
      err instanceof DriverError
        ? channelErrorText(err.message)
        : err instanceof PromptError
          ? "The model could not start because a prompt file is missing or broken. See the server log."
          : "The model could not answer.";
    if (ch.name === "interview" && this.session.status === "live") {
      this.pauseClock("error");
      await this.saveNow();
      this.sendState();
    }
    this.setChannelStatus(ch, "error", message);
  }

  private timeView(): TimeView {
    const w = phaseWindows(this.plan).find((x) => x.id === this.session.phase);
    return {
      roundMs: this.roundNow(),
      durationMs: this.session.durationMs,
      guided: this.session.mode === "guided",
      phaseId: this.session.phase,
      plannedStartMs: w?.startMs ?? null,
      plannedEndMs: w?.endMs ?? null,
    };
  }

  private codeView(ch: ChannelState) {
    const code = this.session.code;
    if (!code) return undefined;
    return {
      lines: countLines(this.codeContent),
      changed: code.version !== ch.codeSeen,
      check: this.lastCheck ? summarizeDiagnostics(this.lastCheck.diagnostics) : null,
    };
  }

  private notesView(ch: ChannelState) {
    const s = this.session;
    return { version: s.stepNotesVersion, text: stepNotesText(this.phases, s.stepNotes), changed: s.stepNotesVersion !== ch.notesSeen };
  }

  /** `withNotes` false leaves his notes out of the context and unmarked, for a turn that carries them itself. */
  private interviewContext(ch: ChannelState, withNotes = true): { view: ContextView; commit: () => void } {
    const s = this.session;
    const notesVersion = s.stepNotesVersion;
    const boardVersion = s.board.version;
    const codeVersion = s.code?.version ?? -1;
    const lastRun = this.pendingRun;
    const events = [...this.pending()];
    const view: ContextView = {
      time: this.timeView(),
      ...(s.mode === "guided" ? { steps: this.stepsLine() } : {}),
      board: { version: boardVersion, graphText: s.board.graphText, changed: boardVersion !== ch.boardSeen },
      ...(withNotes ? { notes: this.notesView(ch) } : {}),
      code: this.codeView(ch),
      lastRun,
      events,
    };
    return {
      view,
      commit: () => {
        ch.boardSeen = Math.max(ch.boardSeen, boardVersion);
        if (withNotes) ch.notesSeen = Math.max(ch.notesSeen, notesVersion);
        ch.codeSeen = Math.max(ch.codeSeen, codeVersion);
        if (this.pendingRun === lastRun) this.pendingRun = null;
        if (events.length > 0) {
          this.pending().splice(0, events.length);
          this.saveSoon();
        }
      },
    };
  }

  private coachContext(ch: ChannelState): { view: ContextView; commit: () => void } {
    const s = this.session;
    const boardVersion = s.board.version;
    const codeVersion = s.code?.version ?? -1;
    return {
      view: { board: { version: boardVersion, graphText: s.board.graphText, changed: boardVersion !== ch.boardSeen }, code: this.codeView(ch) },
      commit: () => {
        ch.boardSeen = boardVersion;
        ch.codeSeen = codeVersion;
      },
    };
  }

  private candidateTurn(text: string): QueuedTurn {
    return {
      kind: "candidate",
      build: () => {
        const { view, commit } = this.interviewContext(this.interview);
        return { turn: { text: candidateEnvelope(view, text), meta: { kind: "candidate", candidateText: text } }, commit };
      },
      after: () => this.afterInterviewerTurn(),
    };
  }

  /** "Check this step" for the step he asked about, built once the checker's reading of it has settled. */
  private feedbackTurn(phaseId: string, ready: Promise<unknown>): QueuedTurn {
    return {
      kind: "request",
      ready,
      build: () => {
        const phase = this.phases.find((p) => p.id === phaseId);
        const label = phase?.label ?? phaseId;
        const written = (this.session.stepNotes[phaseId] ?? "").trim();
        const ifNotYet = this.countsOnly(phaseId)
          ? `This step already had ${NAMED_CHECKS} "Not yet" checks, so this check names nothing. If it does not pass, do not say what is missing, in the reply or in the gap: say that ${openCountPhrase(this.openCount(phaseId))} still open, and that pressing Hint gives a nudge toward the next one. Pin nothing in this reply.`
          : "If it does not pass, name the one most important gap, as a missing question or a missing decision and not its answer.";
        const body = [
          `The candidate pressed "Check this step" for the step "${label}"${phase ? ` (goal: ${phase.goal})` : ""}. Give feedback on this step only. Call step_verdict once for this step (phase "${phaseId}") before you write the verdict, and call it again with "not_yet" if the app refuses a pass. Then write one thing that holds and the verdict. ${ifNotYet}`,
          ...(written ? ["His written answer for this step:", "<notes>", written, "</notes>"] : []),
          this.checklistBlock(phaseId),
          this.pinTargetsBlock(),
        ].join("\n");
        const { view, commit } = this.interviewContext(this.interview, false);
        return { turn: { text: requestTurn(view, body), meta: { kind: "request", request: "feedback" } }, commit };
      },
      after: () => this.afterInterviewerTurn(),
    };
  }

  /** A gap round that passes its gap's step with no model answer on that step marks the gap practised on its source round. */
  private notePractice(phase: string): void {
    const source = this.session.focus?.source;
    if (!source || source.step !== phase) return;
    if ((this.session.assists ?? []).some((a) => a.phase === phase)) return;
    // The pass is saved before the mark, so the source never points at a pass its gap round lost.
    void this.saveNow();
    void this.deps.gapPractice?.(source, { sessionId: this.session.id, at: new Date().toISOString() }, this.session.id);
  }

  /** A model answer asked for on a step that already passed takes the practised mark back. */
  private revokePractice(phase: string): void {
    const source = this.session.focus?.source;
    if (!source || source.step !== phase || this.session.stepVerdicts?.[phase]?.verdict !== "pass") return;
    void this.deps.gapPractice?.(source, null, this.session.id);
  }

  /** Sets or clears a practised mark on this round's gap, from a gap round that practised it. */
  setGapPractice(title: string, mark: GapPractice | null, roundId: string): void {
    if (this.disposed || !applyGapPractice(this.session, title, mark, roundId)) return;
    // Saved at once, so the history that Today and Progress read agrees with the debrief page.
    void this.saveNow();
    this.sendState();
  }

  private stepsLine(): string {
    return stepStatusLine(
      this.phases,
      this.session.stepVerdicts,
      this.phases.filter((p) => this.countsOnly(p.id)).map((p) => p.id),
    );
  }

  private countsOnly(phase: string): boolean {
    return checksCountOnly(this.session, phase, this.session.stepVerdicts?.[phase]);
  }

  /**
   * Items of the step the checker has not read as covered, or null when no finished reading matches his latest work.
   * A step that needs one of its items has one thing open until one is covered, since the others are alternatives.
   */
  private openCount(phase: string): number | null {
    const items = this.session.checklist[phase] ?? [];
    const check = this.session.stepChecks[phase];
    if (items.length === 0 || check?.checkedAt == null) return null;
    // A count from before his latest work would be wrong, and a check asked for in the chat runs no new reading.
    const built = this.stepEvidence(phase);
    if (built && this.checkRun(phase).lastKey !== evidenceKey(built.evidence)) return null;
    const open = items.filter((i) => check.items[i.id]?.state !== "covered").length;
    if (this.phases.find((p) => p.id === phase)?.passNeeds === "one") return open < items.length ? null : 1;
    return open;
  }

  /** "I'm stuck" for the current step: a short model answer, then the step goes back to him. */
  private stuckTurn(phaseId: string): QueuedTurn {
    return {
      kind: "request",
      build: () => {
        const phase = this.phases.find((p) => p.id === phaseId);
        const label = phase?.label ?? phaseId;
        const body = [
          `The candidate pressed "I'm stuck" on the step "${label}"${phase ? ` (goal: ${phase.goal})` : ""}. Give a short model answer for this step: at most about 150 words, no tables and no quiz. Then add one line asking him to redo the step in his own words.`,
          `Do not call step_verdict with "pass" in this reply, and do not call note_hint: the server has already recorded this as an assist. Longer teaching waits for the coach after the round.`,
          this.checklistBlock(phaseId, false),
        ].join("\n");
        const { view, commit } = this.interviewContext(this.interview, false);
        return { turn: { text: requestTurn(view, body), meta: { kind: "request", request: "stuck" } }, commit };
      },
      after: () => this.afterInterviewerTurn(),
    };
  }

  private hintTurn(): QueuedTurn {
    return {
      kind: "request",
      build: () => {
        const label = this.currentPhase()?.label ?? this.session.phase;
        const entered = [...this.session.phaseHistory].reverse().find((h) => h.phase === this.session.phase)?.at ?? 0;
        const given = this.session.hints.filter((h) => h.at >= entered).map((h) => `H${h.level}`);
        const counting = this.countsOnly(this.session.phase);
        const body = [
          `The candidate asked for a hint on the step "${label}". Give only the next rung of the hint ladder (H1 points at an area, H2 names the concern, H3 offers two options) and record it with note_hint. Rungs already given on this step: ${given.length > 0 ? given.join(", ") : "none"}.`,
          ...(counting
            ? [
                "His checks on this step now give only a count of what is open, so this hint is how he hears the next open item: aim the rung at the most important one, as a missing question and not its answer.",
              ]
            : []),
          ...(given.includes("H3")
            ? [
                `H3 was given on this step already. Give no model answer: start another open point at H1 and record that level with note_hint, or say that "I'm stuck" gives a short model answer.`,
              ]
            : []),
        ].join("\n");
        const { view, commit } = this.interviewContext(this.interview);
        return { turn: { text: requestTurn(view, body), meta: { kind: "request", request: "hint" } }, commit };
      },
      after: () => this.afterInterviewerTurn(),
    };
  }

  private passRuleText(phase: string): string {
    const items = this.session.checklist[phase] ?? [];
    const need = passNeed(this.phases.find((p) => p.id === phase) ?? {}, items.length);
    return `The server refuses a pass while fewer than ${need} of these ${items.length} items are covered. That is a floor, not the bar: pass only when the step meets the level bar. If he covered more than the reading shows, call recheck_step before you decide.`;
  }

  /** The checker's last finished reading of a step. It is evidence for the guide; the candidate never sees the list in a live round. */
  /** `withPassRule` false leaves out the pass floor, for a reply that may not pass the step. */
  private checklistBlock(phase: string, withPassRule = true): string {
    const items = this.session.checklist[phase] ?? [];
    if (items.length === 0) return "This step has no checklist.";
    const check = this.session.stepChecks[phase];
    if (check?.checkedAt == null) return "The checker has no finished reading of this step yet, so judge the step from what he has said and drawn.";
    return [
      `This is the checker's reading of the step checklist as of ${formatClock(check.checkedAt)}. It may lag his latest work, and he does not see this list.`,
      "<checklist>",
      stepReadingText(items, check),
      "</checklist>",
      ...(withPassRule ? [this.passRuleText(phase)] : ["Use it as evidence for the model answer."]),
    ].join("\n");
  }

  private clockQueued(cp: Checkpoint, onSettled?: () => Promise<void> | void): QueuedTurn {
    // The stretch this check-in answers, read when it is sent: work he does while it is out starts a new one.
    let stretch: number | null = null;
    return {
      kind: "clock",
      checkpoint: cp.kind,
      build: () => {
        const status = this.session.status;
        if (cp.kind === "time_up" ? status !== "ended" : status !== "live") return null;
        if ((cp.kind === "phase_end" || cp.kind === "phase_over") && this.session.phase !== cp.phase) return null;
        // A step that already passed has the "Move on" button; an offer would only nag.
        if (cp.kind === "phase_over" && this.session.stepVerdicts?.[cp.phase ?? ""]?.verdict === "pass") return null;
        // He may have started work, or the interviewer may have spoken, while this turn waited in line.
        if (cp.kind === "silence") {
          if (!this.silenceDue()) return null;
          stretch = this.quietSince();
        }
        // The planned-length line already asks him whether to go on, so a move-on offer next to it would only repeat it.
        // Its hidden note still marks the step as offered, so a restart does not bring the offer back at once.
        if (cp.kind === "phase_over" && Math.abs(this.roundNow() - this.session.durationMs) < SILENCE_GAP_MS) {
          this.addEntry({ channel: "interview", role: "system", kind: "clock", hidden: true, text: clockLabel(cp) });
          return null;
        }
        const since = this.lastCandidateAt === null ? null : Math.max(0, this.roundNow() - this.lastCandidateAt);
        const detail = { quietMs: this.roundNow() - this.quietSince(), plannedMs: this.session.durationMs };
        return {
          turn: { text: clockTurn(this.timeView(), since, cp.kind, this.session.track, detail), meta: { kind: "clock", checkpoint: cp.kind } },
          commit: () => {},
        };
      },
      after: async (text) => {
        // Marked only once the turn went through, so a failed send leaves the stretch its check-in. A shown check-in
        // line belongs to its stretch, so it never opens a new one; after a silent reply the stretch stays as it was sent.
        if (cp.kind === "silence") this.silenceSpentFor = text ? this.quietSince() : stretch;
        this.addEntry({ channel: "interview", role: "system", kind: "clock", hidden: true, text: clockLabel(cp) });
        if (cp.kind === "extension" && text) {
          this.session.extension = { at: this.roundNow(), text };
          this.addEntry({ channel: "interview", role: "system", kind: "extension", text: "The interviewer introduced the extension." });
          await this.saveNow();
        }
        await this.afterInterviewerTurn();
        await onSettled?.();
      },
    };
  }

  private replayQueued(ch: ChannelState): QueuedTurn {
    return {
      kind: "replay",
      build: () => {
        const ctx = ch.name === "interview" ? this.interviewContext(ch) : this.coachContext(ch);
        return { turn: { text: replayTurn(ctx.view, transcriptLines(this.session.transcript, ch.name)), meta: { kind: "replay" } }, commit: ctx.commit };
      },
    };
  }

  private coachCandidateTurn(text: string): QueuedTurn {
    return {
      kind: "candidate",
      build: () => {
        const { view, commit } = this.coachContext(this.coach);
        return { turn: { text: candidateEnvelope(view, text), meta: { kind: "candidate", candidateText: text } }, commit };
      },
    };
  }

  /** Sends the coach's opening once, when the candidate starts the chat; a later press, or a chat already started, changes nothing. */
  private onCoachOpen(): void {
    if (this.session.status !== "debriefed") throw new UserError("coach_unavailable", "The coach is available once the debrief is ready.");
    if (this.coach.busy) return;
    const candidateSpoke = this.session.transcript.some((e) => e.channel === "coach" && e.role === "candidate");
    // A failed opening stays queued, even when part of it streamed, so a second press runs it again.
    if (this.coach.status === "error" && !candidateSpoke) return this.retry(this.coach);
    if (this.coachStarted() || this.coach.queue.length > 0) return;
    this.enqueue(this.coach, this.coachOpenTurn());
  }

  /** Whether the coach chat holds a line; a "Now on" divider written by a failed opening does not count. */
  private coachStarted(): boolean {
    return this.session.transcript.some((e) => e.channel === "coach" && e.role !== "system");
  }

  private coachOpenTurn(): QueuedTurn {
    return {
      kind: "request",
      build: () => {
        const { view, commit } = this.coachContext(this.coach);
        const body =
          'The debrief is ready. Write your opening message now: sum up the scorecard in two or three sentences, then say "let\'s start with" the top gap and begin teaching it.';
        return { turn: { text: requestTurn(view, body), meta: { kind: "request", request: "coach_open" } }, commit };
      },
    };
  }

  private async afterInterviewerTurn(): Promise<void> {
    if (!this.endRequested) return;
    this.endRequested = false;
    await this.endRound("interviewer");
  }

  private async baseVars() {
    return commonVars({
      date: localDate(),
      problemTitle: this.problem.meta.title,
      track: this.session.track,
      mode: this.session.mode,
      durationMin: this.durationMin,
      candidateProfile: await this.deps.prompts.candidateProfile(),
    });
  }

  private roleModel(role: RoleName) {
    const settings = this.deps.settings.get();
    switch (role) {
      case "interviewer":
      case "guide":
        return { model: this.session.models.interviewer, effort: settings.effort.interviewer };
      case "tester":
      case "judge":
        return { model: this.session.models.judge, effort: settings.effort.judge };
      case "coach":
        return { model: settings.models.coach, effort: settings.effort.coach };
      case "checker":
        // It matches his words against a short list, and it runs after every pause, so the small model is enough.
        return { model: "claude-sonnet-5-5" as const, effort: "low" as const };
      default:
        return { model: settings.models.scribe, effort: settings.effort.scribe };
    }
  }

  private interviewSetup(ch: ChannelState): Omit<ConversationSetup, "resumeSessionId"> {
    const role: RoleName = this.session.mode === "guided" ? "guide" : "interviewer";
    const prompt = `${role}-${this.session.track}` as PromptName;
    return {
      role,
      ...this.roleModel(role),
      systemPrompt: async () =>
        this.deps.prompts.render(prompt, {
          ...(await this.baseVars()),
          problem_brief: this.problem.body,
          extension_minute: String(extensionMinute(this.session.track, this.durationMin)),
          phase_plan: formatPhasePlan(this.session.track, this.durationMin),
          focus: focusText(this.session.focus, this.phases.find((p) => p.id === this.session.focus?.source?.step)?.label ?? null),
        }),
      tools: this.interviewTools(ch),
      fake: {
        problem: this.problem,
        phases: this.phases,
        track: this.session.track,
        mode: this.session.mode,
        session: () => this.session,
        pinTargets: () => pinTargets(this.boardElements),
      },
      usage: { sessionId: this.session.id, problemId: this.session.problemId, track: this.session.track, mode: this.session.mode },
    };
  }

  private coachSetup(ch: ChannelState): Omit<ConversationSetup, "resumeSessionId"> {
    return {
      role: "coach",
      ...this.roleModel("coach"),
      systemPrompt: async () => {
        const { quoteChecks: _q, lintIssues: _l, ...card } = scorecardWithCurrentPlan(this.session) ?? ({} as Scorecard);
        return this.deps.prompts.render("coach", {
          ...(await this.baseVars()),
          problem_brief: this.problem.body,
          teaching_md: await this.deps.prompts.teachingMd(),
          scorecard_json: JSON.stringify(card, null, 2),
        });
      },
      tools: this.coachTools(ch),
      fake: { problem: this.problem, scorecard: this.session.scorecard, track: this.session.track, mode: this.session.mode, session: () => this.session },
      usage: { sessionId: this.session.id, problemId: this.session.problemId, track: this.session.track, mode: this.session.mode },
    };
  }

  private boardText(): string {
    return this.session.board.graphText.trim() || "(the board is empty)";
  }

  private interviewTools(ch: ChannelState): RoomTool[] {
    const phaseIds = this.phases.map((p) => p.id).join(", ");
    const guided = this.session.mode === "guided";
    const tools: RoomTool[] = [
      defineTool(
        "view_whiteboard",
        "See the candidate's whiteboard now: an image of the board plus its exact text form (boxes, labels, arrows). Trust the text form for labels and connections; use the image for layout and freehand drawing.",
        {},
        async () => {
          this.boardLooksThisTurn += 1;
          ch.boardSeen = Math.max(ch.boardSeen, this.session.board.version);
          if (this.boardLooksThisTurn > MAX_BOARD_LOOKS_PER_TURN) return textOutput(`You already looked at the board this turn. Text form:\n\n${this.boardText()}`);
          const png = await this.requestPng();
          const text = guided ? `${this.boardText()}\n\n${this.pinTargetsBlock()}` : this.boardText();
          if (!png) return textOutput(`The image was unavailable, so here is the text form only.\n\n${text}`);
          return {
            content: [
              { type: "image", data: png.toString("base64"), mimeType: "image/png" },
              { type: "text", text },
            ],
          };
        },
      ),
      defineTool(
        "set_phase",
        guided
          ? `Move the candidate's phase rail. He moves it himself, so call this only when he says he is moving on or asks you to move it, or when his work has clearly sat in another step for a few minutes while the rail lags. Never call it in a reply to "Check this step". Phases, in order: ${phaseIds}.`
          : `Move the candidate's phase rail when the round has clearly moved to another step. Phases, in order: ${phaseIds}. The rail is a guide, never a gate.`,
        { phase: z.string().min(1).max(40) },
        async ({ phase }) => {
          if (!isPhaseOf(this.session.track, phase)) return textOutput(`Unknown phase. Use one of: ${phaseIds}.`, true);
          this.changePhase(phase, "interviewer");
          return textOutput(`The phase is now ${phase}.`);
        },
      ),
      defineTool(
        "note_hint",
        "Record the hint you are giving in this reply, before you write the reply text, so the debrief can count it. Level 1 points at an area, level 2 names the concern, level 3 offers two options. The candidate never sees this record.",
        { level: z.number().int().min(1).max(3), topic: z.string().min(1).max(200) },
        async ({ level, topic }) => {
          const at = this.roundNow();
          this.session.hints.push({ at, level: level as 1 | 2 | 3, topic });
          this.addEntry({ channel: "interview", role: "system", kind: "hint", hidden: true, text: `hint H${level}: ${topic}` });
          return textOutput("Recorded.");
        },
      ),
      defineTool(
        "end_interview",
        "End the round now, for example when the candidate says they are finished. After this call, close in one short sentence with no feedback.",
        { reason: z.string().min(1).max(500) },
        async () => {
          this.endRequested = true;
          return textOutput("The round ends after this reply. Close in one short sentence with no feedback.");
        },
      ),
    ];
    // Pins are guided-mode help; an interview round gives none, so the interviewer never gets the tool.
    if (guided) {
      tools.push(
        defineTool(
          "pin_note",
          "Attach a short note to one box or arrow on the candidate's board, where the remark applies. Use an id from the pin targets that view_whiteboard lists. One plain sentence.",
          { elementId: z.string().min(1).max(64), note: z.string().min(1).max(LIMITS.pinNoteChars) },
          async ({ elementId, note }) => this.addPin({ elementId, note, tone: "note", by: "guide" }),
        ),
        defineTool(
          "step_verdict",
          `Record your call on one step. This is the only "passed" the candidate sees, so call it once for each step check. Use "pass" when the step meets the level bar; a pass is final and you must not raise that step again. The app refuses a pass that the step's checklist reading does not support; then call it again with "not_yet". Use "not_yet" with one gap, the most important one, phrased as a missing question or a missing decision and not its answer; when checks of the step give only a count, the app writes the gap itself. Steps: ${phaseIds}.`,
          StepVerdictShape,
          async (args) => {
            // A count-only "not_yet" stores the count, so a guide that rightly leaves the gap empty is not pushed to name one.
            const quietPhase = args.verdict === "not_yet" && this.countsOnly(args.phase) ? args.phase : null;
            const parsed = parseStepVerdict(
              quietPhase !== null ? { ...args, gap: openCountText(this.openCount(quietPhase)) } : args,
              this.phases.map((p) => p.id),
            );
            if (!parsed.ok) return textOutput(parsed.error, true);
            const { phase, verdict } = parsed.value;
            if (verdict === "pass" && this.passBarredThisTurn)
              return textOutput("This reply gives a model answer, so the step cannot pass now. Ask him to redo the step; judge it on his next check.", true);
            if (verdict === "pass" && this.session.stepVerdicts?.[phase]?.verdict !== "pass") {
              const refused = await this.passRefusal(phase);
              if (refused && this.countsOnly(phase))
                return textOutput(
                  `The step cannot pass yet. Checks of this step name nothing: call step_verdict with "not_yet" and say only that ${openCountPhrase(this.openCount(phase))} still open.`,
                  true,
                );
              if (refused) return textOutput(refused, true);
            }
            // A count-only check stores the count itself, so the page never shows the item the guide was told not to name.
            const counted = verdict === "not_yet" && quietPhase === phase;
            const input = parsed.value;
            const done = recordStepVerdict(this.session, input, this.roundNow());
            if (!done.ok) return textOutput(done.error, true);
            this.saveSoon();
            this.sendState();
            if (counted) return textOutput(`Recorded: not yet. The page shows: "${input.gap}" Name nothing that is missing in your reply.`);
            if (verdict === "not_yet") return textOutput("Recorded: not yet.");
            this.notePractice(phase);
            return textOutput(`Recorded: the step passed. Steps now: ${this.stepsLine()}.`);
          },
        ),
        defineTool(
          "recheck_step",
          `Have the checker read one step's checklist again from scratch, when the reading looks out of date against what he has said or drawn. Any step, not only the current one: ${phaseIds}. Waits for the result and returns each item with its state and where it was found.`,
          { phase: z.string().min(1).max(40) },
          async ({ phase }) => {
            if (!isPhaseOf(this.session.track, phase)) return textOutput(`Unknown step. Use one of: ${phaseIds}.`, true);
            this.rechecksThisTurn += 1;
            if (this.rechecksThisTurn > MAX_RECHECKS_PER_TURN) return textOutput("No more re-reads in this reply. Answer with the readings you have.", true);
            return this.recheckStep(phase);
          },
        ),
      );
    }
    if (this.session.track === "lld") {
      tools.push(
        defineTool("read_code", "Read the candidate's C++ file as it is now, with line numbers, plus the result of the last syntax check.", {}, async () => {
          ch.codeSeen = Math.max(ch.codeSeen, this.session.code?.version ?? -1);
          return this.readCodeOutput(this.codeContent);
        }),
        defineTool(
          "run_code",
          "Compile and run the candidate's program (its own main()) and see the output. Use it near the end, or when the candidate asks you to look at a run.",
          {},
          async () => {
            const result = await this.runProgram("interviewer");
            return textOutput(runResultText(result));
          },
        ),
      );
    }
    return tools;
  }

  /**
   * Refuses a pass the step's reading does not support, after bringing the reading up to date with his latest work.
   * A check that is already running is awaited rather than queued again, and a new one runs only when the evidence
   * changed since the last reading, so a pass right after "Check this step" costs no second call. When no reading
   * finished while it waited (the checker failed or ran out of time), the call is left to the guide, so a broken
   * checker never locks a step. An edit made while the checker reads does not count as a failure: the reading that
   * just finished decides.
   */
  private async passRefusal(phase: string): Promise<string | null> {
    const notLive = "The round is not live, so no step can pass now.";
    if (this.disposed || (this.session.status !== "live" && this.session.status !== "paused")) return notLive;
    const def = this.phases.find((p) => p.id === phase);
    const label = def?.label ?? phase;
    const built = this.stepEvidence(phase);
    if (!built) return null;
    if (built.empty) return emptyStepRefusalText(label);
    const run = this.checkRun(phase);
    const before = run.done;
    if (run.settled) await settleWithin(run.settled, RECHECK_WAIT_MS);
    else if (run.lastKey !== evidenceKey(built.evidence)) await settleWithin(this.checkStep(phase), RECHECK_WAIT_MS);
    if (this.disposed || (this.session.status !== "live" && this.session.status !== "paused")) return notLive;
    if (run.done === before && run.lastKey !== evidenceKey(built.evidence)) return null;
    const result = passCheck(def ?? {}, this.session.checklist[phase] ?? [], this.session.stepChecks[phase]);
    return result.ok ? null : passRefusalText(label, result);
  }

  private async recheckStep(phase: string): Promise<ToolOutput> {
    const items = this.session.checklist[phase] ?? [];
    const label = this.phases.find((p) => p.id === phase)?.label ?? phase;
    if (items.length === 0) return textOutput(`${label} has no checklist.`, true);
    const run = this.checkRun(phase);
    const before = run.freshDone;
    const settled = await settleWithin(this.checkStep(phase, { fresh: true }), RECHECK_WAIT_MS);
    const check = this.session.stepChecks[phase];
    if (!settled || run.freshDone === before || check?.checkedAt == null) {
      return textOutput(`The check of ${label} did not finish. The list keeps its last reading.`, true);
    }
    return textOutput(`The checker read ${label} again at ${formatClock(check.checkedAt)}. It is evidence for you; he does not see it.\n${stepReadingText(items, check)}`);
  }

  private readCodeOutput(content: string): ToolOutput {
    const check = this.lastCheck;
    const checkText = check ? `${checkSummaryText(summarizeDiagnostics(check.diagnostics))}\n${diagnosticsText(check.diagnostics)}` : "not run yet";
    return textOutput(`${content.trim() ? numberedCode(content) : "(the file is empty)"}\n\nlast check: ${checkText}`);
  }

  /** A "Teach me this" message names a gap, so the room records it without waiting for the coach to do so. */
  private noteTeachRequest(text: string): void {
    const gaps = this.session.scorecard?.gaps ?? [];
    const title = gapForTeachMessage(gaps, text);
    if (title === null) return;
    // Asking again reopens a gap that was done or left for later, so the page makes it the current one at once.
    this.recordGap(title, "started", "candidate");
    this.announceGap(title);
  }

  /**
   * Writes a gap's progress. The first record decides `by`, and later ones only move the state, so the page can
   * tell a gap he asked for from one the coach opened. Computed keys never touch the prototype.
   */
  private recordGap(title: string, state: GapProgress["state"], by: GapProgress["by"]): void {
    const prior = this.session.gapProgress[title];
    this.session.gapProgress = { ...this.session.gapProgress, [title]: { by: prior?.by ?? by, state, at: new Date().toISOString() } };
    this.saveSoon();
    this.sendState();
  }

  /** Adds the "Now on" divider unless that gap is already the latest one announced, so a repeat click stays quiet. */
  private announceGap(title: string): void {
    const text = gapDividerText(title);
    const last = this.session.transcript.findLast((e) => e.channel === "coach" && e.kind === "gap");
    if (last?.text === text) return;
    this.addEntry({ channel: "coach", role: "system", kind: "gap", text });
  }

  private setGap(title: string, state: GapProgress["state"]): ToolOutput {
    const gaps = this.session.scorecard?.gaps ?? [];
    const match = gaps.find((gap) => gap.title === title.trim());
    if (!match) return textOutput("No gap has that title. Use a title exactly as the scorecard lists it.", true);
    this.recordGap(match.title, state, "coach");
    if (state === "started") this.announceGap(match.title);
    return textOutput(`Recorded: ${state}.`);
  }

  private coachTools(ch: ChannelState): RoomTool[] {
    const tools: RoomTool[] = [
      defineTool(
        "set_gap",
        "Record where you are on one scorecard gap. Call it with started in the same turn you open a gap, with taught once his answer to your check holds, and with core_only when he chose the core idea now and the rest as a topic session later. The title must match the scorecard exactly.",
        { title: z.string().min(1).max(300), state: z.enum(["started", "taught", "core_only"]) },
        async ({ title, state }) => this.setGap(title, state),
      ),
      defineTool(
        "read_transcript",
        "Read the round's transcript: interviewer and candidate lines and round events, with their mm:ss times. Give at (mm:ss) to read only the few minutes around one moment.",
        { at: z.string().max(10).optional() },
        async ({ at }) => {
          const atMs = at === undefined ? null : parseStamp(at);
          if (at !== undefined && atMs === null) return textOutput("Give at as mm:ss, such as 12:05.", true);
          return textOutput(roundTranscript(this.session.transcript, atMs));
        },
      ),
      defineTool("view_whiteboard", "See the candidate's final whiteboard: an image plus its exact text form.", {}, async () => {
        ch.boardSeen = this.session.board.version;
        const png = await this.deps.store.readFinalPng(this.session.id);
        if (!png) return textOutput(`No image of the final board was saved, so here is the text form only.\n\n${this.boardText()}`);
        return {
          content: [
            { type: "image", data: png.toString("base64"), mimeType: "image/png" },
            { type: "text", text: this.boardText() },
          ],
        };
      }),
    ];
    if (this.session.track === "lld") {
      tools.push(
        defineTool("read_code", "Read the candidate's C++ file as it is now, with line numbers.", {}, async () => {
          const content = (await this.readAttemptFile()) ?? (await this.deps.store.readFinalCode(this.session.id)) ?? "";
          return this.readCodeOutput(content);
        }),
        defineTool("run_code", "Compile and run the candidate's program as it is now and see the output.", {}, async () => {
          if (!this.codeAbs) return textOutput("The code file is not available.", true);
          const result = await this.deps.runner.compileAndRun(this.codeAbs);
          return textOutput(runResultText(result));
        }),
      );
    }
    return tools;
  }

  /** Asks the open pages for an image of the board, or of one frame of it. */
  private requestPng(frameId?: string): Promise<Buffer | null> {
    const peers = [...this.peers];
    if (peers.length === 0) return Promise.resolve(null);
    const requestId = randomId(8);
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(null), PNG_TIMEOUT_MS);
      const finish = (png: Buffer | null) => {
        clearTimeout(timer);
        this.pngWaits.delete(requestId);
        resolve(png);
      };
      this.pngWaits.set(requestId, { remaining: peers.length, finish });
      for (const p of peers) p.send({ type: "board.png.request", requestId, ...(frameId ? { frameId } : {}) });
    });
  }

  private startWatcher(): void {
    if (!this.codeAbs || this.watcher) return;
    const file = basename(this.codeAbs);
    const trigger = () => {
      if (this.watchTimer) clearTimeout(this.watchTimer);
      this.watchTimer = setTimeout(() => void this.onExternalChange(), WATCH_DEBOUNCE_MS);
    };
    try {
      // Editors save by writing a temp file and renaming it over the old one, so the folder is watched, not the file.
      this.watcher = watch(dirname(this.codeAbs), { persistent: false }, (_event, name) => {
        if (name !== null && name.toString() !== file) return;
        trigger();
      });
      this.watcher.on("error", (err) => this.log.warn(`File watcher stopped for session ${this.session.id}`, err));
    } catch (err) {
      this.log.warn(`Could not watch the attempt file for session ${this.session.id}`, err);
    }
    // Polling fallback ensures external edits on host-mounted shared volumes reach the container.
    try {
      watchFile(this.codeAbs, { interval: 250 }, (curr, prev) => {
        if (curr.mtimeMs !== prev.mtimeMs) trigger();
      });
    } catch {
      // Ignore polling watch errors
    }
  }

  private stopWatcher(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.codeAbs) unwatchFile(this.codeAbs);
    if (this.watchTimer) clearTimeout(this.watchTimer);
    this.watchTimer = null;
  }

  private rememberOwnHash(hash: string): void {
    this.ownHashes.push(hash);
    if (this.ownHashes.length > 16) this.ownHashes.shift();
  }

  private async readAttemptFile(): Promise<string | null> {
    if (!this.codeAbs) return null;
    try {
      return await readFile(this.codeAbs, "utf8");
    } catch {
      return null;
    }
  }

  /** Credits the lines a change added to the design step on the rail, the evidence that step's checklist reads. */
  private creditStepCode(before: string, after: string): void {
    const s = this.session;
    if (s.status !== "live" && s.status !== "paused") return;
    if (codeScopeFor(s.track, s.phase) !== "step") return;
    const added = newLines(before, after);
    const had = s.stepCode[s.phase] ?? [];
    if (added.length === 0 && had.length === 0) return;
    s.stepCode = { ...s.stepCode, [s.phase]: withStepLines(had, added, after) };
  }

  private async onExternalChange(): Promise<void> {
    const s = this.session;
    if (!s.code || !this.codeAbs || (s.status !== "live" && s.status !== "paused")) return;
    await this.codeWrites;
    const content = await this.readAttemptFile();
    if (content === null) return;
    if (Buffer.byteLength(content) > MAX_EXTERNAL_CODE_BYTES) {
      this.warnOnce("big-code", `The attempt file of session ${s.id} is too large to load`);
      return;
    }
    const hash = sha256Hex(content);
    // Our own atomic writes fire this watcher too; any content we wrote recently is not an outside edit.
    if (hash === this.codeHash || this.ownHashes.includes(hash)) return;
    this.codeHash = hash;
    this.creditStepCode(this.codeContent, content);
    this.codeContent = content;
    s.code.version += 1;
    this.markActive();
    this.saveSoon();
    this.broadcast({ type: "code.external", version: s.code.version, content });
    this.scheduleCheck();
  }

  private async onCodeUpdate(version: number, content: string, peer: Peer): Promise<void> {
    const s = this.session;
    if (s.track !== "lld" || !s.code) throw new UserError("not_lld", "This round has no code file.");
    if (s.status !== "live" && s.status !== "paused" && !this.acceptsLateEdit()) throw new UserError("not_live", "The round is over, so the code file is frozen.");
    if (!this.codeAbs) throw new UserError("no_file", "The code file is not available.");
    if (version <= s.code.version) {
      // The page cannot tell a dropped update from a slow one, so it is told which version the server holds.
      peer.send({ type: "code.rejected", version, held: s.code.version });
      return;
    }
    if (Buffer.byteLength(content) > LIMITS.codeBytes) throw new UserError("too_large", "The code is too large to save.");
    s.code.version = version;
    this.markActive();
    this.creditStepCode(this.codeContent, content);
    this.codeContent = content;
    const hash = sha256Hex(content);
    if (hash !== this.codeHash) {
      this.codeHash = hash;
      this.rememberOwnHash(hash);
      const path = this.codeAbs;
      this.codeWrites = this.codeWrites.catch(() => undefined).then(() => atomicWrite(path, content));
      await this.codeWrites;
    }
    this.saveSoon();
    this.scheduleCheck();
  }

  private scheduleCheck(): void {
    if (this.checkTimer) clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => void this.runCheck(), CHECK_DEBOUNCE_MS);
  }

  private async runCheck(): Promise<void> {
    if (!this.codeAbs || !this.session.code || this.disposed) return;
    if (this.checkRunning) {
      this.checkAgain = true;
      return;
    }
    this.checkRunning = true;
    try {
      await this.codeWrites;
      const version = this.session.code.version;
      const result = await this.deps.runner.syntaxCheck(this.codeAbs);
      this.lastCheck = { version, diagnostics: result.diagnostics };
      this.broadcast({ type: "code.diagnostics", version, diagnostics: result.diagnostics });
    } catch (err) {
      this.warnOnce("syntax-check", `Syntax check failed in session ${this.session.id}`, err);
    } finally {
      this.checkRunning = false;
      if (this.checkAgain) {
        this.checkAgain = false;
        this.scheduleCheck();
      }
    }
  }

  private async onCodeRun(): Promise<void> {
    const s = this.session;
    if (s.track !== "lld" || !s.code) throw new UserError("not_lld", "This round has no code file.");
    if (s.status !== "live" && s.status !== "paused") throw new UserError("not_live", "The round is over.");
    this.markActive();
    await this.runProgram("candidate");
  }

  private async runProgram(by: "candidate" | "interviewer"): Promise<RunResult> {
    const code = this.session.code;
    if (!code || !this.codeAbs) throw new UserError("no_file", "The code file is not available.");
    if (this.programRunning) throw new UserError("busy", "A run is already in progress.");
    this.programRunning = true;
    try {
      await this.codeWrites;
      const raw = await this.deps.runner.compileAndRun(this.codeAbs);
      const result: RunResult = { at: this.roundNow(), ...raw };
      code.lastRun = result;
      if (by === "candidate") this.pendingRun = result;
      this.addEntry({
        channel: "interview",
        role: "system",
        kind: "run",
        text: `${by === "candidate" ? "Ran the program" : "The interviewer ran the program"}: ${runSummary(result)}.`,
      });
      this.broadcast({ type: "code.run.result", result });
      return result;
    } finally {
      this.programRunning = false;
    }
  }

  private acceptsLateEdit(): boolean {
    return this.lateEditsUntil !== null && Date.now() < this.lateEditsUntil;
  }

  /** Waits out the time-up grace, after which no edit reaches the board or the code file. */
  private async closeLateEdits(): Promise<void> {
    const left = this.lateEditsUntil === null ? 0 : this.lateEditsUntil - Date.now();
    if (left > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        timer.unref?.();
      });
    }
    this.lateEditsUntil = null;
  }

  private progress(stage: DebriefStage, detail?: string): void {
    const msg: Extract<ServerMsg, { type: "debrief.progress" }> = { type: "debrief.progress", stage, ...(detail ? { detail } : {}) };
    this.lastProgress = msg;
    this.broadcast(msg);
  }

  private async startDebrief(): Promise<void> {
    const s = this.session;
    if (this.debriefRunning || this.disposed) return;
    if (s.status !== "ended" && s.status !== "failed") return;
    this.debriefRunning = true;
    try {
      await this.closeLateEdits();
      if (this.disposed) return;
      this.closeChannel(this.interview);
      this.stopWatcher();
      s.status = "debriefing";
      await this.saveNow();
      this.sendState();

      this.progress("collecting", "Saving the final board and code");
      // The page sends its last edit and the end together, so the copy on disk may still be on its way.
      await Promise.allSettled([this.codeWrites, this.boardWrites]);
      const fresh = await this.requestPng();
      if (fresh) await this.deps.store.writeFinalPng(s.id, fresh);
      const image = fresh ?? (await this.deps.store.readFinalPng(s.id));
      let finalCode: string | null = null;
      if (s.track === "lld") {
        finalCode = (await this.readAttemptFile()) ?? (await this.deps.store.readFinalCode(s.id));
        if (finalCode !== null) await this.deps.store.writeFinalCode(s.id, finalCode);
      }

      let tester: TesterOutput | null = null;
      if (s.track === "lld") {
        this.progress("testing", "Running the demo scenarios");
        tester = await this.runTester(finalCode);
      }

      this.progress("judging", "Scoring the round");
      const timing = phaseTiming(s, this.plan, this.roundNow());
      const targets = pinTargets(this.boardElements);
      const input: JudgeInput = {
        session: s,
        problem: this.problem,
        timing,
        finalGraphText: s.board.graphText,
        finalCode,
        tester,
        hasImage: image !== null,
        // Sent even for an empty board, so the judge reads that there is nothing to pin rather than guessing.
        pinTargets: pinTargetsText(targets),
      };
      let { card, pins } = await this.runJudge(input, image, null, tester, 2);

      this.progress("checking", "Checking the evidence quotes");
      const sources = { candidate: candidateText(s), board: s.board.graphText, code: finalCode ?? "" };
      const emptySources = { candidate: "", board: "", code: "" };
      const bySteps = stepSources(s, finalCode, { endMs: this.roundNow(), stepBoard: this.stepBoardText() });
      const stepSourcesFor = (phase: string) => bySteps[phase] ?? emptySources;
      let checks = this.safeCheckQuotes(card, sources);
      let stepChecks = this.safeCheckStepQuotes(card, stepSourcesFor);
      if (failedRatio(checks, stepChecks) > 0.3) {
        try {
          const second = await this.runJudge(input, image, failedQuoteNote(card, checks, stepChecks), tester, 1);
          const secondChecks = this.safeCheckQuotes(second.card, sources);
          const secondStepChecks = this.safeCheckStepQuotes(second.card, stepSourcesFor);
          if (failedRatio(secondChecks, secondStepChecks) < failedRatio(checks, stepChecks)) {
            card = second.card;
            pins = second.pins;
            checks = secondChecks;
            stepChecks = secondStepChecks;
          }
        } catch (err) {
          this.log.warn(`Second judge pass failed in session ${s.id}; keeping the first`, err);
        }
      }
      const ruled = enforceRules(card, { mode: s.mode, track: s.track, tester });
      const scorecard: Scorecard = {
        ...ruled,
        ...(s.mode === "guided" ? { readiness: computeReadiness(s, this.plan) } : {}),
        quoteChecks: checks,
        stepQuoteChecks: stepChecks,
        phaseTiming: timing,
        lintIssues: this.safeLint(ruled),
      };
      s.scorecard = scorecard;
      s.pins = [...s.pins.filter((p) => p.by !== "judge"), ...pins];
      s.status = "debriefed";
      await this.saveNow();
      this.progress("done");
      this.broadcast({ type: "debrief.ready", scorecard });
      this.sendState();
    } catch (err) {
      this.log.error(`Debrief failed in session ${s.id}`, err instanceof DriverError ? err.detail : err);
      s.status = "failed";
      await this.saveNow();
      this.sendState();
      this.broadcast({ type: "error", code: "debrief_failed", message: "The debrief could not finish. Press Retry to try again." });
    } finally {
      this.debriefRunning = false;
    }
  }

  private async runTester(finalCode: string | null): Promise<TesterOutput | null> {
    const s = this.session;
    if (finalCode === null) return { compiled: false, scenarios: [], notes: "There was no code file to test." };
    const finalPath = this.deps.store.finalCodePath(s.id);
    let runs = 0;
    const tools: RoomTool[] = [
      defineTool("read_code", "Read the candidate's final C++ file with line numbers.", {}, async () => textOutput(numberedCode(finalCode))),
      defineTool(
        "run_harness",
        "Compile the candidate's file together with your harness and run it with address and undefined-behaviour sanitizers. Your harness must define int main(); the candidate's own main() is renamed to candidate_main, so it does not clash. Returns the compile diagnostics and the output.",
        { harness: z.string().min(1).max(100_000) },
        async ({ harness }) => {
          runs += 1;
          if (runs > MAX_HARNESS_RUNS) return textOutput("No more harness runs are allowed. Report the results you have.", true);
          return textOutput(runResultText(await this.deps.runner.runHarness(finalPath, harness)));
        },
      ),
    ];
    const text = [
      "<demo_scenarios>",
      this.problem.sections["Demo scenarios"] ?? "(none)",
      "</demo_scenarios>",
      "<code>",
      numberedCode(finalCode),
      "</code>",
      "Adapt each scenario to the candidate's own classes and methods, write one harness, and run it with run_harness. If your harness has errors, fix them and run again, up to three times. Then report every scenario. If the candidate's file does not compile on its own, report compiled as false.",
    ].join("\n");
    for (let attempt = 0; attempt < 2; attempt++) {
      runs = 0;
      try {
        const res = await this.deps.driver.runOnce({
          role: "tester",
          ...this.roleModel("tester"),
          systemPrompt: async () => this.deps.prompts.render("tester-lld", { ...(await this.baseVars()), problem_brief: this.problem.body }),
          tools,
          fake: { problem: this.problem, track: s.track, mode: s.mode },
          usage: { sessionId: s.id, problemId: s.problemId, track: s.track, mode: s.mode },
          turn: { text, meta: { kind: "oneshot" } },
          output: { schema: TesterOutputSchema, jsonSchema: toApiSchema(TesterOutputSchema), fallbackJsonSchema: toCompatSchema(TesterOutputSchema) },
          maxTurns: 24,
        });
        if (res.output) {
          this.log.info(`tester finished in ${res.stats.durationMs} ms for session ${s.id}`);
          return tidyTesterOutput(res.output);
        }
      } catch (err) {
        this.log.warn(`Tester attempt ${attempt + 1} failed in session ${s.id}: ${err instanceof DriverError ? err.detail : describeError(err)}`);
      }
    }
    return null;
  }

  private async runJudge(
    input: JudgeInput,
    image: Buffer | null,
    note: string | null,
    tester: TesterOutput | null,
    attempts: number,
  ): Promise<{ card: JudgedCard; pins: BoardPin[] }> {
    const s = this.session;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      // Each attempt pins afresh, so the pins always belong to the scorecard they came with.
      const pins: BoardPin[] = [];
      const tools: RoomTool[] = [
        defineTool(
          "pin_element",
          "Attach a one-sentence note to a box or arrow on the candidate's board: verdict held for a part that met the bar, gap where the most important missing piece belongs. Use an id from <pin_targets>.",
          { elementId: z.string().min(1).max(64), note: z.string().min(1).max(LIMITS.pinNoteChars), verdict: z.enum(["held", "gap"]) },
          async ({ elementId, note: text, verdict }) => this.addPin({ elementId, note: text, tone: verdict, by: "judge" }, pins),
        ),
      ];
      try {
        const res = await this.deps.driver.runOnce({
          role: "judge",
          ...this.roleModel("judge"),
          systemPrompt: async () =>
            this.deps.prompts.render(`judge-${s.track}` as PromptName, {
              ...(await this.baseVars()),
              problem_brief: this.problem.body,
              rubric: await this.deps.prompts.rubric(s.track),
            }),
          tools,
          fake: { problem: this.problem, track: s.track, mode: s.mode, candidateLines: candidateLines(s), tester, pinTargets: () => pinTargets(this.boardElements) },
          usage: { sessionId: s.id, problemId: s.problemId, track: s.track, mode: s.mode },
          turn: {
            text: judgeMessage(input, note),
            ...(image ? { images: [{ data: image.toString("base64"), mimeType: "image/png" as const }] } : {}),
            meta: { kind: "oneshot" },
          },
          output: { schema: ScorecardSchema, jsonSchema: toApiSchema(ScorecardSchema), fallbackJsonSchema: toCompatSchema(ScorecardSchema) },
          maxTurns: 12,
        });
        if (!res.output) throw new DriverError("The judge returned no scorecard.");
        this.log.info(`judge finished in ${res.stats.durationMs} ms for session ${s.id}`);
        return { card: res.output, pins };
      } catch (err) {
        lastErr = err;
        this.log.warn(`Judge attempt ${attempt + 1} failed in session ${s.id}: ${err instanceof DriverError ? err.detail : describeError(err)}`);
      }
    }
    throw lastErr ?? new Error("The judge failed");
  }

  private safeCheckQuotes(card: JudgedCard, sources: { candidate: string; board: string; code: string }): QuoteCheck[] {
    try {
      return checkQuotes(card, sources);
    } catch (err) {
      this.warnOnce("quotes", "Quote checks are unavailable", err);
      return [];
    }
  }

  private safeCheckStepQuotes(card: JudgedCard, sources: (phase: string) => { candidate: string; board: string; code: string }): StepQuoteCheck[] {
    try {
      return checkStepQuotes(card, sources);
    } catch (err) {
      this.warnOnce("quotes", "Step quote checks are unavailable", err);
      return [];
    }
  }

  private safeLint(card: JudgedCard): NonNullable<Scorecard["lintIssues"]> {
    try {
      return lintCard(card, lintProse);
    } catch (err) {
      this.warnOnce("lint", "Prose lint is unavailable", err);
      return [];
    }
  }

  private async onDraft(): Promise<void> {
    const s = this.session;
    if (s.status !== "debriefed" || !s.scorecard) throw new UserError("not_ready", "Study notes can be drafted once the debrief is ready.");
    if (this.drafting) throw new UserError("busy", "A draft is already being written.");
    this.drafting = true;
    try {
      const date = localDate();
      const { text, notesFileExists } = await buildScribeInput({ studyRoot: this.deps.config.studyRoot, problem: this.problem, session: s, date });
      const res = await this.deps.driver.runOnce({
        role: "scribe",
        ...this.roleModel("scribe"),
        systemPrompt: async () =>
          this.deps.prompts.render("scribe", { ...(await this.baseVars()), teaching_md: await this.deps.prompts.teachingMd(), max_ops: String(LIMITS.proposalOps) }),
        tools: [],
        fake: { problem: this.problem, scorecard: s.scorecard, notesFileExists, date, mode: s.mode, track: s.track },
        usage: { sessionId: s.id, problemId: s.problemId, track: s.track, mode: s.mode },
        turn: { text, meta: { kind: "oneshot" } },
        output: { schema: ScribeOutputSchema, jsonSchema: toApiSchema(ScribeOutputSchema), fallbackJsonSchema: toCompatSchema(ScribeOutputSchema) },
        maxTurns: 6,
      });
      if (!res.output) throw new DriverError("The scribe returned nothing.");
      const proposal = await planProposal(this.deps.config.studyRoot, s.id, res.output.ops, this.deps.guard);
      await this.deps.store.saveProposal(s.id, proposal);
      // A new draft has saved nothing yet, but the page still needs to know that notes were saved before.
      s.studyNotes = { proposalId: proposal.id, status: proposal.status, appliedCount: 0, savedAt: s.studyNotes?.savedAt ?? null };
      this.saveSoon();
      this.log.info(`scribe drafted ${proposal.ops.length} ops in ${res.stats.durationMs} ms for session ${s.id}`);
      this.broadcast({ type: "bookkeeping.proposal", proposal });
    } catch (err) {
      if (err instanceof UserError) throw err;
      this.log.error(`Drafting study notes failed in session ${s.id}`, err instanceof DriverError ? err.detail : err);
      throw new UserError("draft_failed", err instanceof DriverError ? err.message : "The study notes could not be drafted. Try again.");
    } finally {
      this.drafting = false;
    }
  }

  /** Saves run one at a time, so a second Save reads the draft the first one left and cannot write it twice. */
  private onApply(proposalId: string, opIds: string[]): Promise<void> {
    const run = this.applying.then(() => this.applyNow(proposalId, opIds));
    this.applying = run.catch(() => undefined);
    return run;
  }

  private async applyNow(proposalId: string, opIds: string[]): Promise<void> {
    const s = this.session;
    const proposal = await this.deps.store.loadProposal(s.id, proposalId);
    if (!proposal || proposal.sessionId !== s.id) throw new UserError("no_proposal", "That draft no longer exists. Draft again.");
    // A repeated Save of a draft that is already in the files writes nothing; resending it settles the page that asked.
    if (proposal.status === "applied") {
      this.broadcast({ type: "bookkeeping.proposal", proposal });
      return;
    }
    if (proposal.status !== "draft") throw new UserError("not_draft", "The files changed since the draft. Draft again.");
    try {
      const result = await applyProposal(this.deps.config.studyRoot, proposal, opIds, this.deps.guard);
      await this.deps.store.saveProposal(s.id, result.proposal);
      s.studyNotes = {
        proposalId: proposalId,
        status: result.proposal.status,
        appliedCount: (s.studyNotes?.proposalId === proposalId ? s.studyNotes.appliedCount : 0) + result.applied.length,
        savedAt: result.applied.length > 0 ? new Date().toISOString() : (s.studyNotes?.savedAt ?? null),
      };
      await this.saveNow();
      this.sendState();
      this.log.info(`applied ${result.applied.length} ops, ${result.failed.length} failed, for session ${s.id}`);
      this.broadcast({ type: "bookkeeping.applied", proposalId, applied: result.applied, failed: result.failed });
      this.broadcast({ type: "bookkeeping.proposal", proposal: result.proposal });
    } catch (err) {
      this.log.error(`Saving study notes failed in session ${s.id}`, err);
      throw new UserError("apply_failed", "The study notes could not be saved. Nothing was written. Draft again.");
    }
  }

  private addEntry(
    e: { id?: string; channel: Channel; role: TranscriptEntry["role"]; text: string; kind?: TranscriptEntry["kind"]; hidden?: boolean },
    clientMsgId?: string,
  ): TranscriptEntry {
    const entry: TranscriptEntry = {
      id: e.id ?? newEntryId(),
      at: this.roundNow(),
      wall: new Date().toISOString(),
      channel: e.channel,
      role: e.role,
      text: e.text,
      ...(e.kind ? { kind: e.kind } : {}),
      ...(e.hidden ? { hidden: true } : {}),
    };
    this.session.transcript.push(entry);
    if (entry.channel === "interview" && entry.role === "interviewer" && !entry.hidden) this.spokeAt = entry.at;
    void this.saveNow();
    if (!entry.hidden) this.broadcast({ type: "chat.message", entry, ...(clientMsgId ? { clientMsgId } : {}) });
    return entry;
  }

  private saveNow(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    return this.deps.store.save(this.session).catch((err) => this.log.error(`Could not save session ${this.session.id}`, err));
  }

  private saveSoon(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.saveNow();
    }, 1_000);
  }

  private broadcast(msg: ServerMsg): void {
    for (const p of this.peers) p.send(msg);
  }

  private sendState(): void {
    if (this.peers.size === 0) return;
    this.broadcast({ type: "session.state", session: this.publicSession() });
  }

  private warnOnce(key: string, message: string, err?: unknown): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.log.warn(message, err);
  }
}
