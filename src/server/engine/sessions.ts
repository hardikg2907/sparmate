import { deriveChecklist } from "../../shared/checklist";
import { phasesFor, type Mode, type Track } from "../../shared/phases";
import type { Problem } from "../../shared/problem";
import type { CreateSessionRequest } from "../../shared/protocol";
import { gapStep } from "../../shared/gaps";
import type { GapPractice, GapRoundSource, ProblemSummary, PublicSession, Session } from "../../shared/types";
import { createAttemptFile, removeAttemptIfUntouched } from "../study/attempts";
import { findBullet, tableTail } from "../study/tracker";
import { localDate } from "./fsutil";
import type { ProblemCatalog } from "./problems";
import { applyGapPractice } from "./gap-practice";
import { toPublicSession } from "./public";
import { buildProblemSummaries, lastTableRow, trackFromLogRow, type TrackerBullet } from "./recommend";
import { ATTEMPT_PATH, SessionRuntime, type RuntimeDeps } from "./runtime";
import { readStudyFile } from "./scribe";
import { newSessionId, SESSION_ID, type SessionSummary } from "./store";

/** An HTTP-facing failure with a message that is safe to show. */
export class HttpError extends Error {
  override name = "HttpError";
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const DORMANT_AFTER_MS = 10 * 60_000;
/** A round on one debrief gap is short: long enough to teach the gap and try it again. */
const FOCUS_ROUND_MINUTES = 20;

import { CustomProblemJobManager } from "./custom-job";
import type { CustomProblemJobStatus } from "../../shared/protocol";

export interface ManagerDeps extends RuntimeDeps {
  problems: ProblemCatalog;
}

export class SessionManager {
  private readonly runtimes = new Map<string, SessionRuntime>();
  private readonly opening = new Map<string, Promise<SessionRuntime | null>>();
  private readonly discarding = new Map<string, Promise<void>>();
  /** Practised-mark writes per source round, one at a time, so two gap rounds never lose each other's mark. */
  private readonly practiceWrites = new Map<string, Promise<void>>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  readonly customJobs: CustomProblemJobManager;

  constructor(private readonly deps: ManagerDeps) {
    this.customJobs = new CustomProblemJobManager(this.deps);
  }

  /** A round that was live when the server stopped is paused at its last save; an interrupted debrief can be retried. */
  async init(): Promise<void> {
    await this.deps.problems.reload();
    const sessions = await this.deps.store.loadIndex();
    for (const s of sessions) {
      if (s.status === "live") {
        const savedAt = (await this.deps.store.savedAt(s.id)) ?? new Date();
        s.status = "paused";
        s.pauseStartedAt = savedAt.toISOString();
        s.pauseReason = "restart";
        await this.deps.store.save(s);
      } else if (s.status === "debriefing" || s.status === "ended") {
        s.status = "failed";
        await this.deps.store.save(s);
      }
    }
    this.sweepTimer = setInterval(() => this.sweep(), 60_000);
    this.sweepTimer.unref?.();
  }

  history(): SessionSummary[] {
    return this.deps.store.history();
  }

  async open(id: string): Promise<SessionRuntime | null> {
    if (!SESSION_ID.test(id) || this.discarding.has(id)) return null;
    const existing = this.runtimes.get(id);
    if (existing) return existing;
    const pending = this.opening.get(id);
    if (pending) return pending;
    const task = (async () => {
      const session = await this.deps.store.load(id);
      if (!session) return null;
      const problem = await this.problemFor(session);
      if (!problem) {
        this.deps.log.warn(`Session ${id} refers to a problem that no longer loads`);
        return null;
      }
      const rt = new SessionRuntime(this.runtimeDeps(), session, problem);
      await rt.init();
      if (this.discarding.has(id) || this.deps.store.isRemoved(id)) {
        rt.dispose();
        return null;
      }
      this.runtimes.set(id, rt);
      return rt;
    })().finally(() => this.opening.delete(id));
    this.opening.set(id, task);
    return task;
  }

  async publicSession(id: string): Promise<PublicSession | null> {
    if (!SESSION_ID.test(id)) return null;
    const rt = this.runtimes.get(id);
    if (rt) return rt.publicSession();
    const session = await this.deps.store.load(id);
    if (!session) return null;
    return toPublicSession(session, await this.problemFor(session));
  }

  private runtimeDeps(): RuntimeDeps {
    return { ...this.deps, gapPractice: (source, mark, roundId) => this.recordPractice(source, mark, roundId) };
  }

  private recordPractice(source: GapRoundSource, mark: GapPractice | null, roundId: string): Promise<void> {
    const before = this.practiceWrites.get(source.sessionId) ?? Promise.resolve();
    const next = before
      .then(() => this.writePractice(source, mark, roundId))
      .catch((err) => this.deps.log.warn(`Could not record a practised gap on session ${source.sessionId}`, err));
    this.practiceWrites.set(source.sessionId, next);
    void next.finally(() => {
      if (this.practiceWrites.get(source.sessionId) === next) this.practiceWrites.delete(source.sessionId);
    });
    return next;
  }

