import type { ClientMsg, ServerMsg } from "../../shared/protocol";
import type { Proposal, PublicSession, RunResult, TranscriptEntry } from "../../shared/types";
import type { CompileDiagnostic } from "../../shared/types";
import type { ServerHandler, SocketLike, SocketStatus } from "../backend";
import type { LoadedSession, SessionSource } from "../session/types";
import { roundMsAt } from "../lib/timing";
import { LLD_DIAGNOSTICS, LLD_GOOD_RUN } from "./sessions";

declare global {
  interface Window {
    /** What the scripted server saw from the page, for checking the round trips by hand. */
    __fixtureLog?: { type: string; detail?: unknown }[];
    /** Moves the rail the way the interviewer does, so the page's reaction can be tried by hand. */
    __fixtureMovePhase?: (phase: string) => void;
    /** Drops every socket for `ms`; whatever the server sends meanwhile is lost, as on a real drop. */
    __fixtureDrop?: (ms: number) => void;
    /** Changes the attempt file the way an outside editor does. */
    __fixtureEditFile?: (content: string) => void;
    /** The code file as the scripted server holds it. */
    __fixtureCode?: () => { version: number; content: string } | null;
  }
}

export interface FakeServerOptions {
  session: PublicSession;
  board: Record<string, unknown>[] | null;
  code: { path: string; content: string; version: number } | null;
  boardImageUrl: string;
  /** The session as it looks once the debrief is done. Without it, ending a round does nothing more. */
  debrief?: PublicSession;
  proposal?: Proposal;
  staleOnApply?: boolean;
  /** The interviewer reports this error as soon as the page connects. */
  agentError?: string;
  /** The socket never opens, as when the server is down. */
  offline?: boolean;
  /** Time runs out a few seconds after the page connects, so the closing line and the hand-over can be seen. */
  timeUp?: boolean;
}

const INTERVIEWER_REPLY =
  "Okay. Now suppose the cache tier is gone for an hour. What does that do to the database, and what would you do about it?";
const COACH_REPLY =
  "Good. A crashed server leaves its block unused, and that is fine.\n\nThe code space is huge, so a few thousand wasted ids cost nothing. The real risk is the opposite: **reusing** an id. A server must never restart with an old block.\n\n```\n coordinator: next block = 5000\n server A takes 3000..3999   (crashes at 3412)\n server B takes 4000..4999\n restart A -> asks the coordinator -> gets 5000..5999\n```\n\nWhat does the coordinator need to store so a restart never hands out an old block?";

function log(type: string, detail?: unknown): void {
  (window.__fixtureLog ??= []).push({ type, detail });
}

export class FakeServer {
  session: PublicSession;
  private readonly sockets = new Set<FakeSocket>();
  private counter = 0;
  private code: { version: number; content: string } | null;
  private readonly busy = { interview: false, coach: false };

  constructor(private readonly options: FakeServerOptions) {
    this.session = options.session;
    this.code = options.code ? { version: options.code.version, content: options.code.content } : null;
  }

  /** The hooks a scripted check uses to drop the connection and edit the file from outside. */
  installHooks(): void {
    window.__fixtureDrop = (ms) => {
      for (const socket of [...this.sockets]) socket.drop(ms);
    };
    window.__fixtureEditFile = (content) => {
      if (!this.code) return;
      this.code = { version: this.code.version + 1, content };
      log("code.external", { version: this.code.version });
      this.emit({ type: "code.external", version: this.code.version, content });
    };
    window.__fixtureCode = () => (this.code ? { ...this.code } : null);
  }

  source(): SessionSource {
    const { board, code, boardImageUrl } = this.options;
    const load = async (): Promise<LoadedSession> => ({
      session: this.session,
      board: board ? { version: 14, elements: board } : null,
      code: code ? { version: code.version, content: code.content, path: code.path } : null,
    });
    return {
      id: this.session.id,
      load,
      fetchSession: async () => this.session,
      fetchCode: async () => (code && this.code ? { ...this.code, path: code.path } : Promise.reject(new Error("no code"))),
      createSocket: () => new FakeSocket(this),
      boardImageUrl: () => boardImageUrl,
    };
  }