  /**
   * Writes through the source's runtime when one holds it, since that copy is the one that gets saved. Otherwise it
   * edits the saved copy, and then also any runtime that opened meanwhile from the older file.
   */
  private async writePractice(source: GapRoundSource, mark: GapPractice | null, roundId: string): Promise<void> {
    const id = source.sessionId;
    if (!SESSION_ID.test(id) || this.discarding.has(id)) return;
    await this.opening.get(id);
    const held = this.runtimes.get(id);
    if (held) {
      held.setGapPractice(source.gapTitle, mark, roundId);
      return;
    }
    const saved = await this.deps.store.load(id);
    if (!saved || !applyGapPractice(saved, source.gapTitle, mark, roundId)) return;
    await this.deps.store.save(saved);
    const late = this.runtimes.get(id) ?? (await this.opening.get(id));
    late?.setGapPractice(source.gapTitle, mark, roundId);
  }

  /**
   * The source of a gap round, from the request's untrusted round id: a debriefed round of the same problem whose
   * scorecard holds a gap with this exact title. Anything else gives no source, and the round runs without a link.
   */
  private async gapSource(sourceId: string, title: string, problem: Problem): Promise<GapRoundSource | null> {
    if (!SESSION_ID.test(sourceId)) return null;
    const source = await this.session(sourceId);
    if (!source || source.problemId !== problem.meta.id || !source.scorecard) return null;
    const gap = source.scorecard.gaps.find((g) => g.title === title);
    if (!gap) return null;
    return { sessionId: source.id, gapTitle: gap.title, step: gapStep(problem.meta.track, gap) };
  }

  /** The in-memory copy when a runtime holds it, else the saved one. */
  async session(id: string): Promise<Session | null> {
    if (!SESSION_ID.test(id)) return null;
    return this.runtimes.get(id)?.session ?? (await this.deps.store.load(id));
  }

  private async problemFor(session: Session): Promise<Problem | undefined> {
    let problem = this.deps.problems.get(session.problemId);
    if (!problem) {
      await this.deps.problems.reload();
      problem = this.deps.problems.get(session.problemId);
    }
    return problem;
  }

  async problemSummaries(): Promise<ProblemSummary[]> {
    const problems = await this.deps.problems.reload();
    let tracker = "";
    try {
      tracker = (await readStudyFile(this.deps.config.studyRoot, "TRACKER.md")) ?? "";
    } catch (err) {
      this.deps.log.warn("Could not read TRACKER.md", err);
    }
    const bullets = new Map<string, TrackerBullet | null>();
    let lastLogTrack: Track | null = null;
    if (tracker) {
      try {
        for (const p of problems) {
          if (!p.meta.tracker) continue;
          const m = findBullet(tracker, p.meta.tracker.section, p.meta.tracker.bullet);
          bullets.set(p.meta.id, m ? { lineIndex: m.lineIndex, mark: m.mark, suffix: m.suffix } : null);
        }
        const row = lastTableRow(tableTail(tracker, "# Session Log", 1));
        lastLogTrack = row ? trackFromLogRow(row) : null;
      } catch (err) {
        this.deps.log.warn("Could not read marks from TRACKER.md", err);
      }
    }
    return buildProblemSummaries(problems, { bullets, lastLogTrack }, this.history(), localDate());
  }