  get offline(): boolean {
    return this.options.offline === true;
  }

  attach(socket: FakeSocket): void {
    this.sockets.add(socket);
  }

  detach(socket: FakeSocket): void {
    this.sockets.delete(socket);
  }

  /** Delivery is asynchronous, like a real socket, so a reply never arrives inside the call that caused it. */
  private emit(msg: ServerMsg): void {
    setTimeout(() => {
      for (const socket of this.sockets) socket.deliver(msg);
    }, 0);
  }

  private later(ms: number, fn: () => void): void {
    setTimeout(fn, ms);
  }

  private nowRound(): number {
    return roundMsAt(this.session.clock, Date.now());
  }

  private addEntry(channel: "interview" | "coach", role: TranscriptEntry["role"], text: string, id?: string): TranscriptEntry {
    const entry: TranscriptEntry = { id: id ?? `fx-e${++this.counter}`, at: this.nowRound(), wall: new Date().toISOString(), channel, role, text };
    this.session = { ...this.session, transcript: [...this.session.transcript, entry] };
    return entry;
  }

  private stream(channel: "interview" | "coach", text: string): void {
    this.busy[channel] = true;
    this.emit({ type: "agent.status", channel, state: "thinking" });
    const id = `fx-m${++this.counter}`;
    const chunks = text.match(/.{1,28}(\s|$)/gs) ?? [text];
    this.later(450, () => {
      chunks.forEach((chunk, index) => {
        this.later(index * 70, () => this.emit({ type: "chat.delta", channel, messageId: id, textDelta: chunk }));
      });
      this.later(chunks.length * 70 + 60, () => {
        const entry = this.addEntry(channel, channel === "coach" ? "coach" : "interviewer", text, id);
        this.emit({ type: "chat.message", entry });
        this.busy[channel] = false;
        this.emit({ type: "agent.status", channel, state: "idle" });
      });
    });
  }

  /** A rail move the candidate did not make. */
  movePhase(phase: string): void {
    const history = [...this.session.phaseHistory, { phase, at: this.nowRound(), by: "interviewer" as const }];
    this.session = { ...this.session, phase, phaseHistory: history };
    this.emit({ type: "phase.changed", phase, by: "interviewer" });
  }

  handle(msg: ClientMsg): void {
    switch (msg.type) {
      case "chat.send": {
        const entry = this.addEntry(msg.channel, "candidate", msg.text);
        this.emit({ type: "chat.message", entry, clientMsgId: msg.clientMsgId });
        this.stream(msg.channel, msg.channel === "coach" ? COACH_REPLY : INTERVIEWER_REPLY);
        break;
      }
      case "phase.set": {
        const phase = msg.phase;
        const history = [...this.session.phaseHistory, { phase, at: this.nowRound(), by: "candidate" as const }];
        this.session = { ...this.session, phase, phaseHistory: history };
        this.emit({ type: "phase.changed", phase, by: "candidate" });
        this.emit({ type: "session.state", session: this.state() });
        break;
      }
      case "board.update":
        log("board.update", { version: msg.version, elements: msg.elements.length });
        break;
      case "code.update": {
        // Like the real server, an update that is not newer than the file is dropped without a reply.
        if (this.code && msg.version <= this.code.version) {
          log("code.update.dropped", { version: msg.version, held: this.code.version });
          break;
        }
        if (this.code) this.code = { version: msg.version, content: msg.content };
        log("code.update", { version: msg.version, length: msg.content.length });
        this.later(500, () => this.emit({ type: "code.diagnostics", version: msg.version, diagnostics: this.diagnosticsFor(msg.content) }));
        this.lastCode = msg.content;
        break;
      }
      case "code.run": {
        log("code.run");
        const diagnostics = this.diagnosticsFor(this.lastCode ?? this.options.code?.content ?? "");
        const at = this.nowRound();
        const result: RunResult =
          diagnostics.some((d) => d.severity === "error")
            ? { at, compile: { ok: false, diagnostics, stderr: diagnostics.map((d) => `${d.line}:${d.column}: ${d.severity}: ${d.message}`).join("\n"), durationMs: 780 }, run: null }
            : { ...LLD_GOOD_RUN, at };
        this.later(700, () => {
          this.session = this.session.code ? { ...this.session, code: { ...this.session.code, lastRun: result } } : this.session;
          this.emit({ type: "code.run.result", result });
        });
        break;
      }
      case "session.pause": {
        this.session = { ...this.withClock({ pauseStartedAt: new Date().toISOString() }, "paused"), pauseReason: "user" };
        this.emit({ type: "session.state", session: this.state() });
        break;
      }
      case "session.resume": {
        const started = this.session.clock.pauseStartedAt;
        const extra = started ? Date.now() - Date.parse(started) : 0;
        this.session = this.withClock({ pauseStartedAt: null, pausedMs: this.session.clock.pausedMs + extra }, "live");
        this.session = { ...this.session, pauseReason: null };
        this.emit({ type: "agent.status", channel: "interview", state: "idle" });
        this.emit({ type: "session.state", session: this.state() });
        break;
      }
      case "guided.feedback":
        this.stream("interview", "This step holds up. The numbers lead to a decision. One thing is missing: say what the cache holds and how big that set is.");
        break;
      case "guided.hint":
        this.stream("interview", "Hint 1. Look at the read path. What would you check first if redirects got slow?");
        break;
      case "session.end":
        this.endRound();
        break;
      case "session.discard":
        log("session.discard");
        this.emit({ type: "session.discarded" });
        break;
      case "bookkeeping.draft":
        log("bookkeeping.draft");
        if (this.options.proposal) {
          const proposal = this.options.proposal;
          this.later(900, () => this.emit({ type: "bookkeeping.proposal", proposal }));
        }
        break;
      case "bookkeeping.apply": {
        log("bookkeeping.apply", { proposalId: msg.proposalId, opIds: msg.opIds });
        this.later(500, () => {
          if (this.options.staleOnApply) {
            this.emit({
              type: "bookkeeping.applied",
              proposalId: msg.proposalId,
              applied: [],
              failed: msg.opIds.map((opId) => ({ opId, reason: "The file changed since the draft; draft again." })),
            });
          } else {
            this.emit({ type: "bookkeeping.applied", proposalId: msg.proposalId, applied: msg.opIds, failed: [] });
          }
        });
        break;
      }
      case "board.png.result":
        log("board.png.result", { requestId: msg.requestId, bytes: msg.pngBase64?.length ?? 0, error: msg.error });
        break;
      case "debrief.retry":
        this.runDebrief();
        break;
      case "hello":
        break;
    }
  }

  private lastCode: string | null = null;

  private diagnosticsFor(content: string): CompileDiagnostic[] {
    return content.includes("lot.exit(") && !content.includes("exit(int") ? LLD_DIAGNOSTICS : [];
  }

  private withClock(patch: Partial<PublicSession["clock"]>, status: PublicSession["status"]): PublicSession {
    return { ...this.session, status, pauseStartedAt: patch.pauseStartedAt ?? null, pausedMs: patch.pausedMs ?? this.session.pausedMs, clock: { ...this.session.clock, ...patch } };
  }

  state(): PublicSession {
    return { ...this.session, clock: { ...this.session.clock, serverNow: new Date().toISOString() } };
  }

  private timeUpScheduled = false;