  async create(req: CreateSessionRequest): Promise<string> {
    let problem: Problem | undefined;
    if (req.focus && (req.mode !== "guided" || req.customPrompt !== undefined || req.problemId === undefined)) {
      throw new HttpError(400, "A gap round is a guided round on an existing problem.");
    }
    if (req.customPrompt !== undefined) {
      if (req.problemId !== undefined || !req.customTrack) throw new HttpError(400, "A pasted prompt needs a track (HLD or LLD) and no problem id.");
      problem = await this.writeCustomProblem(req.customPrompt, req.customTrack, req.mode);
    } else if (req.problemId !== undefined) {
      await this.deps.problems.reload();
      problem = this.deps.problems.get(req.problemId);
      if (!problem) throw new HttpError(404, "That problem does not exist.");
    } else {
      throw new HttpError(400, "Choose a problem or paste a prompt.");
    }

    const source = req.focus?.sourceSessionId !== undefined ? await this.gapSource(req.focus.sourceSessionId, req.focus.title, problem) : null;
    if (req.focus?.sourceSessionId !== undefined && !source) this.deps.log.warn("A gap round named a source round that does not hold that gap; it runs without a link");
    const settings = this.deps.settings.get();
    const now = new Date();
    let id = newSessionId(problem.meta.id, now);
    while (this.deps.store.exists(id)) id = newSessionId(problem.meta.id, now);
    const durationMin = req.focus ? FOCUS_ROUND_MINUTES : settings.durations[problem.meta.track];
    const firstPhase = phasesFor(problem.meta.track)[0]?.id ?? "requirements";
    const iso = now.toISOString();
    const session: Session = {
      id,
      problemId: problem.meta.id,
      title: problem.meta.title,
      track: problem.meta.track,
      mode: req.mode,
      custom: problem.custom,
      createdAt: iso,
      durationMs: durationMin * 60_000,
      startedAt: iso,
      pausedMs: 0,
      pauseStartedAt: null,
      pauseReason: null,
      endedAt: null,
      status: "live",
      phase: firstPhase,
      phaseHistory: [{ phase: firstPhase, at: 0, by: "candidate" }],
      transcript: [],
      hints: [],
      extension: null,
      board: { version: 0, graphText: "", updatedAt: null },
      stepNotes: {},
      stepNotesVersion: 0,
      stepSummaries: {},
      checklist: deriveChecklist(problem.meta.track, problem.sections),
      stepChecks: {},
      stepCode: {},
      pins: [],
      focus: req.focus ? { title: this.deps.guard.redact(req.focus.title), goodLooksLike: this.deps.guard.redact(req.focus.goodLooksLike), ...(source ? { source } : {}) } : null,
      gapProgress: {},
      studyNotes: null,
      code: null,
      sdk: { interviewerSessionId: null, coachSessionId: null },
      scorecard: null,
      models: { interviewer: settings.models.interviewer, judge: settings.models.judge },
    };
    if (problem.meta.track === "lld") {
      const folder = problem.meta.lldFolder ?? problem.meta.id;
      let path: string;
      try {
        path = await createAttemptFile(this.deps.config.studyRoot, folder, problem.meta.title, localDate(now));
      } catch (err) {
        this.deps.log.error(`Could not create the attempt file for ${problem.meta.id}`, err);
        throw new HttpError(500, "Could not create the code file for this round.");
      }
      if (!ATTEMPT_PATH.test(path)) throw new HttpError(500, "The code file was created in an unexpected place.");
      session.code = { path, version: 0, lastRun: null };
    }
    await this.deps.store.create(session);
    const rt = new SessionRuntime(this.runtimeDeps(), session, problem);
    await rt.init();
    this.runtimes.set(id, rt);
    rt.start();
    this.deps.log.info(`Session ${id} started (${session.track}, ${session.mode})`);
    return id;
  }

  startCustomProblemJob(prompt: string, track: Track): { jobId: string } {
    return this.customJobs.start(prompt, track);
  }

  currentCustomProblemJob(): CustomProblemJobStatus | null {
    return this.customJobs.current();
  }

  getCustomProblemJob(jobId: string): CustomProblemJobStatus | null {
    return this.customJobs.get(jobId);
  }

  cancelCustomProblemJob(jobId: string): CustomProblemJobStatus | null {
    return this.customJobs.cancel(jobId);
  }

  private async writeCustomProblem(prompt: string, track: Track, mode: Mode): Promise<Problem> {
    return this.customJobs.prepareDirect(prompt, track, mode);
  }

  /**
   * Throws the round away: stops its agents and timers, closes its sockets and deletes its folder. An LLD attempt
   * file is deleted only while it holds nothing but its header, because otherwise it holds the candidate's code.
   */
  async discard(id: string): Promise<void> {
    if (!SESSION_ID.test(id)) throw new HttpError(404, "That session does not exist.");
    const running = this.discarding.get(id);
    if (running) return running;
    const task = this.discardNow(id).finally(() => this.discarding.delete(id));
    this.discarding.set(id, task);
    return task;
  }

  /** Ends a live or paused round and starts its debrief, for a round nobody has open. */
  async end(id: string): Promise<void> {
    const rt = await this.open(id);
    if (!rt) throw new HttpError(404, "That session does not exist.");
    const status = rt.statusNow();
    if (status !== "live" && status !== "paused") throw new HttpError(409, "The round has already ended.");
    await rt.endByRequest();
  }

  private async discardNow(id: string): Promise<void> {
    const session = await this.session(id);
    if (!session) throw new HttpError(404, "That session does not exist.");
    if (session.status === "debriefing") throw new HttpError(409, "The debrief is running. Wait for it to finish, then discard the round.");
    const rt = this.runtimes.get(id);
    this.runtimes.delete(id);
    await rt?.discard();
    await this.deps.store.remove(id);
    // A discarded gap round no longer shows that its gap was practised.
    const source = session.focus?.source;
    if (source) await this.recordPractice(source, null, id);
    if (session.track === "lld" && session.code) {
      try {
        const outcome = await removeAttemptIfUntouched(this.deps.config.studyRoot, session.code.path, session.title);
        this.deps.log.info(`Session ${id} discarded; attempt file ${outcome}`);
      } catch (err) {
        this.deps.log.warn(`Session ${id} discarded, but its attempt file could not be checked`, err);
      }
    } else {
      this.deps.log.info(`Session ${id} discarded`);
    }
    rt?.announceDiscard();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, rt] of this.runtimes) {
      if (rt.isDormant() && now - rt.lastActivity > DORMANT_AFTER_MS) {
        rt.dispose();
        this.runtimes.delete(id);
      }
    }
  }

  async shutdown(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.customJobs.abortAll();
    for (const rt of this.runtimes.values()) rt.dispose();
    this.runtimes.clear();
    await this.deps.store.flush();
  }
}