  greet(socket: FakeSocket): void {
    const state = this.state();
    socket.deliver({ type: "session.state", session: this.code && state.code ? { ...state, code: { ...state.code, version: this.code.version } } : state });
    for (const channel of ["interview", "coach"] as const) {
      if (this.busy[channel]) socket.deliver({ type: "agent.status", channel, state: "thinking" });
    }
    if (this.options.agentError) socket.deliver({ type: "agent.status", channel: "interview", state: "error", error: this.options.agentError });
    if (this.options.timeUp && !this.timeUpScheduled) {
      this.timeUpScheduled = true;
      this.later(3000, () => this.timeIsUp());
    }
  }

  private timeIsUp(): void {
    this.session = { ...this.session, status: "ended", endedAt: new Date().toISOString() };
    const note = this.addEntry("interview", "system", "Time is up.");
    note.kind = "note";
    this.emit({ type: "chat.message", entry: note });
    this.emit({ type: "session.state", session: this.state() });
    this.stream("interview", "That is time. Thanks, we will stop there.");
    this.later(3500, () => this.runDebrief());
  }

  private endRound(): void {
    this.session = { ...this.session, status: "ended", endedAt: new Date().toISOString() };
    this.emit({ type: "session.state", session: this.state() });
    this.runDebrief();
  }

  private runDebrief(): void {
    this.session = { ...this.session, status: "debriefing" };
    this.emit({ type: "session.state", session: this.state() });
    this.emit({ type: "debrief.progress", stage: "collecting", detail: "Asking the page for the final board image" });
    this.emit({ type: "board.png.request", requestId: `fx-png-${++this.counter}` });
    const lld = this.session.track === "lld";
    const stages: ("testing" | "judging" | "checking")[] = lld ? ["testing", "judging", "checking"] : ["judging", "checking"];
    stages.forEach((stage, index) => this.later(1200 * (index + 1), () => this.emit({ type: "debrief.progress", stage, detail: undefined })));
    this.later(1200 * (stages.length + 1), () => {
      const debrief = this.options.debrief;
      if (!debrief?.scorecard) return;
      this.session = { ...this.session, status: "debriefed", scorecard: debrief.scorecard, reference: debrief.reference, steps: debrief.steps, pins: debrief.pins, transcript: [...this.session.transcript, ...debrief.transcript.filter((e) => e.channel === "coach")] };
      this.emit({ type: "debrief.progress", stage: "done" });
      this.emit({ type: "debrief.ready", scorecard: debrief.scorecard });
      this.emit({ type: "session.state", session: this.state() });
    });
  }
}

export class FakeSocket implements SocketLike {
  status: SocketStatus = "closed";
  private readonly handlers = new Map<string, Set<(msg: ServerMsg) => void>>();
  private readonly statusHandlers = new Set<(status: SocketStatus) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly server: FakeServer) {}

  get connected(): boolean {
    return this.status === "open";
  }

  connect(): void {
    if (this.server.offline) {
      this.setStatus("reconnecting");
      return;
    }
    this.setStatus("connecting");
    this.timer = setTimeout(() => {
      this.server.attach(this);
      this.setStatus("open");
      this.server.greet(this);
    }, 40);
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.server.detach(this);
    this.setStatus("closed");
  }

  drop(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.server.detach(this);
    this.setStatus("reconnecting");
    this.timer = setTimeout(() => {
      this.server.attach(this);
      this.setStatus("open");
      this.server.greet(this);
    }, ms);
  }

  on<T extends ServerMsg["type"]>(type: T, handler: ServerHandler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const stored = handler as (msg: ServerMsg) => void;
    set.add(stored);
    return () => {
      set.delete(stored);
    };
  }

  onStatus(handler: (status: SocketStatus) => void): () => void {
    this.statusHandlers.add(handler);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  send(msg: ClientMsg): boolean {
    if (!this.connected) return false;
    this.server.handle(msg);
    return true;
  }

  deliver(msg: ServerMsg): void {
    for (const handler of [...(this.handlers.get(msg.type) ?? [])]) handler(msg);
  }

  private setStatus(status: SocketStatus): void {
    this.status = status;
    for (const handler of [...this.statusHandlers]) handler(status);
  }
}
