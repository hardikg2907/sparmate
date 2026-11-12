import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { teachMessage } from "../../shared/gaps";
import { phasePlan } from "../../shared/phases";
import type { Problem } from "../../shared/problem";
import type { ServerMsg } from "../../shared/protocol";
import { DEFAULT_SETTINGS, type Proposal, type Session } from "../../shared/types";
import { APP_ROOT, type ServerConfig } from "./config";
import { DriverError, type Conversation, type ConversationSetup, type Driver, type RoomTool, type UserTurn } from "./driver";
import { createFakeDriver } from "./fake-driver";
import { memoryLogger } from "./log";
import { makeCustomRoot, type TempStudyRoot } from "../study/__fixtures__/studyRoot";
import { planProposal } from "../study/bookkeeping";
import { parseProblem } from "./problems";
import type { PromptLoader } from "./prompts";
import { AWAY_PAUSE_MS, SessionRuntime, type Peer, type RuntimeDeps } from "./runtime";
import type { SettingsStore } from "./settings";
import type { BoardFile, SessionStore } from "./store";

const MIN = 60_000;

class MemoryStore {
  saved: Session | null = null;
  board: BoardFile = { version: 0, elements: [] };
  png: Buffer | null = null;
  code: string | null = null;
  proposals = new Map<string, Proposal>();
  async save(s: Session) {
    this.saved = structuredClone(s);
  }
  async readBoard() {
    return this.board;
  }
  async writeBoard(_id: string, b: BoardFile) {
    this.board = b;
  }
  async writeFinalPng(_id: string, png: Buffer) {
    this.png = png;
  }
  async readFinalPng() {
    return this.png;
  }
  async writeFinalCode(_id: string, c: string) {
    this.code = c;
  }
  finalCodePath() {
    return "/nonexistent/final.cpp";
  }
  async readFinalCode() {
    return this.code;
  }
  async saveProposal(_id: string, p: Proposal) {
    this.proposals.set(p.id, p);
  }
  async loadProposal(_id: string, pid: string) {
    return this.proposals.get(pid) ?? null;
  }
}

async function urlShortener() {
  const file = join(APP_ROOT, "content", "problems", "hld", "c2-url-shortener.md");
  return parseProblem(await readFile(file, "utf8"), file, false);
}

function newSession(mode: Session["mode"]): Session {
  const now = new Date().toISOString();
  return {
    id: "20261029-1000-c2-url-shortener-abcd",
    problemId: "c2-url-shortener",
    title: "URL Shortener",
    track: "hld",
    mode,
    custom: false,
    createdAt: now,
    durationMs: 45 * MIN,
    startedAt: now,
    pausedMs: 0,
    pauseStartedAt: null,
    pauseReason: null,
    endedAt: null,
    status: "live",
    phase: "requirements",
    phaseHistory: [{ phase: "requirements", at: 0, by: "candidate" }],
    transcript: [],
    hints: [],
    extension: null,
    board: { version: 0, graphText: "", updatedAt: null },
    stepNotes: {},
    stepNotesVersion: 0,
    stepSummaries: {},
    checklist: {},
    stepChecks: {},
    stepCode: {},
    pins: [],
    focus: null,
    gapProgress: {},
    studyNotes: null,
    code: null,
    sdk: { interviewerSessionId: null, coachSessionId: null },
    scorecard: null,
    models: { interviewer: "claude-opus-5-5", judge: "claude-opus-5-5" },
  };
}

function setup(driver: Driver, _mode: Session["mode"] = "interview", studyRoot = "/nonexistent") {
  const store = new MemoryStore();
  const deps: RuntimeDeps = {
    config: { studyRoot } as ServerConfig,
    store: store as unknown as SessionStore,
    settings: { get: () => structuredClone(DEFAULT_SETTINGS) } as unknown as SettingsStore,
    driver,
    guard: { findViolations: () => [], redact: (t: string) => t, size: () => 0 },
    runner: {
      syntaxCheck: async () => ({ ok: true, diagnostics: [], stderr: "", durationMs: 0 }),
      compileAndRun: async () => ({ compile: { ok: true, diagnostics: [], stderr: "", durationMs: 0 }, run: null }),
      runHarness: async () => ({ compile: { ok: true, diagnostics: [], stderr: "", durationMs: 0 }, run: null }),
    },
    prompts: {} as PromptLoader,
    log: memoryLogger(),
  };
  const msgs: ServerMsg[] = [];
  let rt: SessionRuntime | null = null;
  const peer: Peer = {
    id: "p1",
    close() {},
    send(msg) {
      msgs.push(msg);
      // No board is mounted in this test, so every PNG request is answered with an error at once.
      if (msg.type === "board.png.request") queueMicrotask(() => void rt?.handle({ type: "board.png.result", requestId: msg.requestId, pngBase64: null, error: "no board" }, peer));
    },
  };
  return {
    deps,
    store,
    msgs,
    peer,
    async start(session: Session, problem?: Problem) {
      rt = new SessionRuntime(deps, session, problem ?? (await urlShortener()));
      await rt.init();
      rt.attach(peer);
      rt.start();
      return rt;
    },
  };
}

const interviewerTexts = (msgs: ServerMsg[]) => msgs.flatMap((m) => (m.type === "chat.message" && m.entry.role === "interviewer" ? [m.entry.text] : []));

describe("a full interview round on the clock", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }));
  afterEach(() => vi.useRealTimers());

  it("nudges silently, checks in once, delivers the extension, warns quietly, closes at time-up and debriefs", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }));
    const session = newSession("interview");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(interviewerTexts(t.msgs)).toEqual(["Let's design a URL shortener, something like bit.ly. Where would you like to start?"]);

    await vi.advanceTimersByTimeAsync(5 * MIN);
    // Four quiet minutes earned one check-in. The planned end of requirements fired after it, and the fake interviewer
    // chose silence there: nothing shown, a hidden note kept.
    expect(interviewerTexts(t.msgs)).toEqual(["Let's design a URL shortener, something like bit.ly. Where would you like to start?", "Talk me through where you are."]);
    expect(session.transcript.find((e) => e.role === "interviewer" && e.text.startsWith("Talk me"))?.at).toBe(4 * MIN);
    expect(session.transcript.some((e) => e.kind === "clock" && e.hidden && e.text.includes("requirements"))).toBe(true);
    expect(t.msgs.some((m) => m.type === "chat.message" && m.entry.hidden)).toBe(false);

    await vi.advanceTimersByTimeAsync(30 * MIN);
    const texts = interviewerTexts(t.msgs);
    // The whole stretch stays quiet, so it never gets a second check-in.
    expect(texts.filter((x) => x === "Talk me through where you are.")).toHaveLength(1);
    expect(texts.at(-1)).toMatch(/^Let's add something\. A celebrity posts one of our links/);
    expect(session.extension?.text).toBe(texts.at(-1));
    expect(session.extension?.at).toBeGreaterThanOrEqual(35 * MIN);

    // Past time up and the short grace for edits the page flushes when the round ends.
    await vi.advanceTimersByTimeAsync(10 * MIN + 3_000);
    expect(interviewerTexts(t.msgs).at(-1)).toBe("We're out of time, so let's stop here. Thank you.");
    expect(session.status).toBe("debriefed");
    expect(session.endedAt).not.toBeNull();
    expect(session.scorecard?.phaseTiming?.find((p) => p.phase === "requirements")?.actualMinutes).toBe(45);
    expect(t.msgs.some((m) => m.type === "debrief.ready")).toBe(true);
    // The coach waits until the candidate starts the chat.
    expect(t.msgs.some((m) => m.type === "chat.message" && m.entry.channel === "coach")).toBe(false);
    expect(t.store.saved?.status).toBe("debriefed");
    rt.dispose();
  });

  it("holds checkpoints while a guided round is paused", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }), "guided");
    const session = newSession("guided");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(2 * MIN);
    await rt.handle({ type: "session.pause" }, t.peer);
    await vi.advanceTimersByTimeAsync(20 * MIN);
    expect(session.transcript.some((e) => e.kind === "clock")).toBe(false);
    await rt.handle({ type: "session.resume" }, t.peer);
    expect(session.pausedMs).toBe(20 * MIN);
    await vi.advanceTimersByTimeAsync(3 * MIN + 100);
    expect(session.transcript.some((e) => e.kind === "clock")).toBe(true);
    // Guided rounds never end on the clock.
    await vi.advanceTimersByTimeAsync(120 * MIN);
    expect(session.status).toBe("live");
    rt.dispose();
  });
});

const CHECK_IN = "Talk me through where you are.";
const checkIns = (msgs: ServerMsg[]) => interviewerTexts(msgs).filter((x) => x === CHECK_IN);

describe("checking in on a quiet candidate", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }));
  afterEach(() => vi.useRealTimers());

  it("restarts the quiet window when he edits the board", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }));
    const rt = await t.start(newSession("interview"));
    await vi.advanceTimersByTimeAsync(3 * MIN);
    await rt.handle({ type: "board.update", version: 1, elements: [] }, t.peer);
    await vi.advanceTimersByTimeAsync(4 * MIN - 1_000);
    expect(checkIns(t.msgs)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(checkIns(t.msgs)).toHaveLength(1);
    rt.dispose();
  });

  it("checks in once per quiet stretch, and again after he has spoken", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }));
    const session = newSession("interview");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(15 * MIN);
    expect(checkIns(t.msgs)).toHaveLength(1);
    expect(session.transcript.filter((e) => e.kind === "clock" && e.text === "clock: candidate quiet")).toHaveLength(1);
    await rt.handle({ type: "chat.send", channel: "interview", clientMsgId: "c1", text: "Sorry, I was thinking about the read path." }, t.peer);
    await vi.advanceTimersByTimeAsync(4 * MIN + 1_000);
    expect(checkIns(t.msgs)).toHaveLength(2);
    rt.dispose();
  });

  it("holds the window while paused and starts it again on resume", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }));
    const session = newSession("interview");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(2 * MIN);
    await rt.handle({ type: "session.pause" }, t.peer);
    await vi.advanceTimersByTimeAsync(30 * MIN);
    await rt.handle({ type: "session.resume" }, t.peer);
    await vi.advanceTimersByTimeAsync(4 * MIN - 1_000);
    expect(checkIns(t.msgs)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(checkIns(t.msgs)).toHaveLength(1);
    expect(session.transcript.find((e) => e.text === CHECK_IN)?.at).toBe(6 * MIN);
    rt.dispose();
  });

  it("drops a check-in that fell due while the interviewer was mid-reply, and counts the quiet from that reply", async () => {
    const t = setup(slowWhen(saidBy("cache"), 5 * MIN));
    const rt = await t.start(newSession("interview"));
    await vi.advanceTimersByTimeAsync(10_000);
    await rt.handle({ type: "chat.send", channel: "interview", clientMsgId: "c1", text: "Should I put a cache in front?" }, t.peer);
    await vi.advanceTimersByTimeAsync(9 * MIN - 10_000);
    expect(interviewerTexts(t.msgs)).toHaveLength(2);
    expect(checkIns(t.msgs)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(checkIns(t.msgs)).toHaveLength(1);
    rt.dispose();
  });

  it("counts a written step answer and a message being typed as work", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }));
    const session = newSession("interview");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(3 * MIN);
    await rt.handle({ type: "chat.composing" }, t.peer);
    await vi.advanceTimersByTimeAsync(3 * MIN);
    await rt.handle({ type: "notes.update", phase: "requirements", text: "Short links, fast redirects.", version: 1 }, t.peer);
    await vi.advanceTimersByTimeAsync(4 * MIN - 1_000);
    expect(checkIns(t.msgs)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(checkIns(t.msgs)).toHaveLength(1);
    expect(session.transcript.find((e) => e.text === CHECK_IN)?.at).toBe(10 * MIN);
    rt.dispose();
  });

  it("opens a new stretch after an interviewer line that was not itself a check-in", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }));
    const session = newSession("interview");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(39 * MIN + 1_000);
    // One check-in at 4:00, then the extension at 35:00 is a question he has not answered for four minutes.
    expect(checkIns(t.msgs)).toHaveLength(2);
    expect(session.transcript.filter((e) => e.text === CHECK_IN).map((e) => e.at)).toEqual([4 * MIN, 39 * MIN]);
    rt.dispose();
  });

  it("keeps the check-in when its first send fails and the conversation is rebuilt from the transcript", async () => {
    const inner = createFakeDriver({ chunkDelayMs: 0 });
    let failed = false;
    const driver: Driver = {
      ...inner,
      startConversation(s) {
        const conv = inner.startConversation(s);
        return {
          sdkSessionId: () => conv.sdkSessionId(),
          close: () => conv.close(),
          async send(turn, handlers) {
            if (s.resumeSessionId && turn.meta.checkpoint === "silence" && !failed) {
              failed = true;
              throw new DriverError("The model process stopped. Retry.");
            }
            if (turn.meta.kind === "replay") return { text: "<silent/>", stats: { durationMs: 1, costUsd: 0 } };
            return conv.send(turn, handlers);
          },
        };
      },
    };
    const t = setup(driver);
    const session = newSession("interview");
    const rt = await t.start(session);
    // Past the first check-in and the requirements nudge, so the next check-in is the first turn after the resume.
    await vi.advanceTimersByTimeAsync(5.5 * MIN);
    expect(checkIns(t.msgs)).toHaveLength(1);
    await rt.handle({ type: "session.pause" }, t.peer);
    await rt.handle({ type: "session.resume" }, t.peer);
    await vi.advanceTimersByTimeAsync(4 * MIN + 1_000);
    expect(failed).toBe(true);
    expect(session.status).toBe("live");
    expect(checkIns(t.msgs)).toHaveLength(2);
    rt.dispose();
  });

  it("brings a planned-length line that a restart cut off", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }));
    const session: Session = {
      ...newSession("guided"),
      startedAt: new Date(Date.now() - 46 * MIN).toISOString(),
      status: "paused",
      pauseStartedAt: new Date().toISOString(),
      pauseReason: "restart",
      transcript: [{ id: "o1", at: 1_000, wall: new Date().toISOString(), channel: "interview", role: "interviewer", text: "Let's begin." }],
    };
    const rt = await t.start(session);
    await rt.handle({ type: "session.resume" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(interviewerTexts(t.msgs).filter((x) => x.startsWith("We've reached the planned time"))).toHaveLength(1);
    rt.dispose();
  });

  it("drops a move-on offer that falls next to the planned-length line", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }), "guided");
    const session = newSession("guided");
    const rt = await t.start(session);
    const design = phasePlan("hld", 45).find((p) => p.id === "design")?.minutes ?? 0;
    const enterAt = 45 * MIN - 2 * design * MIN;
    for (let v = 1; v * 4 * MIN < enterAt; v++) {
      await vi.advanceTimersByTimeAsync(4 * MIN);
      await rt.handle({ type: "board.update", version: v, elements: [] }, t.peer);
    }
    await vi.advanceTimersByTimeAsync(enterAt - Math.floor(enterAt / (4 * MIN)) * 4 * MIN);
    await rt.handle({ type: "phase.set", phase: "design" }, t.peer);
    for (let v = 100; v < 108; v++) {
      await vi.advanceTimersByTimeAsync(4 * MIN);
      await rt.handle({ type: "board.update", version: v, elements: [] }, t.peer);
    }
    await vi.advanceTimersByTimeAsync(Math.max(0, 45 * MIN + 30_000 - (enterAt + 32 * MIN)));
    const texts = interviewerTexts(t.msgs);
    expect(texts.filter((x) => x.startsWith("We've reached the planned time"))).toHaveLength(1);
    const lateOffers = session.transcript.filter((e) => e.role === "interviewer" && e.at >= enterAt && e.text.startsWith("You are well past the plan"));
    expect(lateOffers).toHaveLength(0);
    rt.dispose();
  });

  it("brings back a check-in that fell while the page was reconnecting", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }));
    const session = newSession("interview");
    const rt = await t.start(session);
    // Work at 2:00 puts the check-in at 6:00, clear of the requirements nudge at 5:00.
    await vi.advanceTimersByTimeAsync(2 * MIN);
    await rt.handle({ type: "board.update", version: 1, elements: [] }, t.peer);
    await vi.advanceTimersByTimeAsync(3 * MIN + 50_000);
    rt.detach(t.peer);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(checkIns(t.msgs)).toHaveLength(0);
    rt.attach(t.peer);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(checkIns(t.msgs)).toHaveLength(1);
    const at = session.transcript.find((e) => e.text === CHECK_IN)?.at ?? 0;
    expect(at).toBeGreaterThan(6 * MIN + 10_000);
    expect(at).toBeLessThan(6 * MIN + 20_000);
    rt.dispose();
  });

  it("leaves the new stretch open when he starts work while a check-in turn answers with silence", async () => {
    const inner = createFakeDriver({ chunkDelayMs: 0 });
    let quietTurns = 0;
    const driver: Driver = {
      ...inner,
      startConversation(s) {
        const conv = inner.startConversation(s);
        return {
          sdkSessionId: () => conv.sdkSessionId(),
          close: () => conv.close(),
          async send(turn, handlers) {
            if (turn.meta.checkpoint === "silence" && quietTurns++ === 0) {
              await new Promise((resolve) => setTimeout(resolve, 10_000));
              return { text: "<silent/>", stats: { durationMs: 1, costUsd: 0 } };
            }
            return conv.send(turn, handlers);
          },
        };
      },
    };
    const t = setup(driver);
    const session = newSession("interview");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(4 * MIN + 5_000);
    await rt.handle({ type: "board.update", version: 1, elements: [] }, t.peer);
    await vi.advanceTimersByTimeAsync(4 * MIN + 5_000);
    expect(quietTurns).toBe(2);
    expect(checkIns(t.msgs)).toHaveLength(1);
    rt.dispose();
  });

  it("does not repeat a planned-length line after a restart", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }));
    const wall = new Date().toISOString();
    const session: Session = {
      ...newSession("guided"),
      startedAt: new Date(Date.now() - 46 * MIN).toISOString(),
      status: "paused",
      pauseStartedAt: wall,
      pauseReason: "restart",
      transcript: [
        { id: "o1", at: 1_000, wall, channel: "interview", role: "interviewer", text: "Let's begin." },
        { id: "o2", at: 45 * MIN, wall, channel: "interview", role: "interviewer", text: "We've reached the planned time." },
        { id: "o3", at: 45 * MIN, wall, channel: "interview", role: "system", kind: "clock", hidden: true, text: "clock: planned length reached" },
      ],
    };
    const rt = await t.start(session);
    await rt.handle({ type: "session.resume" }, t.peer);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(interviewerTexts(t.msgs).filter((x) => x.startsWith("We've reached the planned time"))).toHaveLength(0);
    rt.dispose();
  });

  it("gives a guided round a longer window and one line when it reaches its planned length", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }), "guided");
    const session = newSession("guided");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(6 * MIN - 1_000);
    expect(checkIns(t.msgs)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(checkIns(t.msgs)).toHaveLength(1);
    // Steady work from here on, so only the planned length speaks.
    for (let v = 1; v <= 9; v++) {
      await vi.advanceTimersByTimeAsync(4 * MIN);
      await rt.handle({ type: "board.update", version: v, elements: [] }, t.peer);
    }
    await vi.advanceTimersByTimeAsync(5 * MIN);
    const overtime = interviewerTexts(t.msgs).filter((x) => x.startsWith("We've reached the planned time"));
    expect(overtime).toHaveLength(1);
    expect(session.transcript.find((e) => e.kind === "clock" && e.text === "clock: planned length reached")?.at).toBeGreaterThanOrEqual(45 * MIN);
    expect(checkIns(t.msgs)).toHaveLength(1);
    expect(session.status).toBe("live");
    rt.dispose();
  });
});

describe("a round the interviewer already closed", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }));
  afterEach(() => vi.useRealTimers());

  it("starts the debrief when the interviewer answers time up with silence", async () => {
    const inner = createFakeDriver({ chunkDelayMs: 0 });
    const driver: Driver = {
      ...inner,
      startConversation(s) {
        const conv = inner.startConversation(s);
        return {
          sdkSessionId: () => conv.sdkSessionId(),
          close: () => conv.close(),
          async send(turn, handlers) {
            if (turn.meta.checkpoint !== "time_up") return conv.send(turn, handlers);
            handlers.onTextDelta("<silent/>");
            return { text: "<silent/>", stats: { durationMs: 1, costUsd: 0 } };
          },
        };
      },
    };
    const t = setup(driver);
    const session = newSession("interview");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(45 * MIN + 5_000);
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      expect(session.status).toBe("debriefed");
    });
    const texts = interviewerTexts(t.msgs);
    expect(texts.every((x) => x.trim() !== "" && !x.includes("silent"))).toBe(true);
    expect(texts.some((x) => x.startsWith("We're out of time"))).toBe(false);
    const end = t.msgs.findIndex((m) => m.type === "chat.message" && m.entry.text === "Time is up.");
    expect(end).toBeGreaterThan(-1);
    expect(t.msgs.slice(end).some((m) => m.type === "chat.delta" && m.channel === "interview")).toBe(false);
    expect(session.transcript.some((e) => e.kind === "clock" && e.text === "clock: time up")).toBe(true);
    rt.dispose();
  });
});

/** Fails chosen sends; everything else is answered by the fake driver. */
function flakyDriver(failOn: (call: number, setup: ConversationSetup) => boolean) {
  const inner = createFakeDriver({ chunkDelayMs: 0 });
  let calls = 0;
  const starts: (string | null)[] = [];
  const driver: Driver = {
    kind: "fake",
    runOnce: (s) => inner.runOnce(s),
    startConversation(s) {
      starts.push(s.resumeSessionId);
      const conv = inner.startConversation(s);
      const wrapped: Conversation = {
        sdkSessionId: () => conv.sdkSessionId(),
        close: () => conv.close(),
        async send(turn, handlers) {
          calls += 1;
          if (failOn(calls, s)) throw new DriverError("The model is rate limited right now. Wait a minute, then retry.");
          return conv.send(turn, handlers);
        },
      };
      return wrapped;
    },
  };
  return { driver, starts };
}

describe("failure handling", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }));
  afterEach(() => vi.useRealTimers());

  it("pauses on a model error, then resumes the SDK session, then falls back to a replay", async () => {
    // Call 1 opens the round; call 2 (the candidate's message) fails; call 3 (on the resumed session) fails too.
    const { driver, starts } = flakyDriver((n) => n === 2 || n === 3);
    const t = setup(driver);
    const session = newSession("interview");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(500);

    await rt.handle({ type: "chat.send", channel: "interview", clientMsgId: "c1", text: "Requirements first: 100 million links a month." }, t.peer);
    await vi.advanceTimersByTimeAsync(500);
    expect(session.status).toBe("paused");
    expect(session.pauseReason).toBe("error");
    const err = t.msgs.find((m) => m.type === "agent.status" && m.state === "error");
    expect(err).toMatchObject({ channel: "interview", error: "The model is rate limited right now. Wait a minute." });

    // While paused the clock stands still.
    const before = session.pausedMs;
    await vi.advanceTimersByTimeAsync(10 * MIN);
    await rt.handle({ type: "session.resume" }, t.peer);
    await vi.advanceTimersByTimeAsync(500);
    expect(session.pausedMs - before).toBeGreaterThanOrEqual(10 * MIN);
    expect(session.status).toBe("live");
    expect(session.pauseReason).toBeNull();
    // First the stored SDK session was resumed; when that failed, a fresh conversation started from the replay.
    expect(starts).toHaveLength(3);
    expect(starts[0]).toBeNull();
    expect(starts[1]).toMatch(/^fake-/);
    expect(starts[2]).toBeNull();
    expect(interviewerTexts(t.msgs).at(-1)).toBe("Okay, let's carry on from where we were.");
    expect(t.msgs.filter((m) => m.type === "agent.status").at(-1)).toMatchObject({ state: "idle" });
    rt.dispose();
  });

  it("reruns a failed opening once on retry, without a replay", async () => {
    const { driver, starts } = flakyDriver((n) => n === 1);
    const t = setup(driver);
    const session = newSession("interview");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(500);
    expect(session.status).toBe("paused");
    await rt.handle({ type: "session.resume" }, t.peer);
    await vi.advanceTimersByTimeAsync(500);
    expect(interviewerTexts(t.msgs)).toEqual(["Let's design a URL shortener, something like bit.ly. Where would you like to start?"]);
    expect(starts).toEqual([null, null]);
    rt.dispose();
  });

  it("refuses chat while paused by an error and tells the user to retry", async () => {
    const { driver } = flakyDriver((n) => n === 1);
    const t = setup(driver);
    const rt = await t.start(newSession("interview"));
    await vi.advanceTimersByTimeAsync(500);
    await rt.handle({ type: "chat.send", channel: "interview", clientMsgId: "c1", text: "hello" }, t.peer);
    expect(t.msgs.at(-1)).toMatchObject({ type: "error", code: "paused", message: expect.stringContaining("Retry") });
    rt.dispose();
  });
});

describe("pausing by hand", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }));
  afterEach(() => vi.useRealTimers());

  it("lets an interview round pause: the clock and every checkpoint stand still until resume", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }));
    const session = newSession("interview");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(2 * MIN);
    await rt.handle({ type: "session.pause" }, t.peer);
    expect(session.status).toBe("paused");
    expect(session.pauseReason).toBe("user");
    expect(t.msgs.at(-1)).toMatchObject({ type: "session.state", session: { status: "paused", pauseReason: "user" } });

    // 30 minutes would have crossed the end of requirements, the extension and the five-minute warning.
    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(session.transcript.some((e) => e.kind === "clock")).toBe(false);
    expect(session.status).toBe("paused");

    await rt.handle({ type: "chat.send", channel: "interview", clientMsgId: "c1", text: "hello" }, t.peer);
    expect(t.msgs.at(-1)).toMatchObject({ type: "error", code: "paused", message: expect.stringContaining("Resume") });

    await rt.handle({ type: "session.resume" }, t.peer);
    expect(session.status).toBe("live");
    expect(session.pauseReason).toBeNull();
    expect(session.pausedMs).toBe(30 * MIN);
    await vi.advanceTimersByTimeAsync(3 * MIN + 100);
    expect(session.transcript.some((e) => e.kind === "clock" && e.text.includes("requirements"))).toBe(true);
    rt.dispose();
  });
});

describe("pause notes across a restart", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }));
  afterEach(() => vi.useRealTimers());

  it("delivers the pause note after the round is saved, loaded by a new runtime and resumed", async () => {
    const first = setup(createFakeDriver({ chunkDelayMs: 0 }));
    const session = newSession("interview");
    const rt = await first.start(session);
    await vi.advanceTimersByTimeAsync(2 * MIN);
    await rt.handle({ type: "session.pause" }, first.peer);
    const saved = structuredClone(first.store.saved!);
    expect(saved.status).toBe("paused");
    rt.dispose();

    const sent: string[] = [];
    const fake = createFakeDriver({ chunkDelayMs: 0 });
    const driver: Driver = {
      ...fake,
      startConversation(s) {
        const conv = fake.startConversation(s);
        return { sdkSessionId: () => conv.sdkSessionId(), close: () => conv.close(), send: (turn, handlers) => (sent.push(turn.text), conv.send(turn, handlers)) };
      },
    };
    const second = setup(driver);
    const reloaded = await second.start(saved);
    expect(reloaded.isDormant()).toBe(false);
    await reloaded.handle({ type: "session.resume" }, second.peer);
    await reloaded.handle({ type: "chat.send", channel: "interview", clientMsgId: "c1", text: "back again" }, second.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent.some((text) => text.includes("the candidate paused the clock"))).toBe(true);
    expect(second.store.saved?.pendingEvents ?? []).toEqual([]);
    reloaded.dispose();
  });
});

/** Answers like the fake driver, but one chosen send takes `delayMs` longer, as a long reply would. */
function slowDriver(slowCall: number, delayMs: number): Driver {
  const inner = createFakeDriver({ chunkDelayMs: 0 });
  let calls = 0;
  return {
    kind: "fake",
    runOnce: (s) => inner.runOnce(s),
    startConversation(s) {
      const conv = inner.startConversation(s);
      return {
        sdkSessionId: () => conv.sdkSessionId(),
        close: () => conv.close(),
        async send(turn, handlers) {
          calls += 1;
          if (calls === slowCall) await new Promise((resolve) => setTimeout(resolve, delayMs));
          return conv.send(turn, handlers);
        },
      };
    },
  };
}

describe("pausing when nobody is watching", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }));
  afterEach(() => vi.useRealTimers());

  it("pauses as away once the room has had no socket for the whole window, and keeps the clock still", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }));
    const session = newSession("interview");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    rt.detach(t.peer);

    await vi.advanceTimersByTimeAsync(AWAY_PAUSE_MS - 1);
    expect(session.status).toBe("live");
    await vi.advanceTimersByTimeAsync(1);
    expect(session.status).toBe("paused");
    expect(session.pauseReason).toBe("away");
    expect(t.store.saved).toMatchObject({ status: "paused", pauseReason: "away" });

    // Nothing fires while it is paused, however long nobody comes back.
    await vi.advanceTimersByTimeAsync(40 * MIN);
    expect(session.transcript.some((e) => e.kind === "clock")).toBe(false);
    expect(session.status).toBe("paused");
    rt.dispose();
  });

  it("stays paused when a socket comes back, until the user resumes", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }));
    const session = newSession("interview");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    rt.detach(t.peer);
    await vi.advanceTimersByTimeAsync(AWAY_PAUSE_MS + 1_000);
    expect(session.pauseReason).toBe("away");

    rt.attach(t.peer);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(session.status).toBe("paused");
    expect(t.msgs.findLast((m) => m.type === "session.state")).toMatchObject({ session: { status: "paused", pauseReason: "away" } });

    await rt.handle({ type: "session.resume" }, t.peer);
    expect(session.status).toBe("live");
    expect(session.pauseReason).toBeNull();
    rt.dispose();
  });

  it("is cancelled by a socket that reconnects inside the window, and starts afresh on the next drop", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }));
    const session = newSession("interview");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);

    rt.detach(t.peer);
    await vi.advanceTimersByTimeAsync(AWAY_PAUSE_MS / 2);
    rt.attach(t.peer);
    await vi.advanceTimersByTimeAsync(2 * AWAY_PAUSE_MS);
    expect(session.status).toBe("live");

    rt.detach(t.peer);
    await vi.advanceTimersByTimeAsync(AWAY_PAUSE_MS - 1);
    expect(session.status).toBe("live");
    await vi.advanceTimersByTimeAsync(1);
    expect(session.pauseReason).toBe("away");
    rt.dispose();
  });

  it("does not count a second tab: the round stays live while any socket is open", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }));
    const session = newSession("interview");
    const rt = await t.start(session);
    const other: Peer = { id: "p2", send() {}, close() {} };
    rt.attach(other);
    rt.detach(t.peer);
    await vi.advanceTimersByTimeAsync(3 * AWAY_PAUSE_MS);
    expect(session.status).toBe("live");
    rt.detach(other);
    await vi.advanceTimersByTimeAsync(AWAY_PAUSE_MS);
    expect(session.pauseReason).toBe("away");
    rt.dispose();
  });

  it("lets a reply that is already streaming finish before it pauses", async () => {
    const t = setup(slowDriver(2, 90_000));
    const session = newSession("interview");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(500);
    await rt.handle({ type: "chat.send", channel: "interview", clientMsgId: "c1", text: "Requirements first." }, t.peer);
    await vi.advanceTimersByTimeAsync(500);
    rt.detach(t.peer);

    // The window has passed, but the interviewer is still mid-reply: the round must not pause yet.
    await vi.advanceTimersByTimeAsync(AWAY_PAUSE_MS + 1_000);
    expect(session.status).toBe("live");
    expect(session.transcript.filter((e) => e.role === "interviewer")).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(40_000);
    // The reply went to nobody, but it is in the transcript the user finds when they come back.
    expect(session.transcript.filter((e) => e.role === "interviewer")).toHaveLength(2);
    expect(session.status).toBe("paused");
    expect(session.pauseReason).toBe("away");
    rt.dispose();
  });

  it("drops the pending pause when a socket returns before the reply ends", async () => {
    const t = setup(slowDriver(2, 90_000));
    const session = newSession("interview");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(500);
    await rt.handle({ type: "chat.send", channel: "interview", clientMsgId: "c1", text: "Requirements first." }, t.peer);
    await vi.advanceTimersByTimeAsync(500);
    rt.detach(t.peer);
    await vi.advanceTimersByTimeAsync(AWAY_PAUSE_MS + 1_000);
    rt.attach(t.peer);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(interviewerTexts(t.msgs)).toHaveLength(2);
    expect(session.status).toBe("live");
    rt.dispose();
  });

  it("does not arm for a round that is not live", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }), "guided");
    const session = newSession("guided");
    const rt = await t.start(session);
    await rt.handle({ type: "session.pause" }, t.peer);
    rt.detach(t.peer);
    await vi.advanceTimersByTimeAsync(AWAY_PAUSE_MS + 1_000);
    expect(session.pauseReason).toBe("user");
    rt.dispose();
  });

  it("releases conversation on pause and resumes with the same sdk session id", async () => {
    const startedSetups: ConversationSetup[] = [];
    let closedCount = 0;
    const inner = createFakeDriver({ chunkDelayMs: 0 });
    const driver: Driver = {
      ...inner,
      startConversation(setup) {
        startedSetups.push(setup);
        const conv = inner.startConversation(setup);
        return {
          sdkSessionId: () => conv.sdkSessionId(),
          close: () => {
            closedCount += 1;
            conv.close();
          },
          send: (turn, handlers) => conv.send(turn, handlers),
        };
      },
    };

    const t = setup(driver);
    const session = newSession("interview");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(500);

    expect(startedSetups).toHaveLength(1);
    const firstSdkSessionId = session.sdk.interviewerSessionId;
    expect(firstSdkSessionId).toBeTruthy();

    await rt.handle({ type: "session.pause" }, t.peer);
    expect(session.status).toBe("paused");
    expect(closedCount).toBe(1);

    await rt.handle({ type: "session.resume" }, t.peer);
    expect(session.status).toBe("live");

    await rt.handle({ type: "chat.send", channel: "interview", clientMsgId: "c1", text: "Let's continue." }, t.peer);
    await vi.advanceTimersByTimeAsync(500);

    expect(startedSetups).toHaveLength(2);
    expect(startedSetups[1]?.resumeSessionId).toBe(firstSdkSessionId);
    rt.dispose();
  });
});

describe("the step checker", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }));
  afterEach(() => vi.useRealTimers());

  const req = { id: "f-req", type: "frame", x: 0, y: 0, width: 760, height: 440, name: "Requirements", customData: { step: "requirements" }, frameId: null };
  const design = { id: "f-design", type: "frame", x: 0, y: 500, width: 1560, height: 820, name: "High-level design", customData: { step: "design" }, frameId: null };
  const box = (id: string, x: number, y: number, label: string) => [
    { id, type: "rectangle", x, y, width: 160, height: 60, frameId: null, boundElements: [{ type: "text", id: `${id}-t` }] },
    { id: `${id}-t`, type: "text", x: x + 10, y: y + 20, width: 140, height: 20, text: label, originalText: label, containerId: id, frameId: null },
  ];

  it("never checks while he talks, checks the step he leaves, ticks only what his own words cover, and refuses an invented quote", async () => {
    const calls: string[] = [];
    const fake = createFakeDriver({ chunkDelayMs: 0 });
    const driver: Driver = { ...fake, runOnce: (s) => (calls.push(s.role), fake.runOnce(s)) };
    const t = setup(driver);
    const session = newSession("interview");
    const rt = await t.start(session);
    expect(session.checklist.requirements?.length).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(1_000);
    await rt.handle({ type: "chat.send", channel: "interview", clientMsgId: "c1", text: "A redirect should add under 50 ms at p99." }, t.peer);
    await rt.handle({ type: "chat.send", channel: "interview", clientMsgId: "c2", text: "Every short code is unique forever." }, t.peer);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.filter((r) => r === "checker")).toHaveLength(0);
    await rt.handle({ type: "phase.set", phase: "entities" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls.filter((r) => r === "checker")).toHaveLength(1);
    const check = session.stepChecks.requirements!;
    expect(check.status).toBe("done");
    const covered = Object.entries(check.items).filter(([, i]) => i.state === "covered");
    expect(covered.length).toBeGreaterThan(0);
    for (const [, item] of covered) {
      expect(item.source).toBe("chat");
      expect(["A redirect should add under 50 ms at p99.", "Every short code is unique forever."]).toContain(item.quote);
      expect(item.at).not.toBeNull();
    }
    // The fake always claims one item with words he never said; that claim must not count.
    expect(Object.values(check.items).some((i) => i.quote === "I covered this in detail earlier")).toBe(false);
    // Nothing new happened, so no second call.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls.filter((r) => r === "checker")).toHaveLength(1);
    rt.dispose();
  });

  it("never checks while he draws, and a guided check reads only the step's frame with its image when a shape has no label", async () => {
    const turns: { text: string; images: number }[] = [];
    const fake = createFakeDriver({ chunkDelayMs: 0 });
    const driver: Driver = {
      ...fake,
      runOnce: (s) => {
        if (s.role === "checker") turns.push({ text: s.turn.text, images: s.turn.images?.length ?? 0 });
        return fake.runOnce(s);
      },
    };
    const t = setup(driver, "guided");
    const session = newSession("guided");
    session.phase = "design";
    session.phaseHistory.push({ phase: "design", at: 0, by: "candidate" });
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    const blank = { id: "blank", type: "ellipse", x: 900, y: 900, width: 100, height: 60, frameId: null };
    const elements = [req, design, ...box("lb", 100, 700, "Load balancer"), ...box("goal", 40, 60, "Redirects under 50 ms"), blank];
    await rt.handle({ type: "board.update", version: 1, elements }, t.peer);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(turns).toHaveLength(0);
    await rt.handle({ type: "guided.feedback" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    const designTurn = turns.find((x) => x.text.includes("<step>High-level design</step>"));
    expect(designTurn?.text).toContain("[Load balancer]");
    expect(designTurn?.text).not.toContain("Redirects under 50 ms");
    // The browser in this test cannot draw an image, so the request is made and the check goes on without one.
    expect(t.msgs.some((m) => m.type === "board.png.request" && m.frameId === "f-design")).toBe(true);
    expect(designTurn?.text).toContain("No image is attached.");
    rt.dispose();
  });

  it("checks the step he leaves at once and asks for its frame image once", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }));
    const session = newSession("interview");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    await rt.handle({ type: "board.update", version: 1, elements: [req, design, ...box("n", 40, 60, "Redirect a short link to its long URL; an expired link stops")] }, t.peer);
    await rt.handle({ type: "phase.set", phase: "entities" }, t.peer);
    expect(session.stepChecks.requirements?.status).toBe("checking");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.msgs.filter((m) => m.type === "board.png.request" && m.frameId === "f-req")).toHaveLength(1);
    expect(session.stepChecks.requirements?.items["requirements-2"]).toMatchObject({ state: "covered", source: "board" });
    rt.dispose();
  });

  it("skips a step where he neither spoke nor drew", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }));
    const session = newSession("interview");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    await rt.handle({ type: "phase.set", phase: "entities" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.stepChecks.requirements).toBeUndefined();
    rt.dispose();
  });
});

describe("the step checker in a machine-coding round", () => {
  const ATTEMPT = "lld/parking-lot/attempt-2026-10-30.cpp";
  const HEADER = "// Parking Lot attempt, 2026-10-30\n";
  const CLARIFY = "// Entry: assign the first free fitting spot and return a ticket\n// Exit: given a ticket compute the fee and free the spot";
  const ENTITIES = "enum class VehicleType { Car, Bike };";
  let root = "";

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    root = await mkdtemp(join(tmpdir(), "ir-step-code-"));
    await mkdir(join(root, "lld", "parking-lot"), { recursive: true });
    await writeFile(join(root, ATTEMPT), HEADER);
  });
  afterEach(async () => {
    vi.useRealTimers();
    await rm(root, { recursive: true, force: true });
  });

  async function parkingLot() {
    const file = join(APP_ROOT, "content", "problems", "lld", "b3-parking-lot.md");
    return parseProblem(await readFile(file, "utf8"), file, false);
  }

  function lldSession(mode: Session["mode"]): Session {
    return {
      ...newSession(mode),
      id: "20261030-1000-b3-parking-lot-abcd",
      problemId: "b3-parking-lot",
      title: "Parking Lot",
      track: "lld",
      durationMs: 90 * MIN,
      phase: "clarify",
      phaseHistory: [{ phase: "clarify", at: 0, by: "candidate" }],
      code: { path: ATTEMPT, version: 0, lastRun: null },
    };
  }

  /** The fake driver, keeping the checker's messages, the guide's tools and turns, and the order things happened in. */
  function recording(gate?: Promise<void>) {
    const fake = createFakeDriver({ chunkDelayMs: 0 });
    const checks: string[] = [];
    const sent: UserTurn[] = [];
    const events: string[] = [];
    let tools: RoomTool[] = [];
    const driver: Driver = {
      ...fake,
      runOnce: async (s) => {
        if (s.role !== "checker") return fake.runOnce(s);
        checks.push(s.turn.text);
        if (gate) await gate;
        const out = await fake.runOnce(s);
        events.push("checker done");
        return out;
      },
      startConversation(s) {
        tools = s.tools;
        const conv = fake.startConversation(s);
        return {
          sdkSessionId: () => conv.sdkSessionId(),
          close: () => conv.close(),
          send(turn, handlers) {
            sent.push(turn);
            events.push(`sent ${turn.meta.kind}`);
            return conv.send(turn, handlers);
          },
        };
      },
    };
    const tool = (name: string) => {
      const found = tools.find((x) => x.name === name);
      if (!found) throw new Error(`no ${name} tool`);
      return found;
    };
    return { driver, checks, sent, events, tool };
  }

  const stepsChecked = (checks: string[]) => checks.map((m) => /<step>(.*?)<\/step>/.exec(m)?.[1]);
  const text = (out: { content: { type: string; text?: string }[] }) => out.content.map((c) => c.text ?? "").join("");

  it("reads the code he typed in a design step as that step's evidence and never as another step's", async () => {
    const r = recording();
    const t = setup(r.driver, "interview", root);
    const session = lldSession("interview");
    const rt = await t.start(session, await parkingLot());
    await vi.advanceTimersByTimeAsync(1_000);
    await rt.handle({ type: "code.update", version: 1, content: `${HEADER}${CLARIFY}\n` }, t.peer);
    await rt.handle({ type: "phase.set", phase: "entities" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    await rt.handle({ type: "code.update", version: 2, content: `${HEADER}${CLARIFY}\n\n${ENTITIES}\n` }, t.peer);
    await rt.handle({ type: "phase.set", phase: "behaviour" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(session.stepCode).toEqual({ clarify: CLARIFY.split("\n"), entities: [ENTITIES] });
    expect(stepsChecked(r.checks)).toEqual(["Clarify", "Entities"]);
    const [clarify, entities] = r.checks;
    expect(clarify).toContain("<code>\n2 | // Entry: assign the first free fitting spot and return a ticket\n3 | // Exit:");
    expect(clarify).not.toContain("Parking Lot attempt");
    expect(clarify).not.toContain("VehicleType");
    expect(entities).toContain(`<code>\n5 | ${ENTITIES}\n</code>`);
    expect(entities).not.toContain("free fitting spot");
    expect(Object.values(session.stepChecks.clarify?.items ?? {}).some((i) => i.source === "code")).toBe(true);
    // The clarify comment names spots and tickets; the entities step must not take credit for them.
    expect(session.stepChecks.entities?.items).toEqual({ "entities-1": expect.objectContaining({ state: "covered", source: "code" }) });
    // The page has no use for the attribution, so it stays on the server.
    const state = [...t.msgs].reverse().find((m) => m.type === "session.state");
    expect(state?.type === "session.state" && "stepCode" in state.session).toBe(false);
    rt.dispose();
  });

  it("runs no check for a step he only passed through, even with code in the file", async () => {
    const r = recording();
    const t = setup(r.driver, "interview", root);
    const session = lldSession("interview");
    const rt = await t.start(session, await parkingLot());
    await vi.advanceTimersByTimeAsync(1_000);
    await rt.handle({ type: "code.update", version: 1, content: `${HEADER}${CLARIFY}\n` }, t.peer);
    await rt.handle({ type: "phase.set", phase: "entities" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_500);
    await rt.handle({ type: "phase.set", phase: "behaviour" }, t.peer);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(stepsChecked(r.checks)).toEqual(["Clarify"]);
    expect(session.stepChecks.entities).toBeUndefined();
    rt.dispose();
  });

  it("gives the guide a re-read that refuses a bad step and clears a wrong tick when the step holds no evidence", async () => {
    const r = recording();
    const t = setup(r.driver, "guided", root);
    const session = lldSession("guided");
    const rt = await t.start(session, await parkingLot());
    await vi.advanceTimersByTimeAsync(5_000);
    const wrong = { state: "covered" as const, source: "code" as const, at: null, quote: "free the spot", detail: "" };
    session.stepChecks = { entities: { status: "done", checkedAt: 10, usedImage: false, items: { "entities-2": wrong } } };
    const recheck = r.tool("recheck_step");
    const unknown = await recheck.run({ phase: "requirements" });
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toContain("clarify, entities, behaviour, skeleton");
    for (const bad of [{ phase: "" }, { phase: "x".repeat(41) }, {}, { phase: 3 }, { phase: "entities", extra: 1 }]) {
      expect((await recheck.run(bad)).isError).toBe(true);
    }
    expect(session.stepChecks.entities?.items["entities-2"]).toEqual(wrong);

    const out = await recheck.run({ phase: "entities" });
    expect(out.isError).toBeUndefined();
    expect(text(out)).toContain("- entities-2: Spot — missing");
    expect(session.stepChecks.entities).toMatchObject({ status: "done", items: {} });
    expect(session.stepChecks.entities?.checkedAt).toBeGreaterThan(10);
    // There was nothing to read, so no model call was made.
    expect(r.checks).toHaveLength(0);
    rt.dispose();
  });

  it("re-reads a step with evidence from scratch, dropping a tick its own code does not back", async () => {
    const r = recording();
    const t = setup(r.driver, "guided", root);
    const session = lldSession("guided");
    const rt = await t.start(session, await parkingLot());
    await vi.advanceTimersByTimeAsync(1_000);
    await rt.handle({ type: "code.update", version: 1, content: `${HEADER}${CLARIFY}\n` }, t.peer);
    await rt.handle({ type: "phase.set", phase: "entities" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    await rt.handle({ type: "code.update", version: 2, content: `${HEADER}${CLARIFY}\n\n${ENTITIES}\n` }, t.peer);
    const wrong = { state: "covered" as const, source: "code" as const, at: null, quote: "free the spot", detail: "" };
    session.stepChecks = { ...session.stepChecks, entities: { status: "done", checkedAt: 10, usedImage: false, items: { "entities-2": wrong } } };

    const pending = r.tool("recheck_step").run({ phase: "entities" });
    await vi.advanceTimersByTimeAsync(1_000);
    const out = await pending;
    expect(stepsChecked(r.checks)).toEqual(["Clarify", "Entities"]);
    expect(text(out)).toContain("- entities-1: VehicleType — covered, in the code");
    expect(text(out)).toContain("- entities-2: Spot — missing");
    expect(Object.keys(session.stepChecks.entities?.items ?? {})).toEqual(["entities-1"]);
    rt.dispose();
  });

  it("keeps naming the gap on a build step after two 'Not yet' checks, since a code failure is not the answer", async () => {
    const r = recording();
    const t = setup(r.driver, "guided", root);
    const session = lldSession("guided");
    session.phase = "skeleton";
    session.phaseHistory.push({ phase: "skeleton", at: 0, by: "candidate" });
    session.stepVerdicts = { skeleton: { verdict: "not_yet", gap: "The file does not compile yet.", at: 1, misses: 2 } };
    const rt = await t.start(session, await parkingLot());
    await vi.advanceTimersByTimeAsync(1_000);
    await rt.handle({ type: "code.update", version: 1, content: `${HEADER}${CLARIFY}\n` }, t.peer);
    await rt.handle({ type: "guided.feedback" }, t.peer);
    await vi.advanceTimersByTimeAsync(2_000);
    const body = r.sent.find((x) => x.meta.kind === "request")?.text ?? "";
    expect(body).toContain("name the one most important gap");
    expect(body).not.toContain("names nothing");
    rt.dispose();
  });

  it("builds the guide's step feedback only once the check has settled, and hands it the checker's reading", async () => {
    let release = () => {};
    const r = recording(new Promise<void>((resolve) => (release = resolve)));
    const t = setup(r.driver, "guided", root);
    const session = lldSession("guided");
    const rt = await t.start(session, await parkingLot());
    await vi.advanceTimersByTimeAsync(1_000);
    await rt.handle({ type: "code.update", version: 1, content: `${HEADER}${CLARIFY}\n` }, t.peer);
    const before = t.msgs.length;
    await rt.handle({ type: "guided.feedback" }, t.peer);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(r.checks).toHaveLength(1);
    expect(session.stepChecks.clarify?.status).toBe("checking");
    expect(r.sent.some((x) => x.meta.kind === "request")).toBe(false);
    // The page disables "Check this step" and "Hint" while the interview channel is thinking.
    const statuses = t.msgs.slice(before).flatMap((m) => (m.type === "agent.status" && m.channel === "interview" ? [m.state] : []));
    expect(statuses).toEqual(["thinking"]);

    release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(r.events).toEqual(["sent start", "checker done", "sent request"]);
    const body = r.sent.find((x) => x.meta.kind === "request")?.text ?? "";
    expect(body).toMatch(/This is the checker's reading of the step checklist as of \d+:\d\d\./);
    expect(body).toMatch(/- clarify-2: Entry: assign the first free fitting spot and return a ticket; reject if nothing fits — (covered|partial), in the code/);
    expect(body).toContain("- clarify-1: Configure floors, spots per floor with sizes, gates and rates at setup — missing");
    expect(body).toContain("- clarify-5: Safe under concurrent entry and exit calls — partial, in the code; lacks only part of it is stated");
    expect(body).toContain("The server refuses a pass while fewer than 3 of these 5 items are covered. That is a floor, not the bar");
    expect(body).toContain("Call step_verdict once for this step");
    rt.dispose();
  });

  it("lets the step feedback go ahead after 30 seconds when the check has not settled", async () => {
    const r = recording(new Promise<void>(() => {}));
    const t = setup(r.driver, "guided", root);
    const session = lldSession("guided");
    const rt = await t.start(session, await parkingLot());
    await vi.advanceTimersByTimeAsync(1_000);
    await rt.handle({ type: "code.update", version: 1, content: `${HEADER}${CLARIFY}\n` }, t.peer);
    await rt.handle({ type: "guided.feedback" }, t.peer);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(r.sent.some((x) => x.meta.kind === "request")).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    const body = r.sent.find((x) => x.meta.kind === "request")?.text ?? "";
    expect(body).toContain("The checker has no finished reading of this step yet");
    rt.dispose();
  });

  it("keeps a waiting step feedback in the queue through a pause and sends it after the resume", async () => {
    let release = () => {};
    const r = recording(new Promise<void>((resolve) => (release = resolve)));
    const t = setup(r.driver, "guided", root);
    const session = lldSession("guided");
    const rt = await t.start(session, await parkingLot());
    await vi.advanceTimersByTimeAsync(1_000);
    await rt.handle({ type: "code.update", version: 1, content: `${HEADER}${CLARIFY}\n` }, t.peer);
    await rt.handle({ type: "guided.feedback" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    await rt.handle({ type: "session.pause" }, t.peer);
    release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(r.sent.some((x) => x.meta.kind === "request")).toBe(false);
    const last = [...t.msgs].reverse().find((m) => m.type === "agent.status" && m.channel === "interview");
    expect(last?.type === "agent.status" && last.state).toBe("idle");

    await rt.handle({ type: "session.resume" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(r.sent.filter((x) => x.meta.kind === "request")).toHaveLength(1);
    rt.dispose();
  });

  it("credits the whole file to the first step when a round saved before step code was kept loads", async () => {
    await writeFile(join(root, ATTEMPT), `${HEADER}${CLARIFY}\n\nclass Spot {};\n`);
    const problem = await parkingLot();
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }), "interview", root);

    const old: Partial<Session> = lldSession("interview");
    delete old.stepCode;
    const rt = new SessionRuntime(t.deps, old as Session, problem);
    await rt.init();
    expect(old.stepCode).toEqual({ clarify: ["// Parking Lot attempt, 2026-10-30", ...CLARIFY.split("\n"), "class Spot {};"] });
    rt.dispose();

    // A round that already keeps step code, even none, stays as it is.
    const kept = lldSession("interview");
    const rt2 = new SessionRuntime(t.deps, kept, problem);
    await rt2.init();
    expect(kept.stepCode).toEqual({});
    rt2.dispose();

    // A finished round reads no step code again.
    const ended: Partial<Session> = { ...lldSession("interview"), status: "ended" };
    delete ended.stepCode;
    const rt3 = new SessionRuntime(t.deps, ended as Session, problem);
    await rt3.init();
    expect(ended.stepCode).toEqual({});
    rt3.dispose();
  });
});

describe("pins", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }));
  afterEach(() => vi.useRealTimers());

  const elements = [
    { id: "f-design", type: "frame", x: 0, y: 500, width: 1560, height: 820, name: "High-level design", customData: { step: "design" }, frameId: null },
    { id: "lb", type: "rectangle", x: 100, y: 700, width: 160, height: 60, frameId: null },
    { id: "lb-t", type: "text", x: 110, y: 720, width: 140, height: 20, text: "Load balancer", originalText: "Load balancer", containerId: "lb", frameId: null },
  ];

  it("gives the guide a pin tool that refuses a made-up id and pins a real box in its step", async () => {
    let tools: string[] = [];
    const fake = createFakeDriver({ chunkDelayMs: 0 });
    const driver: Driver = { ...fake, startConversation: (s) => ((tools = s.tools.map((x) => x.name)), fake.startConversation(s)) };
    const t = setup(driver, "guided");
    const session = newSession("guided");
    const rt = await t.start(session);
    await rt.handle({ type: "board.update", version: 1, elements }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(tools).toContain("pin_note");
    await rt.handle({ type: "guided.feedback" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.pins).toHaveLength(1);
    expect(session.pins[0]).toMatchObject({ elementId: "lb", phase: "design", tone: "note", by: "guide" });
    const state = [...t.msgs].reverse().find((m) => m.type === "session.state");
    expect(state?.type === "session.state" && state.session.pins.length).toBe(1);
    rt.dispose();
  });

  it("gives the interviewer no pin tool and the browser no pins in an interview round", async () => {
    let tools: string[] = [];
    const fake = createFakeDriver({ chunkDelayMs: 0 });
    const driver: Driver = { ...fake, startConversation: (s) => ((tools = s.tools.map((x) => x.name)), fake.startConversation(s)) };
    const t = setup(driver, "interview");
    const session = newSession("interview");
    session.pins = [{ id: "p1", elementId: "lb", phase: "design", note: "x", tone: "note", by: "guide", at: 0 }];
    await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(tools).not.toContain("pin_note");
    const state = t.msgs.find((m) => m.type === "session.state");
    expect(state?.type === "session.state" && state.session.pins).toEqual([]);
  });
});

describe("the coach and the scorecard gaps", () => {
  const GAPS = ["Hot keys", "Cache stampede", "Retry storms"].map((title) => ({ title, severity: "major", whyItMatters: "x", whatGoodLooksLike: "y", teachMinutes: 8 }));

  /** A debriefed round, by default with its coach chat started, with the coach's tools and the turns it receives captured. */
  async function coachRoom({ started = true }: { started?: boolean } = {}) {
    const inner = createFakeDriver({ chunkDelayMs: 0 });
    let tools: RoomTool[] = [];
    const turns: UserTurn[] = [];
    const driver: Driver = {
      ...inner,
      startConversation(s) {
        if (s.role === "coach") tools = s.tools;
        const conv = inner.startConversation(s);
        const wrapped: Conversation = {
          sdkSessionId: () => conv.sdkSessionId(),
          close: () => conv.close(),
          send(turn, handlers) {
            if (s.role === "coach") turns.push(turn);
            return conv.send(turn, handlers);
          },
        };
        return wrapped;
      },
    };
    const t = setup(driver);
    const session = newSession("interview");
    session.status = "debriefed";
    session.scorecard = { gaps: GAPS, verdict: { sde2: "hire", senior: "lean_no_hire", summary: "ok" } } as unknown as Session["scorecard"];
    if (started) session.transcript.push({ id: "c0", at: 0, wall: new Date().toISOString(), channel: "coach", role: "coach", text: "Let's start." });
    const rt = new SessionRuntime(t.deps, session, await urlShortener());
    await rt.init();
    rt.attach(t.peer);
    const say = async (text: string) => {
      const before = turns.length;
      await rt.handle({ type: "chat.send", channel: "coach", clientMsgId: `m${before}-${text.length}`, text }, t.peer);
      await vi.waitFor(() => expect(turns.length).toBeGreaterThan(before));
    };
    const tool = (input: unknown) => tools.find((x) => x.name === "set_gap")!.run(input);
    const dividers = () => session.transcript.filter((e) => e.channel === "coach" && e.role === "system");
    return { t, rt, session, turns, say, tool, dividers };
  }

  it("sends no coach opening on its own, and one when the candidate starts the chat", async () => {
    const { rt, turns, t } = await coachRoom({ started: false });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(turns).toHaveLength(0);
    await rt.handle({ type: "coach.open" }, t.peer);
    await rt.handle({ type: "coach.open" }, t.peer);
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    expect(turns[0]?.meta).toMatchObject({ kind: "request", request: "coach_open" });
    await vi.waitFor(() => expect(t.msgs.some((m) => m.type === "chat.message" && m.entry.channel === "coach" && m.entry.role === "coach")).toBe(true));
    await rt.handle({ type: "coach.open" }, t.peer);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(turns).toHaveLength(1);
    rt.dispose();
  });

  it("runs a failed opening again on a second press, and refuses a press before the debrief", async () => {
    const inner = createFakeDriver({ chunkDelayMs: 0 });
    let failNext = true;
    const sends: UserTurn[] = [];
    const driver: Driver = {
      ...inner,
      startConversation(setupArgs) {
        const conv = inner.startConversation(setupArgs);
        return {
          sdkSessionId: () => conv.sdkSessionId(),
          close: () => conv.close(),
          send(turn, handlers) {
            if (setupArgs.role === "coach") {
              sends.push(turn);
              if (failNext) {
                failNext = false;
                return Promise.reject(new DriverError("The coach process stopped."));
              }
            }
            return conv.send(turn, handlers);
          },
        };
      },
    };
    const t = setup(driver);
    const session = newSession("interview");
    session.status = "debriefed";
    session.scorecard = { gaps: GAPS, verdict: { sde2: "hire", senior: "lean_no_hire", summary: "ok" } } as unknown as Session["scorecard"];
    const rt = new SessionRuntime(t.deps, session, await urlShortener());
    await rt.init();
    rt.attach(t.peer);
    await rt.handle({ type: "coach.open" }, t.peer);
    await vi.waitFor(() => expect(t.msgs.some((m) => m.type === "agent.status" && m.channel === "coach" && m.state === "error")).toBe(true));
    expect(session.transcript.some((e) => e.channel === "coach" && e.role === "coach")).toBe(false);
    await rt.handle({ type: "coach.open" }, t.peer);
    await vi.waitFor(() => expect(session.transcript.some((e) => e.channel === "coach" && e.role === "coach")).toBe(true));
    expect(sends.map((turn) => turn.meta)).toEqual([expect.objectContaining({ request: "coach_open" }), expect.objectContaining({ request: "coach_open" })]);
    session.status = "ended";
    await rt.handle({ type: "coach.open" }, t.peer);
    expect(t.msgs.some((m) => m.type === "error" && m.code === "coach_unavailable")).toBe(true);
    rt.dispose();
  });

  /** A debriefed room whose first coach send fails, after streaming `partial` when it is given. */
  async function failingCoachRoom(partial: string | null) {
    const inner = createFakeDriver({ chunkDelayMs: 0 });
    let failNext = true;
    const sends: UserTurn[] = [];
    const driver: Driver = {
      ...inner,
      startConversation(setupArgs) {
        const conv = inner.startConversation(setupArgs);
        return {
          sdkSessionId: () => conv.sdkSessionId(),
          close: () => conv.close(),
          send(turn, handlers) {
            if (setupArgs.role === "coach") {
              sends.push(turn);
              if (failNext) {
                failNext = false;
                if (partial) handlers.onTextDelta(partial);
                return Promise.reject(new DriverError("The coach process stopped."));
              }
            }
            return conv.send(turn, handlers);
          },
        };
      },
    };
    const t = setup(driver);
    const session = newSession("interview");
    session.status = "debriefed";
    session.scorecard = { gaps: GAPS, verdict: { sde2: "hire", senior: "lean_no_hire", summary: "ok" } } as unknown as Session["scorecard"];
    const rt = new SessionRuntime(t.deps, session, await urlShortener());
    await rt.init();
    rt.attach(t.peer);
    const failed = () => vi.waitFor(() => expect(t.msgs.some((m) => m.type === "agent.status" && m.channel === "coach" && m.state === "error")).toBe(true));
    return { t, rt, session, sends, failed };
  }

  it("runs an opening that failed part way again on a second press", async () => {
    const { t, rt, sends, failed } = await failingCoachRoom("Your deep dives held up well. ");
    await rt.handle({ type: "coach.open" }, t.peer);
    await failed();
    await rt.handle({ type: "coach.open" }, t.peer);
    await vi.waitFor(() => expect(sends).toHaveLength(2));
    expect(sends.map((turn) => turn.meta)).toEqual([expect.objectContaining({ request: "coach_open" }), expect.objectContaining({ request: "coach_open" })]);
    rt.dispose();
  });

  it("does not rerun a failed candidate turn when the start button is pressed", async () => {
    const { t, rt, sends, failed } = await failingCoachRoom(null);
    await rt.handle({ type: "chat.send", channel: "coach", clientMsgId: "q1", text: "Teach me this gap: Hot keys" }, t.peer);
    await failed();
    await rt.handle({ type: "coach.open" }, t.peer);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sends).toHaveLength(1);
    rt.dispose();
  });

  it("makes the candidate's first message the coach's first turn when the chat was never started", async () => {
    const { rt, turns, say } = await coachRoom({ started: false });
    await say("Teach me this gap: Hot keys");
    expect(turns).toHaveLength(1);
    expect(turns[0]?.meta).toMatchObject({ kind: "candidate" });
    rt.dispose();
  });

  it("records a gap the coach opens as the coach's, with one divider", async () => {
    const { rt, session, say, tool, dividers, t } = await coachRoom();
    await say("hello");
    const out = await tool({ title: "Hot keys", state: "started" });
    expect(out.isError).toBeUndefined();
    expect(session.gapProgress["Hot keys"]).toMatchObject({ by: "coach", state: "started" });
    expect(Number.isNaN(Date.parse(session.gapProgress["Hot keys"]!.at))).toBe(false);
    expect(dividers().map((e) => [e.text, e.kind, e.hidden])).toEqual([["Now on: Hot keys", "gap", undefined]]);
    const state = [...t.msgs].reverse().find((m) => m.type === "session.state");
    expect(state?.type === "session.state" && state.session.gapProgress["Hot keys"]?.by).toBe("coach");
    // The divider is saved with the transcript, so it comes back after a reload.
    await vi.waitFor(() => expect(t.store.saved?.transcript.some((e) => e.text === "Now on: Hot keys")).toBe(true));
    rt.dispose();
  });

  it("rejects a title the scorecard does not list, an unknown state and stray fields", async () => {
    const { rt, session, say, tool, dividers } = await coachRoom();
    await say("hello");
    for (const input of [
      { title: "Made up gap", state: "started" },
      { title: "hot keys", state: "started" },
      { title: "   ", state: "started" },
      { title: "x".repeat(301), state: "started" },
      { title: "__proto__", state: "started" },
      { title: "Hot keys", state: "mastered" },
      { title: "Hot keys", state: "started", by: "candidate" },
      {},
    ]) {
      expect((await tool(input)).isError).toBe(true);
    }
    expect(session.gapProgress).toEqual({});
    expect(Object.getPrototypeOf(session.gapProgress)).toBe(Object.prototype);
    expect(dividers()).toEqual([]);
    rt.dispose();
  });

  it("matches the title after trimming and moves the state without moving the divider", async () => {
    const { rt, session, say, tool, dividers } = await coachRoom();
    await say("hello");
    await tool({ title: "  Cache stampede ", state: "started" });
    await tool({ title: "Cache stampede", state: "started" });
    await tool({ title: "Cache stampede", state: "taught" });
    expect(session.gapProgress["Cache stampede"]?.state).toBe("taught");
    expect(dividers()).toHaveLength(1);
    await tool({ title: "Cache stampede", state: "core_only" });
    expect(session.gapProgress["Cache stampede"]?.state).toBe("core_only");
    rt.dispose();
  });

  it("records a Teach me this message as the candidate's and adds the divider", async () => {
    const { rt, session, say, dividers } = await coachRoom();
    await say(teachMessage({ title: "Retry storms" }));
    expect(session.gapProgress["Retry storms"]).toMatchObject({ by: "candidate", state: "started" });
    expect(dividers().map((e) => e.text)).toEqual(["Now on: Retry storms"]);
    // The divider follows his message in the transcript.
    const coachLines = session.transcript.filter((e) => e.channel === "coach").map((e) => e.role);
    expect(coachLines.slice(0, 3)).toEqual(["coach", "candidate", "system"]);
    rt.dispose();
  });

  it("accepts the message with stray spaces and ignores near misses", async () => {
    const { rt, session, say } = await coachRoom();
    await say(`  ${teachMessage({ title: "Hot keys" })}\n`);
    expect(Object.keys(session.gapProgress)).toEqual(["Hot keys"]);
    await say("Teach me this gap: Made up gap");
    await say(`${teachMessage({ title: "Retry storms" })} please`);
    await say("Teach me this gap: retry storms");
    expect(Object.keys(session.gapProgress)).toEqual(["Hot keys"]);
    rt.dispose();
  });

  it("never changes who opened a gap, and reopens a settled gap on a repeat click", async () => {
    const { rt, session, say, tool, dividers } = await coachRoom();
    await say(teachMessage({ title: "Hot keys" }));
    await tool({ title: "Hot keys", state: "taught" });
    expect(session.gapProgress["Hot keys"]).toMatchObject({ by: "candidate", state: "taught" });
    const taughtAt = session.gapProgress["Hot keys"]!.at;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await say(teachMessage({ title: "Hot keys" }));
    expect(session.gapProgress["Hot keys"]).toMatchObject({ by: "candidate", state: "started" });
    expect(Date.parse(session.gapProgress["Hot keys"]!.at)).toBeGreaterThan(Date.parse(taughtAt));

    await tool({ title: "Retry storms", state: "started" });
    await tool({ title: "Retry storms", state: "core_only" });
    await say(teachMessage({ title: "Retry storms" }));
    expect(session.gapProgress["Retry storms"]).toMatchObject({ by: "coach", state: "started" });
    // Hot keys, then Retry storms: a repeat click on the current gap added no second divider.
    expect(dividers().map((e) => e.text)).toEqual(["Now on: Hot keys", "Now on: Retry storms"]);
    rt.dispose();
  });

  it("adds a divider again when the coach comes back to an earlier gap", async () => {
    const { rt, say, tool, dividers } = await coachRoom();
    await say(teachMessage({ title: "Hot keys" }));
    await tool({ title: "Cache stampede", state: "started" });
    await say(teachMessage({ title: "Hot keys" }));
    expect(dividers().map((e) => e.text)).toEqual(["Now on: Hot keys", "Now on: Cache stampede", "Now on: Hot keys"]);
    rt.dispose();
  });

  it("never sends a divider to the coach as something the candidate said", async () => {
    const { rt, turns, say, tool } = await coachRoom();
    await say(teachMessage({ title: "Hot keys" }));
    await tool({ title: "Cache stampede", state: "started" });
    await say("ok");
    const candidateTexts = turns.filter((x) => x.meta.kind === "candidate").map((x) => x.meta.candidateText);
    expect(candidateTexts).toEqual([teachMessage({ title: "Hot keys" }), "ok"]);
    expect(turns.some((x) => x.meta.kind === "candidate" && x.text.includes("Now on:"))).toBe(false);
    rt.dispose();
  });

  it("still opens the coach after a restart when only a divider was saved", async () => {
    const { rt, session } = await coachRoom();
    rt.dispose();
    session.transcript.splice(0, session.transcript.length, {
      id: "d1",
      at: 0,
      wall: new Date().toISOString(),
      channel: "coach",
      role: "system",
      kind: "gap",
      text: "Now on: Hot keys",
    });
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }));
    const again = new SessionRuntime(t.deps, session, await urlShortener());
    await again.init();
    again.attach(t.peer);
    await again.handle({ type: "coach.open" }, t.peer);
    await vi.waitFor(() => expect(session.transcript.some((e) => e.channel === "coach" && e.role === "coach")).toBe(true));
    again.dispose();
  });

  it("has the fake coach record the first gap while it opens", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }));
    const session = newSession("interview");
    session.status = "debriefed";
    session.scorecard = { gaps: GAPS, verdict: { sde2: "hire", senior: "lean_no_hire", summary: "ok" } } as unknown as Session["scorecard"];
    const rt = new SessionRuntime(t.deps, session, await urlShortener());
    await rt.init();
    rt.attach(t.peer);
    await rt.handle({ type: "coach.open" }, t.peer);
    await vi.waitFor(() => expect(session.transcript.some((e) => e.channel === "coach" && e.role === "coach")).toBe(true));
    expect(session.gapProgress["Hot keys"]).toMatchObject({ by: "coach", state: "started" });
    rt.dispose();
  });
});

/** Answers like the fake driver, but a send that `slow` picks takes `delayMs` longer, as a long reply would. */
function slowWhen(slow: (turn: UserTurn) => boolean, delayMs: number): Driver {
  const inner = createFakeDriver({ chunkDelayMs: 0 });
  return {
    kind: "fake",
    runOnce: (s) => inner.runOnce(s),
    startConversation(s) {
      const conv = inner.startConversation(s);
      return {
        sdkSessionId: () => conv.sdkSessionId(),
        close: () => conv.close(),
        async send(turn, handlers) {
          if (slow(turn)) await new Promise((resolve) => setTimeout(resolve, delayMs));
          return conv.send(turn, handlers);
        },
      };
    },
  };
}

const saidBy = (marker: string) => (turn: UserTurn) => turn.meta.kind === "candidate" && (turn.meta.candidateText ?? "").includes(marker);

describe("the interviewer queue", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }));
  afterEach(() => vi.useRealTimers());

  it("answers his next message when a waiting phase nudge no longer applies because he moved on", async () => {
    const t = setup(slowWhen(saidBy("short links"), 2 * MIN));
    const session = newSession("interview");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(3.5 * MIN);
    await rt.handle({ type: "chat.send", channel: "interview", clientMsgId: "c1", text: "We need short links and redirects." }, t.peer);
    // The planned end of requirements passes while that reply streams, so its nudge waits in the queue.
    await vi.advanceTimersByTimeAsync(1.5 * MIN);
    await rt.handle({ type: "phase.set", phase: "entities" }, t.peer);
    await rt.handle({ type: "chat.send", channel: "interview", clientMsgId: "c2", text: "About 100 million links a month." }, t.peer);
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(interviewerTexts(t.msgs)).toHaveLength(3);
    expect(session.status).toBe("live");
    rt.dispose();
  });

  it("closes and debriefs when a long reply runs past both the five-minute warning and time up", async () => {
    const t = setup(slowWhen(saidBy("sum up"), 7 * MIN));
    const session = newSession("interview");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(39 * MIN + 30_000);
    await rt.handle({ type: "chat.send", channel: "interview", clientMsgId: "c1", text: "Let me sum up the design." }, t.peer);
    await vi.advanceTimersByTimeAsync(8 * MIN);
    expect(interviewerTexts(t.msgs).at(-1)).toBe("We're out of time, so let's stop here. Thank you.");
    expect(session.status).toBe("debriefed");
    rt.dispose();
  });
});

describe("freezing the work at the end", () => {
  const ATTEMPT = "lld/parking-lot/attempt-2026-10-30.cpp";
  const HEADER = "// Parking Lot attempt, 2026-10-30\n";
  let root = "";

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    root = await mkdtemp(join(tmpdir(), "ir-freeze-"));
    await mkdir(join(root, "lld", "parking-lot"), { recursive: true });
    await writeFile(join(root, ATTEMPT), HEADER);
  });
  afterEach(async () => {
    vi.useRealTimers();
    await rm(root, { recursive: true, force: true });
  });

  async function parkingLotRound(durationMs = 90 * MIN) {
    const file = join(APP_ROOT, "content", "problems", "lld", "b3-parking-lot.md");
    const problem = parseProblem(await readFile(file, "utf8"), file, false);
    const session: Session = {
      ...newSession("interview"),
      id: "20261030-1000-b3-parking-lot-abcd",
      problemId: "b3-parking-lot",
      title: "Parking Lot",
      track: "lld",
      durationMs,
      phase: "clarify",
      phaseHistory: [{ phase: "clarify", at: 0, by: "candidate" }],
      code: { path: ATTEMPT, version: 0, lastRun: null },
    };
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }), "interview", root);
    const rt = await t.start(session, problem);
    return { t, rt, session };
  }

  it("waits longer before a check-in in machine coding, and a code edit restarts the wait", async () => {
    const { t, rt } = await parkingLotRound();
    await vi.advanceTimersByTimeAsync(5 * MIN);
    await rt.handle({ type: "code.update", version: 1, content: `${HEADER}class Lot {};\n` }, t.peer);
    await vi.advanceTimersByTimeAsync(8 * MIN - 1_000);
    expect(checkIns(t.msgs)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(checkIns(t.msgs)).toHaveLength(1);
    rt.dispose();
  });

  it("judges the code he typed just before he ended the round", async () => {
    const { t, rt, session } = await parkingLotRound();
    await vi.advanceTimersByTimeAsync(1_000);
    const last = `${HEADER}int main() { return 0; }\n`;
    // The page sends its last edit and the end together, without waiting for the edit to be saved.
    const edit = rt.handle({ type: "code.update", version: 1, content: last }, t.peer);
    await rt.handle({ type: "session.end" }, t.peer);
    await edit;
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      expect(session.status).toBe("debriefed");
    });
    expect(t.store.code).toBe(last);
    rt.dispose();
  });

  it("keeps board and code edits that land just after time is up, and refuses them once the work is frozen", async () => {
    const { t, rt, session } = await parkingLotRound(20 * MIN);
    await vi.advanceTimersByTimeAsync(20 * MIN + 200);
    expect(["ended", "debriefing"]).toContain(session.status);
    const late = `${HEADER}class Lot {};\n`;
    const elements = [{ id: "r1", type: "rectangle", x: 0, y: 0, width: 100, height: 60, frameId: null }];
    await rt.handle({ type: "code.update", version: 1, content: late }, t.peer);
    await rt.handle({ type: "board.update", version: 1, elements }, t.peer);
    expect(t.msgs.some((m) => m.type === "error")).toBe(false);
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      expect(session.status).toBe("debriefed");
    });
    expect(t.store.code).toBe(late);
    expect(session.board.version).toBe(1);
    expect(t.store.board.version).toBe(1);

    await rt.handle({ type: "code.update", version: 2, content: `${late}// after\n` }, t.peer);
    expect(t.msgs.at(-1)).toMatchObject({ type: "error", code: "not_live", message: "The round is over, so the code file is frozen." });
    expect(t.store.code).toBe(late);
    rt.dispose();
  });
});

describe("a stale code update", () => {
  const ATTEMPT = "lld/parking-lot/attempt-2026-10-30.cpp";
  const HEADER = "// Parking Lot attempt, 2026-10-30\n";
  let root = "";

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    root = await mkdtemp(join(tmpdir(), "ir-stale-"));
    await mkdir(join(root, "lld", "parking-lot"), { recursive: true });
    await writeFile(join(root, ATTEMPT), HEADER);
  });
  afterEach(async () => {
    vi.useRealTimers();
    await rm(root, { recursive: true, force: true });
  });

  it("is refused out loud to the peer that sent it, and keeps the server's text", async () => {
    const file = join(APP_ROOT, "content", "problems", "lld", "b3-parking-lot.md");
    const problem = parseProblem(await readFile(file, "utf8"), file, false);
    const session: Session = {
      ...newSession("interview"),
      id: "20261030-1000-b3-parking-lot-abcd",
      problemId: "b3-parking-lot",
      title: "Parking Lot",
      track: "lld",
      durationMs: 90 * MIN,
      phase: "clarify",
      phaseHistory: [{ phase: "clarify", at: 0, by: "candidate" }],
      code: { path: ATTEMPT, version: 0, lastRun: null },
    };
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }), "interview", root);
    const rt = await t.start(session, problem);
    const otherMsgs: ServerMsg[] = [];
    const other: Peer = { id: "p2", send: (m) => void otherMsgs.push(m), close() {} };
    rt.attach(other);
    await vi.advanceTimersByTimeAsync(1_000);

    await rt.handle({ type: "code.update", version: 3, content: `${HEADER}int a;\n` }, t.peer);
    expect(t.msgs.some((m) => m.type === "code.rejected")).toBe(false);
    await rt.handle({ type: "code.update", version: 3, content: `${HEADER}int b;\n` }, t.peer);
    expect(t.msgs.findLast((m) => m.type === "code.rejected")).toEqual({ type: "code.rejected", version: 3, held: 3 });
    expect(otherMsgs.some((m) => m.type === "code.rejected")).toBe(false);
    expect(await readFile(join(root, ATTEMPT), "utf8")).toBe(`${HEADER}int a;\n`);
    expect(session.code?.version).toBe(3);
    rt.dispose();
  });
});

describe("reopening a round", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }));
  afterEach(() => vi.useRealTimers());

  const OPENING = "Let's design a URL shortener, something like bit.ly. Where would you like to start?";

  it("opens the round on resume when the server stopped before the opening reply", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }));
    const session = newSession("interview");
    session.status = "paused";
    session.pauseReason = "restart";
    session.pauseStartedAt = new Date().toISOString();
    const rt = new SessionRuntime(t.deps, session, await urlShortener());
    await rt.init();
    rt.attach(t.peer);
    await rt.handle({ type: "session.resume" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(interviewerTexts(t.msgs)).toEqual([OPENING]);
    rt.dispose();
  });

  it("opens first and then answers a message he sent before the opening arrived", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }));
    const session = newSession("interview");
    session.status = "paused";
    session.pauseReason = "error";
    session.pauseStartedAt = new Date().toISOString();
    session.transcript.push({ id: "m1", at: 1_000, wall: new Date().toISOString(), channel: "interview", role: "candidate", text: "Hello?" });
    const rt = new SessionRuntime(t.deps, session, await urlShortener());
    await rt.init();
    rt.attach(t.peer);
    await rt.handle({ type: "session.resume" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(interviewerTexts(t.msgs)).toEqual([OPENING, "Okay. What would you do next in requirements?"]);
    rt.dispose();
  });

  it("opens a brand-new round exactly once", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }));
    const rt = await t.start(newSession("interview"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(interviewerTexts(t.msgs)).toEqual([OPENING]);
    rt.dispose();
  });
});

describe("dropping an idle round from memory", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }));
  afterEach(() => vi.useRealTimers());

  it("keeps a paused round whose pause note the interviewer has not heard yet", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }));
    const session = newSession("interview");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    await rt.handle({ type: "session.pause" }, t.peer);
    rt.detach(t.peer);
    expect(rt.isDormant()).toBe(false);
    rt.dispose();
  });

  it("keeps a paused round with a turn still waiting in the queue", async () => {
    const { driver } = flakyDriver((n) => n === 2);
    const t = setup(driver);
    const session = newSession("interview");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(500);
    await rt.handle({ type: "chat.send", channel: "interview", clientMsgId: "c1", text: "Requirements first." }, t.peer);
    await vi.advanceTimersByTimeAsync(500);
    expect(session.pauseReason).toBe("error");
    rt.detach(t.peer);
    expect(rt.isDormant()).toBe(false);
    rt.dispose();
  });

  it("lets a finished round go, even with a pause note the interviewer never heard", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }));
    const session = newSession("interview");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    await rt.handle({ type: "session.pause" }, t.peer);
    await rt.handle({ type: "session.resume" }, t.peer);
    await rt.handle({ type: "session.end" }, t.peer);
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      expect(session.status).toBe("debriefed");
    });
    rt.detach(t.peer);
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      expect(rt.isDormant()).toBe(true);
    });
    rt.dispose();
  });
});

describe("an end the interviewer asked for in a failed turn", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }));
  afterEach(() => vi.useRealTimers());

  it("does not end the round after the next reply once that turn failed", async () => {
    const inner = createFakeDriver({ chunkDelayMs: 0 });
    let calls = 0;
    const driver: Driver = {
      kind: "fake",
      runOnce: (s) => inner.runOnce(s),
      startConversation(s) {
        const conv = inner.startConversation(s);
        return {
          sdkSessionId: () => conv.sdkSessionId(),
          close: () => conv.close(),
          async send(turn, handlers) {
            calls += 1;
            if (calls === 2) {
              // The model asked to end, then the turn broke before its reply was in.
              await s.tools.find((x) => x.name === "end_interview")!.run({ reason: "He said he was done." });
              throw new DriverError("The model is rate limited right now. Wait a minute, then retry.");
            }
            return conv.send(turn, handlers);
          },
        };
      },
    };
    const t = setup(driver);
    const session = newSession("interview");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(500);
    await rt.handle({ type: "chat.send", channel: "interview", clientMsgId: "c1", text: "I think that covers it." }, t.peer);
    await vi.advanceTimersByTimeAsync(500);
    expect(session.pauseReason).toBe("error");
    await rt.handle({ type: "session.resume" }, t.peer);
    await vi.advanceTimersByTimeAsync(500);
    await rt.handle({ type: "chat.send", channel: "interview", clientMsgId: "c2", text: "Actually, one more thing on capacity." }, t.peer);
    await vi.advanceTimersByTimeAsync(500);
    expect(session.status).toBe("live");
    expect(interviewerTexts(t.msgs).length).toBeGreaterThanOrEqual(3);
    rt.dispose();
  });
});

describe("saving study notes", () => {
  const C2 = "### C2. Classic HLD Problems";
  let study: TempStudyRoot;
  beforeEach(async () => {
    study = await makeCustomRoot({ "TRACKER.md": `# Tracker\n\n${C2}\n- [ ] URL Shortener\n`, "REVIEW.md": "# Review\n" });
  });
  afterEach(async () => {
    await study.cleanup();
  });

  it("saves a draft once when Save arrives twice", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }), "interview", study.root);
    const session = newSession("interview");
    session.status = "debriefed";
    session.transcript.push({ id: "c0", at: 0, wall: new Date().toISOString(), channel: "coach", role: "coach", text: "Let's start." });
    const rt = new SessionRuntime(t.deps, session, await urlShortener());
    await rt.init();
    rt.attach(t.peer);
    const proposal = await planProposal(
      study.root,
      session.id,
      [{ kind: "tracker_update_bullet", section: C2, bullet: "URL Shortener", mark: "[~]", appendSuffix: "→ notes/c2-url-shortener.md · 2026-10-30" }],
      t.deps.guard,
    );
    expect(proposal.ops.every((o) => o.blocked === null)).toBe(true);
    await t.store.saveProposal(session.id, proposal);
    const opIds = proposal.ops.map((o) => o.id);
    await Promise.all([
      rt.handle({ type: "bookkeeping.apply", proposalId: proposal.id, opIds }, t.peer),
      rt.handle({ type: "bookkeeping.apply", proposalId: proposal.id, opIds }, t.peer),
    ]);
    expect(t.msgs.some((m) => m.type === "error")).toBe(false);
    expect(t.msgs.filter((m) => m.type === "bookkeeping.applied")).toHaveLength(1);
    // The second Save gets the saved draft back, so its page stops waiting.
    expect(t.msgs.findLast((m) => m.type === "bookkeeping.proposal")).toMatchObject({ proposal: { id: proposal.id, status: "applied" } });
    expect(t.store.proposals.get(proposal.id)?.status).toBe("applied");
    expect(session.studyNotes).toMatchObject({ proposalId: proposal.id, status: "applied", appliedCount: 1 });
    expect((await study.read("TRACKER.md")).match(/notes\/c2-url-shortener\.md/g)).toHaveLength(1);
    rt.dispose();
  });

  it("keeps the time of the last save when a new draft starts", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }), "interview", study.root);
    const session = newSession("interview");
    session.status = "debriefed";
    session.scorecard = {
      verdict: { sde2: "hire", senior: "lean_no_hire", confidence: "medium", summary: "s" },
      dimensions: [],
      steps: [],
      strengths: [],
      gaps: [],
      timeline: [],
      practiceTask: "p",
      trackerMark: "[~]",
      trackerMarkReason: "r",
      lldScenarios: [],
    };
    session.studyNotes = { proposalId: "old", status: "applied", appliedCount: 2, savedAt: "2026-10-30T10:00:00.000Z" };
    const rt = new SessionRuntime(t.deps, session, await urlShortener());
    await rt.init();
    rt.attach(t.peer);
    await rt.handle({ type: "bookkeeping.draft" }, t.peer);
    await vi.waitFor(() => expect(t.msgs.some((m) => m.type === "bookkeeping.proposal" || m.type === "error")).toBe(true));
    expect(session.studyNotes).toMatchObject({ appliedCount: 0, savedAt: "2026-10-30T10:00:00.000Z" });
    rt.dispose();
  });
});

describe("step quotes in the debrief", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }));
  afterEach(() => vi.useRealTimers());

  it("fails a step quote that was said only in another step", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }));
    const session = newSession("interview");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    await rt.handle({ type: "phase.set", phase: "entities" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    await rt.handle({ type: "chat.send", channel: "interview", clientMsgId: "c1", text: "Reads outnumber writes by a hundred to one here." }, t.peer);
    await rt.handle({ type: "session.end" }, t.peer);
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      expect(session.status).toBe("debriefed");
    });
    // The fake judge quotes his only line under the first step, but he said it in the entities step.
    const first = session.scorecard?.steps?.[0]?.phase;
    expect(first).toBe("requirements");
    expect(session.scorecard?.stepQuoteChecks?.filter((c) => c.phase === first).map((c) => c.verified)).toEqual([false]);
    rt.dispose();
  });
});

describe("guided step verdicts, assists and move-on offers", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }));
  afterEach(() => vi.useRealTimers());

  /** A fake driver that records the interviewer's tools and the turns it gets, and can add to a turn's reply. */
  function watched(onTurn?: (turn: UserTurn, tool: (name: string, input: unknown) => Promise<{ text: string; isError: boolean }>) => Promise<void>) {
    const fake = createFakeDriver({ chunkDelayMs: 0 });
    let tools: RoomTool[] = [];
    const turns: UserTurn[] = [];
    const tool = async (name: string, input: unknown) => {
      const found = tools.find((x) => x.name === name);
      if (!found) throw new Error(`no ${name} tool`);
      const out = await found.run(input);
      return { text: out.content.map((c) => ("text" in c ? c.text : "")).join(""), isError: out.isError === true };
    };
    const driver: Driver = {
      ...fake,
      startConversation(s) {
        if (s.role !== "coach") tools = s.tools;
        const conv = fake.startConversation(s);
        return {
          sdkSessionId: () => conv.sdkSessionId(),
          close: () => conv.close(),
          async send(turn, handlers) {
            if (s.role !== "coach") turns.push(turn);
            await onTurn?.(turn, tool);
            return conv.send(turn, handlers);
          },
        };
      },
    };
    return { driver, tool, turns, toolNames: () => tools.map((x) => x.name) };
  }

  const lastState = (msgs: ServerMsg[]) => {
    const m = [...msgs].reverse().find((x) => x.type === "session.state");
    if (m?.type !== "session.state") throw new Error("no session.state");
    return m.session;
  };

  /** His written answer for a step, so the step holds evidence the checker can read; the fake checker covers each label line. */
  const write = (session: Session, phase: string, text?: string) => {
    session.stepNotes = { ...session.stepNotes, [phase]: text ?? (session.checklist[phase] ?? []).map((i) => i.label).join("\n") };
  };
  /** A tool call that may wait for a checker run, with the fake clock moved on while it waits. */
  const settled = async <T>(call: Promise<T>): Promise<T> => {
    await vi.advanceTimersByTimeAsync(1_000);
    return call;
  };

  it("gives only the guide a step_verdict tool", async () => {
    for (const mode of ["guided", "interview"] as const) {
      const w = watched();
      const t = setup(w.driver, mode);
      const rt = await t.start(newSession(mode));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(w.toolNames().includes("step_verdict")).toBe(mode === "guided");
      rt.dispose();
    }
  });

  it("stores verdicts, keeps a pass, and shows the room the update", async () => {
    const w = watched();
    const t = setup(w.driver, "guided");
    const session = newSession("guided");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);

    expect((await w.tool("step_verdict", { phase: "requirements", verdict: "not_yet" })).isError).toBe(true);
    expect((await w.tool("step_verdict", { phase: "nowhere", verdict: "pass" })).isError).toBe(true);
    expect((await w.tool("step_verdict", { phase: "requirements", verdict: "pass", extra: true })).isError).toBe(true);
    expect(session.stepVerdicts).toBeUndefined();

    expect((await w.tool("step_verdict", { phase: "requirements", verdict: "not_yet", gap: "What latency does a redirect need?" })).isError).toBe(false);
    expect(lastState(t.msgs).stepVerdicts?.requirements).toMatchObject({ verdict: "not_yet", gap: "What latency does a redirect need?" });

    write(session, "requirements");
    expect((await settled(w.tool("step_verdict", { phase: "requirements", verdict: "pass" }))).isError).toBe(false);
    const refused = await w.tool("step_verdict", { phase: "requirements", verdict: "not_yet", gap: "One more thing" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("already passed");
    expect(lastState(t.msgs).stepVerdicts?.requirements?.verdict).toBe("pass");
    rt.dispose();
  });

  it("refuses a pass the step's reading does not support, and names the open items to the guide", async () => {
    const w = watched();
    const t = setup(w.driver, "guided");
    const session = newSession("guided");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    const items = session.checklist.requirements ?? [];
    expect(items.length).toBeGreaterThanOrEqual(4);
    const covered = { state: "covered" as const, source: "notes" as const, at: null, quote: "Draft", detail: "" };
    write(session, "requirements", "Draft");
    session.stepChecks = { ...session.stepChecks, requirements: { status: "done", checkedAt: 2_000, usedImage: false, items: { [items[0]!.id]: covered } } };

    const refused = await settled(w.tool("step_verdict", { phase: "requirements", verdict: "pass" }));
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain(`covers 1 of ${items.length} checklist items, and a pass needs at least ${Math.ceil(items.length / 2)}`);
    expect(refused.text).toContain(items[1]!.label);
    expect(refused.text).not.toContain(`${items[0]!.label};`);
    expect(refused.text).toContain("recheck_step");
    expect(session.stepVerdicts).toBeUndefined();

    const enough = Object.fromEntries(items.slice(0, Math.ceil(items.length / 2)).map((i) => [i.id, covered]));
    session.stepChecks = { ...session.stepChecks, requirements: { status: "done", checkedAt: 3_000, usedImage: false, items: enough } };
    const passed = await w.tool("step_verdict", { phase: "requirements", verdict: "pass" });
    expect(passed.isError).toBe(false);
    expect(passed.text).toContain("Steps now: passed: Requirements · not passed yet: Core entities, API, High-level design, Deep dives.");
    expect(session.stepVerdicts?.requirements?.verdict).toBe("pass");
    rt.dispose();
  });

  it("passes Deep dives on one covered item, and refuses a step that holds nothing of his", async () => {
    const w = watched();
    const t = setup(w.driver, "guided");
    const session = newSession("guided");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    const empty = await settled(w.tool("step_verdict", { phase: "api", verdict: "pass" }));
    expect(empty.isError).toBe(true);
    expect(empty.text).toContain("API cannot pass: he has said nothing in this step");

    const dives = session.checklist.deep_dives ?? [];
    expect(dives.length).toBeGreaterThanOrEqual(3);
    write(session, "deep_dives", "Draft");
    const covered = { state: "covered" as const, source: "notes" as const, at: null, quote: "Draft", detail: "" };
    expect((await settled(w.tool("step_verdict", { phase: "deep_dives", verdict: "pass" }))).text).toContain("a pass needs at least 1");
    session.stepChecks = { ...session.stepChecks, deep_dives: { status: "done", checkedAt: 3_000, usedImage: false, items: { [dives[0]!.id]: covered } } };
    expect((await settled(w.tool("step_verdict", { phase: "deep_dives", verdict: "pass" }))).isError).toBe(false);
    rt.dispose();
  });

  it("judges a pass on the reading that just finished, even when he edits while the checker reads", async () => {
    const w = watched();
    const session = newSession("guided");
    const driver: Driver = {
      ...w.driver,
      runOnce: async (spec) => {
        const out = await w.driver.runOnce(spec);
        if (spec.role === "checker") session.stepNotes = { ...session.stepNotes, requirements: "Draft more" };
        return out;
      },
    };
    const t = setup(driver, "guided");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    write(session, "requirements", "Draft");
    const out = await settled(w.tool("step_verdict", { phase: "requirements", verdict: "pass" }));
    expect(out).toMatchObject({ isError: true, text: expect.stringContaining("cannot pass yet") });
    expect(session.stepVerdicts).toBeUndefined();
    rt.dispose();
  });

  it("leaves the pass to the guide when the checker fails on his newest work after an earlier reading refused it", async () => {
    const w = watched();
    let down = false;
    const driver: Driver = { ...w.driver, runOnce: async (spec) => (spec.role === "checker" && down ? Promise.reject(new Error("checker down")) : w.driver.runOnce(spec)) };
    const t = setup(driver, "guided");
    const session = newSession("guided");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    write(session, "requirements", "Draft");
    expect((await settled(w.tool("step_verdict", { phase: "requirements", verdict: "pass" }))).isError).toBe(true);
    down = true;
    write(session, "requirements", "Draft two");
    expect((await settled(w.tool("step_verdict", { phase: "requirements", verdict: "pass" }))).isError).toBe(false);
    rt.dispose();
  });

  it("waits for a check that is already running instead of asking the checker again", async () => {
    const w = watched();
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let checks = 0;
    const driver: Driver = {
      ...w.driver,
      runOnce: async (spec) => {
        if (spec.role !== "checker") return w.driver.runOnce(spec);
        checks += 1;
        await gate;
        return w.driver.runOnce(spec);
      },
    };
    const t = setup(driver, "guided");
    const session = newSession("guided");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    write(session, "requirements");
    await rt.handle({ type: "guided.feedback" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(checks).toBe(1);
    const pass = w.tool("step_verdict", { phase: "requirements", verdict: "pass" });
    await vi.advanceTimersByTimeAsync(1_000);
    release();
    expect((await settled(pass)).isError).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(checks).toBe(1);
    expect(session.stepVerdicts?.requirements?.verdict).toBe("pass");
    rt.dispose();
  });

  it("refuses a pass once the room is disposed", async () => {
    const w = watched();
    const t = setup(w.driver, "guided");
    const session = newSession("guided");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    write(session, "requirements");
    rt.dispose();
    expect(await w.tool("step_verdict", { phase: "requirements", verdict: "pass" })).toMatchObject({ isError: true, text: expect.stringContaining("not live") });
    expect(session.stepVerdicts).toBeUndefined();
  });

  it("leaves the pass to the guide when the checker cannot read his latest work, and refuses one after the end", async () => {
    const w = watched();
    const driver: Driver = { ...w.driver, runOnce: async (spec) => (spec.role === "checker" ? Promise.reject(new Error("checker down")) : w.driver.runOnce(spec)) };
    const t = setup(driver, "guided");
    const session = newSession("guided");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    write(session, "api", "Draft");
    expect((await settled(w.tool("step_verdict", { phase: "api", verdict: "pass" }))).isError).toBe(false);

    write(session, "entities");
    session.status = "ended";
    const late = await settled(w.tool("step_verdict", { phase: "entities", verdict: "pass" }));
    expect(late).toMatchObject({ isError: true, text: expect.stringContaining("not live") });
    rt.dispose();
  });

  it("after a step's second 'Not yet', gives a count of what is open and pins nothing", async () => {
    const w = watched();
    const t = setup(w.driver, "guided");
    const session = newSession("guided");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    const items = session.checklist.requirements ?? [];
    write(session, "requirements", "Draft");
    session.stepVerdicts = { requirements: { verdict: "not_yet", gap: "What latency does a redirect need?", at: 1, misses: 2 } };
    const covered = { state: "covered" as const, source: "notes" as const, at: null, quote: "Draft", detail: "" };
    session.stepChecks = { ...session.stepChecks, requirements: { status: "done", checkedAt: 2, usedImage: false, items: { [items[0]!.id]: covered } } };
    const frame = (id: string, y: number, name: string, step: string) => ({ id, type: "frame", x: 0, y, width: 1560, height: 440, name, customData: { step }, frameId: null });
    const box = (id: string, y: number, label: string) => [
      { id, type: "rectangle", x: 40, y, width: 160, height: 60, frameId: null, boundElements: [{ type: "text", id: `${id}-t` }] },
      { id: `${id}-t`, type: "text", x: 50, y: y + 20, width: 140, height: 20, text: label, originalText: label, containerId: id, frameId: null },
    ];
    const elements = [
      frame("f-req", 0, "Requirements", "requirements"),
      frame("f-design", 500, "High-level design", "design"),
      ...box("note", 60, "Draft note"),
      ...box("svc", 600, "Service"),
    ];
    await rt.handle({ type: "board.update", version: 1, elements }, t.peer);
    await rt.handle({ type: "guided.feedback" }, t.peer);
    await vi.advanceTimersByTimeAsync(2_000);
    const request = w.turns.find((x) => x.meta.request === "feedback")?.text ?? "";
    expect(request).toContain(`so this check names nothing`);
    expect(request).toContain(`say that ${items.length - 1} things are still open`);
    expect(session.stepVerdicts?.requirements).toMatchObject({
      verdict: "not_yet",
      gap: `${items.length - 1} things are still open. Press Hint for a nudge toward the next one.`,
      misses: 3,
    });
    expect(session.pins).toEqual([]);
    expect(await w.tool("pin_note", { elementId: "note", note: "Say how many links a month." })).toMatchObject({
      isError: true,
      text: expect.stringContaining("pin nothing there"),
    });
    expect((await w.tool("pin_note", { elementId: "svc", note: "Say what this box does." })).isError).toBe(false);
    session.phase = "design";
    expect((await w.tool("pin_note", { elementId: "note", note: "Say how many links a month." })).isError).toBe(true);
    session.phase = "requirements";
    // Work added after the last reading makes its count stale, so the page gives no number.
    write(session, "requirements", "Draft and more");
    await w.tool("step_verdict", { phase: "requirements", verdict: "not_yet" });
    expect(session.stepVerdicts?.requirements?.gap).toBe("Some things are still open. Press Hint for a nudge toward the next one.");

    await rt.handle({ type: "guided.hint" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(w.turns.find((x) => x.meta.request === "hint")?.text).toContain("this hint is how he hears the next open item");
    rt.dispose();
  });

  it("gives a count also when the step is checked in a chat turn, and accepts an empty gap there", async () => {
    const w = watched();
    const t = setup(w.driver, "guided");
    const session = newSession("guided");
    session.stepVerdicts = {
      requirements: { verdict: "not_yet", gap: "What latency does a redirect need?", at: 1, misses: 2 },
      deep_dives: { verdict: "not_yet", gap: "How are codes made unique?", at: 2, misses: 2 },
    };
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    await rt.handle({ type: "chat.send", channel: "interview", clientMsgId: "c1", text: "Is my requirements step done now?" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(w.turns.find((x) => x.meta.kind === "candidate")?.text).toContain("checks give only a count: Requirements, Deep dives");

    const named = await w.tool("step_verdict", { phase: "requirements", verdict: "not_yet", gap: "You have not asked how many links are created." });
    expect(named.text).toContain("Name nothing that is missing");
    expect(session.stepVerdicts?.requirements?.gap).toBe("Some things are still open. Press Hint for a nudge toward the next one.");
    expect((await w.tool("step_verdict", { phase: "deep_dives", verdict: "not_yet", gap: "" })).isError).toBe(false);
    expect(session.stepVerdicts?.deep_dives?.gap).toBe("Some things are still open. Press Hint for a nudge toward the next one.");

    write(session, "deep_dives", "Draft");
    await settled(w.tool("recheck_step", { phase: "deep_dives" }));
    await w.tool("step_verdict", { phase: "deep_dives", verdict: "not_yet" });
    expect(session.stepVerdicts?.deep_dives?.gap).toBe("One thing is still open. Press Hint for a nudge toward it.");
    rt.dispose();
  });

  it("marks the source gap practised when a gap round passes its step unaided, and takes the mark back after a model answer there", async () => {
    const w = watched();
    const t = setup(w.driver, "guided");
    const calls: unknown[] = [];
    t.deps.gapPractice = (source, mark, roundId) => void calls.push({ source, mark, roundId });
    const session = newSession("guided");
    const source = { sessionId: "20261028-1000-c2-url-shortener-wxyz", gapTitle: "Asking for the scale first", step: "requirements" };
    session.focus = { title: source.gapTitle, goodLooksLike: "Ask for the load first.", source };
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    write(session, "entities");
    await settled(w.tool("step_verdict", { phase: "entities", verdict: "pass" }));
    expect(calls).toEqual([]);
    write(session, "requirements");
    expect((await settled(w.tool("step_verdict", { phase: "requirements", verdict: "pass" }))).isError).toBe(false);
    expect(calls).toEqual([{ source, mark: { sessionId: session.id, at: expect.any(String) }, roundId: session.id }]);
    await rt.handle({ type: "guided.stuck" }, t.peer);
    expect(calls[1]).toEqual({ source, mark: null, roundId: session.id });
    rt.dispose();
  });

  it("does not mark a gap whose step had a model answer before its pass", async () => {
    const w = watched();
    const t = setup(w.driver, "guided");
    const calls: unknown[] = [];
    t.deps.gapPractice = (source, mark, roundId) => void calls.push({ source, mark, roundId });
    const session = newSession("guided");
    const source = { sessionId: "20261028-1000-c2-url-shortener-wxyz", gapTitle: "Asking for the scale first", step: "requirements" };
    session.focus = { title: source.gapTitle, goodLooksLike: "Ask for the load first.", source };
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    await rt.handle({ type: "guided.stuck" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    write(session, "requirements");
    expect((await settled(w.tool("step_verdict", { phase: "requirements", verdict: "pass" }))).isError).toBe(false);
    expect(calls).toEqual([]);
    rt.dispose();
  });

  it("names the gap on a step's first two checks", async () => {
    const w = watched();
    const t = setup(w.driver, "guided");
    const session = newSession("guided");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    session.stepVerdicts = { requirements: { verdict: "not_yet", gap: "What latency does a redirect need?", at: 1 } };
    write(session, "requirements", "Draft");
    await rt.handle({ type: "guided.feedback" }, t.peer);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(w.turns.find((x) => x.meta.request === "feedback")?.text).toContain("name the one most important gap");
    expect(session.stepVerdicts?.requirements).toMatchObject({ verdict: "not_yet", gap: "What latency does the read path need to meet?", misses: 2 });
    rt.dispose();
  });

  it("tells the guide after H3 to point at 'I'm stuck' instead of giving a model answer", async () => {
    const w = watched();
    const t = setup(w.driver, "guided");
    const session = newSession("guided");
    session.hints = [{ at: 1, level: 3, topic: "scale" }];
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    await rt.handle({ type: "guided.hint" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    const hint = w.turns.find((x) => x.meta.request === "hint")?.text ?? "";
    expect(hint).toContain("Rungs already given on this step: H3.");
    expect(hint).toContain(`Give no model answer: start another open point at H1`);
    rt.dispose();
  });

  it("tells the guide on every turn which steps passed, and tells an interviewer nothing of the kind", async () => {
    for (const mode of ["guided", "interview"] as const) {
      const w = watched();
      const t = setup(w.driver, mode);
      const session = newSession(mode);
      session.stepVerdicts = mode === "guided" ? { entities: { verdict: "pass", at: 1 } } : undefined;
      const rt = await t.start(session);
      await vi.advanceTimersByTimeAsync(1_000);
      await rt.handle({ type: "chat.send", channel: "interview", clientMsgId: "s1", text: "Are we done?" }, t.peer);
      await vi.advanceTimersByTimeAsync(1_000);
      const said = w.turns.find((x) => x.meta.kind === "candidate")?.text ?? "";
      expect(said).toContain("Are we done?");
      if (mode === "guided") expect(said).toContain("steps: passed: Core entities · not passed yet: Requirements, API, High-level design, Deep dives");
      else expect(said).not.toContain("steps:");
      rt.dispose();
    }
  });

  it("asks the guide for a verdict on a step check, and never sends the checklist to the room", async () => {
    const w = watched();
    const t = setup(w.driver, "guided");
    const session = newSession("guided");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    await rt.handle({ type: "guided.feedback" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    const request = w.turns.find((x) => x.meta.request === "feedback");
    expect(request?.text).toContain("Call step_verdict once for this step");
    // The fake guide names a gap on the first check, then passes on the next.
    expect(session.stepVerdicts?.requirements?.verdict).toBe("not_yet");
    await rt.handle({ type: "guided.feedback" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    // Nothing of his is in the step yet, so the fake guide's pass is refused and the step stays "not yet".
    expect(session.stepVerdicts?.requirements?.verdict).toBe("not_yet");
    write(session, "requirements");
    await rt.handle({ type: "guided.feedback" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.stepVerdicts?.requirements?.verdict).toBe("pass");
    expect(lastState(t.msgs).steps).toEqual({});
    rt.dispose();
  });

  it("records an assist itself on 'I'm stuck', asks for a short model answer and does not count a hint", async () => {
    const w = watched();
    const t = setup(w.driver, "guided");
    const session = newSession("guided");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    await rt.handle({ type: "guided.stuck" }, t.peer);
    expect(session.assists).toHaveLength(1);
    expect(session.assists?.[0]).toMatchObject({ phase: "requirements" });
    await vi.advanceTimersByTimeAsync(1_000);
    const request = w.turns.find((x) => x.meta.request === "stuck");
    expect(request?.text).toContain("about 150 words");
    expect(request?.text).toContain("no tables and no quiz");
    expect(request?.text).toContain("redo the step in his own words");
    expect(request?.text).not.toContain("refuses a pass");
    expect(session.hints).toEqual([]);
    expect(lastState(t.msgs).assistCount).toBe(1);
    expect("assists" in lastState(t.msgs)).toBe(false);
    rt.dispose();
  });

  it("refuses a pass in the reply to 'I'm stuck', and accepts one on a later turn", async () => {
    let seen: { text: string; isError: boolean } | null = null;
    const w = watched(async (turn, tool) => {
      if (turn.meta.request === "stuck") seen = await tool("step_verdict", { phase: "requirements", verdict: "pass" });
    });
    const t = setup(w.driver, "guided");
    const session = newSession("guided");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    await rt.handle({ type: "guided.stuck" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(seen).toMatchObject({ isError: true });
    expect(session.stepVerdicts).toBeUndefined();
    write(session, "requirements");
    expect((await settled(w.tool("step_verdict", { phase: "requirements", verdict: "pass" }))).isError).toBe(false);
    rt.dispose();
  });

  it("rejects 'I'm stuck' in an interview round, while paused and after the end", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }), "interview");
    const interview = newSession("interview");
    const rt = await t.start(interview);
    await vi.advanceTimersByTimeAsync(1_000);
    await rt.handle({ type: "guided.stuck" }, t.peer);
    expect(t.msgs.find((m) => m.type === "error")).toMatchObject({ code: "not_guided" });
    expect(interview.assists).toBeUndefined();
    rt.dispose();

    const g = setup(createFakeDriver({ chunkDelayMs: 0 }), "guided");
    const guided = newSession("guided");
    const grt = await g.start(guided);
    await vi.advanceTimersByTimeAsync(1_000);
    await grt.handle({ type: "session.pause" }, g.peer);
    await grt.handle({ type: "guided.stuck" }, g.peer);
    expect(g.msgs.find((m) => m.type === "error")).toMatchObject({ code: "paused" });
    expect(guided.assists).toBeUndefined();
    grt.dispose();
  });

  it("offers to move on once per step at twice its planned time, in a guided round only", async () => {
    const offers = (session: Session) => session.transcript.filter((e) => e.kind === "clock" && e.text.includes("twice the planned time"));
    const w = watched();
    const t = setup(w.driver, "guided");
    const session = newSession("guided");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(9 * MIN);
    expect(offers(session)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(offers(session)).toHaveLength(1);
    expect(interviewerTexts(t.msgs).at(-1)).toMatch(/move on to the next one/);
    const turn = w.turns.find((x) => x.meta.checkpoint === "phase_over");
    expect(turn?.text).toContain("offers to move on");
    expect(turn?.text).not.toContain("<silent/>");
    await vi.advanceTimersByTimeAsync(20 * MIN);
    expect(w.turns.filter((x) => x.meta.checkpoint === "phase_over")).toHaveLength(1);
    rt.dispose();

    const iw = watched();
    const it2 = setup(iw.driver, "interview");
    const interview = newSession("interview");
    const irt = await it2.start(interview);
    await vi.advanceTimersByTimeAsync(12 * MIN);
    expect(iw.turns.some((x) => x.meta.checkpoint === "phase_over")).toBe(false);
    irt.dispose();
  });

  describe("the move-on offer follows time in the step", () => {
    const offersFor = (session: Session, phase: string) =>
      session.transcript.filter((e) => e.kind === "clock" && e.text === `clock: twice the planned time in phase "${phase}"`).length;

    async function room() {
      const t = setup(watched().driver, "guided");
      const session = newSession("guided");
      const rt = await t.start(session);
      return { t, session, rt, move: (phase: string) => rt.handle({ type: "phase.set", phase }, t.peer) };
    }

    it("still offers in later steps after a slow first step", async () => {
      const { session, rt, move } = await room();
      await vi.advanceTimersByTimeAsync(12 * MIN);
      expect(offersFor(session, "requirements")).toBe(1);
      await move("entities");
      // Core entities is planned for 2 minutes: the offer falls 4 minutes after he entered, though its window closed long ago.
      await vi.advanceTimersByTimeAsync(3 * MIN);
      expect(offersFor(session, "entities")).toBe(0);
      await vi.advanceTimersByTimeAsync(2 * MIN);
      expect(offersFor(session, "entities")).toBe(1);
      rt.dispose();
    });

    it("counts the time of earlier visits when he comes back", async () => {
      const { session, rt, move } = await room();
      await vi.advanceTimersByTimeAsync(4 * MIN);
      await move("entities");
      await vi.advanceTimersByTimeAsync(1 * MIN);
      await move("requirements");
      // Four minutes were spent before he left, so six remain, not ten.
      await vi.advanceTimersByTimeAsync(5.5 * MIN);
      expect(offersFor(session, "requirements")).toBe(0);
      await vi.advanceTimersByTimeAsync(1 * MIN);
      expect(offersFor(session, "requirements")).toBe(1);
      rt.dispose();
    });

    it("drops the pending offer when he leaves, and restores it when he returns", async () => {
      const { session, rt, move } = await room();
      await vi.advanceTimersByTimeAsync(8 * MIN);
      await move("entities");
      await vi.advanceTimersByTimeAsync(5 * MIN);
      expect(offersFor(session, "requirements")).toBe(0);
      await move("requirements");
      await vi.advanceTimersByTimeAsync(1 * MIN);
      expect(offersFor(session, "requirements")).toBe(0);
      await vi.advanceTimersByTimeAsync(1.5 * MIN);
      expect(offersFor(session, "requirements")).toBe(1);
      rt.dispose();
    });

    it("offers once per step even when he leaves and returns", async () => {
      const { session, rt, move } = await room();
      await vi.advanceTimersByTimeAsync(11 * MIN);
      expect(offersFor(session, "requirements")).toBe(1);
      await move("entities");
      await move("requirements");
      await vi.advanceTimersByTimeAsync(30 * MIN);
      expect(offersFor(session, "requirements")).toBe(1);
      rt.dispose();
    });

    it("does not count paused time", async () => {
      const { session, rt, t } = await room();
      await vi.advanceTimersByTimeAsync(8 * MIN);
      await rt.handle({ type: "session.pause" }, t.peer);
      await vi.advanceTimersByTimeAsync(30 * MIN);
      expect(offersFor(session, "requirements")).toBe(0);
      await rt.handle({ type: "session.resume" }, t.peer);
      await vi.advanceTimersByTimeAsync(1 * MIN);
      expect(offersFor(session, "requirements")).toBe(0);
      await vi.advanceTimersByTimeAsync(1.5 * MIN);
      expect(offersFor(session, "requirements")).toBe(1);
      rt.dispose();
    });

    it("keeps an offer already given across a restart", async () => {
      const { session, rt } = await room();
      await vi.advanceTimersByTimeAsync(11 * MIN);
      expect(offersFor(session, "requirements")).toBe(1);
      rt.dispose();
      const again = setup(watched().driver, "guided");
      const rt2 = await again.start(session);
      await vi.advanceTimersByTimeAsync(30 * MIN);
      expect(offersFor(session, "requirements")).toBe(1);
      rt2.dispose();
    });

    it("makes no offer on the last step", async () => {
      const { session, rt, move } = await room();
      await move("deep_dives");
      await vi.advanceTimersByTimeAsync(60 * MIN);
      expect(offersFor(session, "deep_dives")).toBe(0);
      rt.dispose();
    });
  });

  it("makes no offer for a step that already passed", async () => {
    const w = watched();
    const t = setup(w.driver, "guided");
    const session = newSession("guided");
    session.stepVerdicts = { requirements: { verdict: "pass", at: 1 } };
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(12 * MIN);
    expect(w.turns.some((x) => x.meta.checkpoint === "phase_over")).toBe(false);
    rt.dispose();
  });

  it("gives a guided debrief a readiness call, and an interview debrief none", async () => {
    const guided = newSession("guided");
    guided.assists = [{ at: 1_000, phase: "requirements" }];
    guided.stepVerdicts = { requirements: { verdict: "pass", at: 2_000 } };
    const g = setup(createFakeDriver({ chunkDelayMs: 0 }), "guided");
    const grt = await g.start(guided);
    await vi.advanceTimersByTimeAsync(1_000);
    await grt.handle({ type: "session.end" }, g.peer);
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      expect(guided.status).toBe("debriefed");
    });
    expect(guided.scorecard?.readiness?.call).toBe("not_yet");
    expect(guided.scorecard?.readiness?.reasons).toContain("Requirements was assisted.");
    expect(guided.scorecard?.readiness?.reasons.some((r) => r.startsWith("These steps did not pass"))).toBe(true);
    // The judge's own data is unchanged.
    expect(guided.scorecard?.verdict.sde2).toBe("lean_no_hire");
    expect(guided.scorecard?.trackerMark).toBe("[~]");
    grt.dispose();

    const interview = newSession("interview");
    const i = setup(createFakeDriver({ chunkDelayMs: 0 }), "interview");
    const irt = await i.start(interview);
    await vi.advanceTimersByTimeAsync(1_000);
    await irt.handle({ type: "session.end" }, i.peer);
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      expect(interview.status).toBe("debriefed");
    });
    expect(interview.scorecard?.readiness).toBeUndefined();
    irt.dispose();
  });

  it("loads a guided round saved without verdicts or assists", async () => {
    const old = newSession("guided");
    expect(old.stepVerdicts).toBeUndefined();
    expect(old.assists).toBeUndefined();
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }), "guided");
    const rt = await t.start(old);
    await vi.advanceTimersByTimeAsync(1_000);
    const view = lastState(t.msgs);
    expect(view.stepVerdicts).toBeUndefined();
    expect(view.assistCount).toBe(0);
    rt.dispose();
  });
});

describe("rich chat blocks", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }));
  afterEach(() => vi.useRealTimers());

  function scriptedDriver(script: (role: ConversationSetup["role"], turn: UserTurn, tools: RoomTool[]) => Promise<string> | string): {
    driver: Driver;
    seenTools: Map<string, string[]>;
  } {
    const base = createFakeDriver({ chunkDelayMs: 0 });
    const seenTools = new Map<string, string[]>();
    const driver: Driver = {
      ...base,
      startConversation(convSetup) {
        seenTools.set(
          convSetup.role,
          convSetup.tools.map((x) => x.name),
        );
        let closed = false;
        let sid = convSetup.resumeSessionId;
        return {
          sdkSessionId: () => sid,
          close: () => {
            closed = true;
          },
          async send(turn, handlers) {
            if (closed) throw new DriverError("Closed");
            sid ??= `scripted-${convSetup.role}`;
            const text = await script(convSetup.role, turn, convSetup.tools);
            if (text) handlers.onTextDelta(text);
            return { text, stats: { durationMs: 1, costUsd: 0 } };
          },
        };
      },
    };
    return { driver, seenTools };
  }

  it("exposes emit_block to guided and coach channels, and never to interviewer mode", async () => {
    const s1 = scriptedDriver(() => "Opening.");
    const ti = setup(s1.driver, "interview");
    const rti = await ti.start(newSession("interview"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(s1.seenTools.get("interviewer")).not.toContain("emit_block");
    rti.dispose();

    const s2 = scriptedDriver(() => "Opening.");
    const tg = setup(s2.driver, "guided");
    const guidedSession = newSession("guided");
    const rtg = await tg.start(guidedSession);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(s2.seenTools.get("guide")).toContain("emit_block");
    rtg.dispose();

    const coachSession = newSession("interview");
    coachSession.status = "debriefed";
    coachSession.scorecard = {
      gaps: [{ title: "Hot keys", severity: "major", whyItMatters: "x", whatGoodLooksLike: "y", teachMinutes: 8 }],
      verdict: { sde2: "hire", senior: "lean_no_hire", summary: "ok" },
    } as unknown as Session["scorecard"];
    const s3 = scriptedDriver(() => "Let's look at hot keys.");
    const tc = setup(s3.driver, "interview");
    const rtc = new SessionRuntime(tc.deps, coachSession, await urlShortener());
    await rtc.init();
    rtc.attach(tc.peer);
    await rtc.handle({ type: "coach.open" }, tc.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(s3.seenTools.get("coach")).toContain("emit_block");
    rtc.dispose();
  });

  it("attaches blocks to entry.blocks in FakeDriver without altering streamed entry.text", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }), "guided");
    const session = newSession("guided");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);

    // Hints 1 and 2 have no blocks; Hint 3 attaches a 2-item options block.
    await rt.handle({ type: "guided.hint" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    await rt.handle({ type: "guided.hint" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    await rt.handle({ type: "guided.hint" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);

    const hintReplies = t.msgs.flatMap((m) => (m.type === "chat.message" && m.entry.role === "interviewer" && m.entry.text.startsWith("Hint ") ? [m.entry] : []));
    expect(hintReplies).toHaveLength(3);
    expect(hintReplies[0]?.blocks).toBeUndefined();
    expect(hintReplies[1]?.blocks).toBeUndefined();
    expect(hintReplies[2]?.blocks).toHaveLength(1);
    expect(hintReplies[2]?.blocks?.[0]?.kind).toBe("options");

    // Streamed deltas for Hint 3 match entry.text byte-for-byte.
    const h3Id = hintReplies[2]?.id;
    const streamedH3 = t.msgs.flatMap((m) => (m.type === "chat.delta" && m.messageId === h3Id ? [m.textDelta] : [])).join("");
    expect(streamedH3).toBe(hintReplies[2]?.text);

    // "I'm stuck" attaches a 3-node flow diagram alongside the model answer prose.
    await rt.handle({ type: "guided.stuck" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    const stuckReply = [...t.msgs].reverse().find((m): m is Extract<ServerMsg, { type: "chat.message" }> => m.type === "chat.message" && m.entry.role === "interviewer");
    expect(stuckReply?.entry.text).toContain("model answer");
    expect(stuckReply?.entry.blocks?.[0]).toMatchObject({ kind: "diagram", layout: "flow" });

    // Ending and opening Coach attaches an options block on coach_open while preserving prose.
    await rt.handle({ type: "session.end" }, t.peer);
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      expect(session.status).toBe("debriefed");
    });
    await rt.handle({ type: "coach.open" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    const coachOpen = t.msgs.find((m): m is Extract<ServerMsg, { type: "chat.message" }> => m.type === "chat.message" && m.entry.channel === "coach" && m.entry.role === "coach");
    expect(coachOpen?.entry.text).toContain("Let's start with");
    expect(coachOpen?.entry.blocks?.[0]?.kind).toBe("options");
    rt.dispose();
  });

  it("discards queued blocks when the reply is <silent/>, and keeps blocks-only replies when prose is empty", async () => {
    let clockFired = 0;
    const s = scriptedDriver(async (_role, turn, tools) => {
      const emit = tools.find((x) => x.name === "emit_block")!;
      if (turn.meta.kind === "start") return "Start.";
      if (turn.meta.kind === "clock") {
        if (turn.meta.checkpoint !== "phase_over") return "<silent/>";
        clockFired += 1;
        const res = await emit.run({
          block: { kind: "options", items: [{ label: "Move on" }, { label: "Stay on requirements" }] },
        });
        expect(res.isError).toBeUndefined();
        return "<silent/>";
      }
      await emit.run({ block: { kind: "callout", label: "Constraint", text: "Peak traffic is 10x average." } });
      return "";
    });
    const t = setup(s.driver, "guided");
    const session = newSession("guided");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);

    // Advance to phase_over (2x planned minutes) while keeping candidate activity inside the guided silence window.
    const plannedMin = rt.publicSession().phasePlan[0]!.minutes;
    await rt.handle({ type: "notes.update", phase: "requirements", text: "Active work", version: 1 }, t.peer);
    await vi.advanceTimersByTimeAsync(plannedMin * MIN);
    await rt.handle({ type: "notes.update", phase: "requirements", text: "Still working", version: 2 }, t.peer);
    await vi.advanceTimersByTimeAsync(plannedMin * MIN + 1_000);
    expect(clockFired).toBe(1);
    const afterClock = session.transcript.filter((e) => e.role === "interviewer");
    expect(afterClock).toHaveLength(1);
    expect(afterClock[0]?.blocks).toBeUndefined();

    // Candidate message gets a blocks-only reply (empty prose, non-silent).
    await rt.handle({ type: "chat.send", channel: "interview", clientMsgId: "m1", text: "Give me a curveball." }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    const replies = session.transcript.filter((e) => e.role === "interviewer");
    expect(replies).toHaveLength(2);
    expect(replies[1]?.text).toBe("");
    expect(replies[1]?.blocks).toEqual([{ kind: "callout", label: "Constraint", text: "Peak traffic is 10x average." }]);
    rt.dispose();
  });

  it("clears pendingBlocks when a turn fails so a retry or replay never leaks stale blocks", async () => {
    let failCandidateOnce = true;
    const s = scriptedDriver(async (_role, turn, tools) => {
      const emit = tools.find((x) => x.name === "emit_block")!;
      if (turn.meta.kind === "start") return "Start.";
      if (failCandidateOnce) {
        failCandidateOnce = false;
        await emit.run({ block: { kind: "callout", text: "Stale block from failed attempt" } });
        throw new DriverError("Connection dropped.");
      }
      return "Clean retry reply with no blocks.";
    });
    const t = setup(s.driver, "guided");
    const session = newSession("guided");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);

    await rt.handle({ type: "chat.send", channel: "interview", clientMsgId: "m1", text: "Hello" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.status).toBe("paused");
    expect(session.pauseReason).toBe("error");

    await rt.handle({ type: "session.resume" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    const last = [...session.transcript].reverse().find((e) => e.role === "interviewer");
    expect(last?.text).toBe("Clean retry reply with no blocks.");
    expect(last?.blocks).toBeUndefined();
    rt.dispose();
  });

  it("enforces hint rung, stuck, and count-only guardrails across turns, including mid-turn note_hint stripping", async () => {
    const toolResults: boolean[] = [];
    let hintTurnNumber = 0;
    const s = scriptedDriver(async (_role, turn, tools) => {
      const emit = tools.find((x) => x.name === "emit_block")!;
      const noteHint = tools.find((x) => x.name === "note_hint")!;
      const verdict = tools.find((x) => x.name === "step_verdict")!;
      if (turn.meta.kind === "start") return "Start.";

      if (turn.meta.request === "hint") {
        hintTurnNumber += 1;
        if (hintTurnNumber === 1) {
          // Unrecorded hint turn (never calls note_hint): pump strips options while keeping callout.
          const rOpts = await emit.run({ block: { kind: "options", items: [{ label: "A" }, { label: "B" }] } });
          const rCallout = await emit.run({ block: { kind: "callout", text: "Check read traffic." } });
          toolResults.push(Boolean(rOpts.isError), Boolean(rCallout.isError));
          return "Unrecorded hint reply.";
        }
        if (hintTurnNumber === 2) {
          // Recorded H2 hint: strips pre-note_hint options and refuses post-note_hint options.
          await emit.run({ block: { kind: "options", items: [{ label: "Early A" }, { label: "Early B" }] } });
          await emit.run({ block: { kind: "callout", text: "Hot keys skew one shard." } });
          await noteHint.run({ level: 2, topic: "hot key skew" });
          const rPostOpts = await emit.run({ block: { kind: "options", items: [{ label: "A" }, { label: "B" }] } });
          toolResults.push(Boolean(rPostOpts.isError));
          return "H2 hint reply.";
        }
        // Recorded H3 hint: refuses diagram and kv, allows options.
        await noteHint.run({ level: 3, topic: "fan-out model" });
        const r1 = await emit.run({
          block: {
            kind: "diagram",
            layout: "flow",
            nodes: [
              { id: "a", label: "A" },
              { id: "b", label: "B" },
            ],
            edges: [{ from: "a", to: "b" }],
          },
        });
        const r2 = await emit.run({ block: { kind: "kv", rows: [{ key: "k", value: "v" }] } });
        const r3 = await emit.run({ block: { kind: "options", items: [{ label: "A" }, { label: "B" }] } });
        toolResults.push(Boolean(r1.isError), Boolean(r2.isError), Boolean(r3.isError));
        return "H3 hint reply.";
      }

      if (turn.meta.candidateText === "give me a hint in chat") {
        // Emit diagram, options, and callout BEFORE calling H1 note_hint, then try kv and options AFTER note_hint.
        await emit.run({
          block: {
            kind: "diagram",
            layout: "flow",
            nodes: [
              { id: "a", label: "A" },
              { id: "b", label: "B" },
            ],
            edges: [{ from: "a", to: "b" }],
          },
        });
        await emit.run({ block: { kind: "options", items: [{ label: "A" }, { label: "B" }] } });
        await emit.run({ block: { kind: "callout", text: "Think about write amplification." } });
        await noteHint.run({ level: 1, topic: "write amplification" });
        const afterKv = await emit.run({ block: { kind: "kv", rows: [{ key: "QPS", value: "10k" }] } });
        const afterOpts = await emit.run({ block: { kind: "options", items: [{ label: "A" }, { label: "B" }] } });
        toolResults.push(Boolean(afterKv.isError), Boolean(afterOpts.isError));
        return "Nudge in chat.";
      }

      if (turn.meta.request === "stuck") {
        const rOpts = await emit.run({ block: { kind: "options", items: [{ label: "A" }, { label: "B" }] } });
        const rKv = await emit.run({ block: { kind: "kv", rows: [{ key: "k", value: "v" }] } });
        const rDiag = await emit.run({
          block: {
            kind: "diagram",
            layout: "flow",
            nodes: [
              { id: "a", label: "A" },
              { id: "b", label: "B" },
            ],
            edges: [{ from: "a", to: "b" }],
          },
        });
        toolResults.push(Boolean(rOpts.isError), Boolean(rKv.isError), Boolean(rDiag.isError));
        return "Model answer.";
      }

      if (turn.meta.request === "feedback") {
        const countOnlyAtStart = (session.stepVerdicts?.requirements?.misses ?? 0) >= 2;
        if (countOnlyAtStart) {
          // Calling note_hint mid-turn on a count-only step check must NOT bypass the count-only block guard.
          await noteHint.run({ level: 3, topic: "latency target" });
          const rBeforeVerdict = await emit.run({ block: { kind: "options", items: [{ label: "A" }, { label: "B" }] } });
          await verdict.run({ phase: "requirements", verdict: "not_yet", gap: "" });
          const rAfterVerdict = await emit.run({ block: { kind: "callout", text: "Latency target open" } });
          toolResults.push(Boolean(rBeforeVerdict.isError), Boolean(rAfterVerdict.isError));
          return "Count-only check.";
        }
        await verdict.run({ phase: "requirements", verdict: "not_yet", gap: "What latency target must redirects meet?" });
        const rCallout = await emit.run({ block: { kind: "callout", text: "Latency target open" } });
        const rHldCode = await emit.run({ block: { kind: "anchor", target: { kind: "code", line: 1 }, label: "main" } });
        toolResults.push(Boolean(rCallout.isError), Boolean(rHldCode.isError));
        return "Still open.";
      }

      return "Ok.";
    });

    const t = setup(s.driver, "guided");
    const session = newSession("guided");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);

    // 1a. Unrecorded hint button turn: options stripped at turn completion, callout preserved.
    await rt.handle({ type: "guided.hint" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(toolResults.splice(0)).toEqual([false, false]);
    expect(session.transcript.findLast((e) => e.role === "interviewer")?.blocks?.map((b) => b.kind)).toEqual(["callout"]);

    // 1b. Recorded H2 hint button turn: options stripped by note_hint and refused afterward.
    await rt.handle({ type: "guided.hint" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(toolResults.splice(0)).toEqual([true]);
    expect(session.transcript.findLast((e) => e.role === "interviewer")?.blocks?.map((b) => b.kind)).toEqual(["callout"]);

    // 1c. Recorded H3 hint button turn: diagram and kv refused, options kept.
    await rt.handle({ type: "guided.hint" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(toolResults.splice(0)).toEqual([true, true, false]);
    expect(session.transcript.findLast((e) => e.role === "interviewer")?.blocks?.map((b) => b.kind)).toEqual(["options"]);

    // 2. Candidate asks for a hint in chat: H1 note_hint strips diagram and options while keeping callout, and blocks kv/options after.
    await rt.handle({ type: "chat.send", channel: "interview", clientMsgId: "h-chat", text: "give me a hint in chat" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(toolResults.splice(0)).toEqual([true, true]);
    expect(session.transcript.findLast((e) => e.role === "interviewer")?.blocks).toEqual([{ kind: "callout", text: "Think about write amplification." }]);

    // 3a. Second "Not yet" (misses 1 -> 2) is still a named check: callout succeeds after step_verdict, HLD code anchor is refused.
    session.stepVerdicts = { requirements: { verdict: "not_yet", gap: "Missing scale", at: 1, misses: 1 } };
    await rt.handle({ type: "guided.feedback" }, t.peer);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(toolResults.splice(0)).toEqual([false, true]);
    expect(session.transcript.findLast((e) => e.role === "interviewer")?.blocks?.map((b) => b.kind)).toEqual(["callout"]);

    // 3b. Third check (misses >= 2 at turn start) is count-only even if note_hint(3) runs mid-turn.
    await rt.handle({ type: "guided.feedback" }, t.peer);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(toolResults.splice(0)).toEqual([true, true]);
    expect(session.transcript.findLast((e) => e.role === "interviewer")?.blocks).toBeUndefined();

    // 4. "I'm stuck" refuses options and kv, and accepts diagram.
    await rt.handle({ type: "guided.stuck" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(toolResults.splice(0)).toEqual([true, true, false]);
    expect(session.transcript.findLast((e) => e.role === "interviewer")?.blocks?.map((b) => b.kind)).toEqual(["diagram"]);

    rt.dispose();
  });

  it("validates board anchors, lists pin targets in Coach view_whiteboard, and validates LLD code anchors in live and debrief modes", async () => {
    const root = await mkdtemp(join(tmpdir(), "ir-blocks-lld-"));
    const attemptRel = "lld/parking-lot/attempt-2026-10-30.cpp";
    await mkdir(join(root, "lld", "parking-lot"), { recursive: true });
    const cpp = ["#include <iostream>", "struct Spot {", "  int id = 0;", "};"].join("\n");
    await writeFile(join(root, attemptRel), cpp);

    try {
      const boardElements = [
        { id: "f-clarify", type: "frame", name: "Clarify", x: 0, y: 0, width: 500, height: 300, customData: { step: "clarify" } },
        { id: "box-spot", type: "rectangle", frameId: "f-clarify", x: 40, y: 40, width: 120, height: 60 },
        { id: "txt-spot", type: "text", containerId: "box-spot", text: "Spot", originalText: "Spot", x: 50, y: 55, width: 80, height: 20 },
      ];

      let coachBoardView = "";
      const outcomes: boolean[] = [];
      const s = scriptedDriver(async (role, turn, tools) => {
        const emit = tools.find((x) => x.name === "emit_block")!;
        if (turn.meta.kind === "start") return "Start LLD.";
        if (role === "guide") {
          const badBoard = await emit.run({
            block: { kind: "anchor", target: { kind: "board", elementId: "missing-box" }, label: "Missing" },
          });
          const goodBoard = await emit.run({
            block: { kind: "anchor", target: { kind: "board", elementId: "box-spot" }, label: "Spot box" },
          });
          const outOfRangeCode = await emit.run({
            block: { kind: "anchor", target: { kind: "code", line: 2, endLine: 10 }, label: "Spot" },
          });
          const goodCode = await emit.run({
            block: { kind: "anchor", target: { kind: "code", line: 2, endLine: 4 }, label: "struct Spot" },
          });
          outcomes.push(Boolean(badBoard.isError), Boolean(goodBoard.isError), Boolean(outOfRangeCode.isError), Boolean(goodCode.isError));
          return "Checked your board and code.";
        }
        if (role === "coach") {
          const wb = await tools.find((x) => x.name === "view_whiteboard")!.run({});
          coachBoardView = wb.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
          const goodBoard = await emit.run({
            block: { kind: "anchor", target: { kind: "board", elementId: "box-spot" }, label: "Final Spot box" },
          });
          const goodCode = await emit.run({
            block: { kind: "anchor", target: { kind: "code", line: 1, endLine: 4 }, label: "Final Spot file" },
          });
          outcomes.push(Boolean(goodBoard.isError), Boolean(goodCode.isError));
          return "Debriefing Spot.";
        }
        return "Ok.";
      });

      const file = join(APP_ROOT, "content", "problems", "lld", "b3-parking-lot.md");
      const problem = parseProblem(await readFile(file, "utf8"), file, false);
      const t = setup(s.driver, "guided", root);
      t.store.board = { version: 1, elements: boardElements };
      t.store.code = cpp;
      const session: Session = {
        ...newSession("guided"),
        id: "20261030-1000-b3-parking-lot-abcd",
        problemId: "b3-parking-lot",
        title: "Parking Lot",
        track: "lld",
        durationMs: 90 * MIN,
        phase: "clarify",
        phaseHistory: [{ phase: "clarify", at: 0, by: "candidate" }],
        board: { version: 1, graphText: "Nodes:\n- [Spot]", updatedAt: 0 },
        code: { path: attemptRel, version: 1, lastRun: null },
      };

      const rt = await t.start(session, problem);
      await vi.advanceTimersByTimeAsync(1_000);

      await rt.handle({ type: "chat.send", channel: "interview", clientMsgId: "m1", text: "Check Spot" }, t.peer);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(outcomes.splice(0)).toEqual([true, false, true, false]);
      const guideReply = session.transcript.findLast((e) => e.channel === "interview" && e.role === "interviewer");
      expect(guideReply?.blocks).toHaveLength(2);

      // Move session to debriefed and verify Coach view_whiteboard + board/code anchors.
      session.status = "debriefed";
      session.scorecard = {
        gaps: [{ title: "Spot locking", severity: "major", whyItMatters: "x", whatGoodLooksLike: "y", teachMinutes: 8 }],
        verdict: { sde2: "hire", senior: "lean_no_hire", summary: "ok" },
      } as unknown as Session["scorecard"];
      await rt.handle({ type: "coach.open" }, t.peer);
      await vi.waitFor(() => expect(session.transcript.some((e) => e.channel === "coach" && e.role === "coach")).toBe(true));
      expect(coachBoardView).toContain("Pin targets");
      expect(coachBoardView).toContain('box-spot: box "Spot"');
      expect(outcomes.splice(0)).toEqual([false, false]);
      const coachReply = session.transcript.findLast((e) => e.channel === "coach" && e.role === "coach");
      expect(coachReply?.blocks).toHaveLength(2);

      rt.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("allows options only on phase_over and overtime clock turns, even on count-only steps, and refuses blocks on silence and phase_end", async () => {
    const seen: Record<string, boolean[]> = {};
    const s = scriptedDriver(async (_role, turn, tools) => {
      const emit = tools.find((x) => x.name === "emit_block")!;
      if (turn.meta.kind === "start") return "Start.";
      if (turn.meta.kind === "clock") {
        const cp = turn.meta.checkpoint ?? "unknown";
        const rOpts = await emit.run({ block: { kind: "options", items: [{ label: "Move on" }, { label: "Stay here" }] } });
        const rCallout = await emit.run({ block: { kind: "callout", text: "Clock callout" } });
        const rAnchor = await emit.run({
          block: { kind: "anchor", target: { kind: "board", elementId: "box-req" }, label: "Req box" },
        });
        seen[cp] = [Boolean(rOpts.isError), Boolean(rCallout.isError), Boolean(rAnchor.isError)];
        return cp === "phase_end" ? "<silent/>" : `Clock ${cp}.`;
      }
      return "Ok.";
    });

    const t = setup(s.driver, "guided");
    t.store.board = {
      version: 1,
      elements: [
        { id: "f-req", type: "frame", name: "Requirements", x: 0, y: 0, width: 400, height: 300, customData: { step: "requirements" } },
        { id: "box-req", type: "rectangle", frameId: "f-req", x: 20, y: 40, width: 120, height: 60 },
        { id: "txt-req", type: "text", containerId: "box-req", text: "Req", originalText: "Req", x: 30, y: 55, width: 60, height: 20 },
      ],
    };
    const session: Session = {
      ...newSession("guided"),
      board: { version: 1, graphText: "Nodes:\n- [Req]", updatedAt: 0 },
      stepVerdicts: {
        requirements: { verdict: "not_yet", gap: "2 open", at: 1, misses: 2 },
        deep_dives: { verdict: "not_yet", gap: "1 open", at: 1, misses: 2 },
      },
    };
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);

    // At 5:00 phase_end fires; at 6:00 silence fires (because SILENCE_GAP_MS pushes silence past phase_end).
    await vi.advanceTimersByTimeAsync(6 * MIN + 5_000);
    expect(seen.phase_end).toEqual([true, true, true]);
    expect(seen.silence).toEqual([true, true, true]);
    const silenceMsg = session.transcript.find((e) => e.role === "interviewer" && e.text === "Clock silence.");
    expect(silenceMsg?.blocks).toBeUndefined();

    // Keep candidate active so phase_over fires at 10:00 on count-only requirements.
    await rt.handle({ type: "notes.update", phase: "requirements", text: "Working", version: 1 }, t.peer);
    await vi.advanceTimersByTimeAsync(4 * MIN + 5_000);
    expect(seen.phase_over).toEqual([false, true, true]);
    const phaseOverMsg = session.transcript.find((e) => e.role === "interviewer" && e.text === "Clock phase_over.");
    expect(phaseOverMsg?.blocks?.map((b) => b.kind)).toEqual(["options"]);

    // Move to the last step (deep_dives, also count-only) and advance to 45:00 for overtime.
    await rt.handle({ type: "phase.set", phase: "deep_dives" }, t.peer);
    for (let v = 2; v <= 8; v++) {
      await vi.advanceTimersByTimeAsync(5 * MIN);
      await rt.handle({ type: "notes.update", phase: "deep_dives", text: `Note ${v}`, version: v }, t.peer);
    }
    await vi.advanceTimersByTimeAsync(5_000);
    expect(seen.overtime).toEqual([false, true, true]);
    const overtimeMsg = session.transcript.find((e) => e.role === "interviewer" && e.text === "Clock overtime.");
    expect(overtimeMsg?.blocks?.map((b) => b.kind)).toEqual(["options"]);

    rt.dispose();
  });

  it("marks option-chip candidate clicks with fromOption and excludes them from step checks and debrief quotes", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }), "guided");
    const session = newSession("guided");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);

    await rt.handle(
      {
        type: "chat.send",
        channel: "interview",
        clientMsgId: "opt-1",
        fromOption: true,
        text: "Option-chip answer: create a short link for a long URL with custom alias and expiry, redirect in under 50 ms at p99, 100 million new links a month and 100 redirects per link.",
      },
      t.peer,
    );
    await vi.advanceTimersByTimeAsync(2_000);

    const optEntry = session.transcript.find((e) => e.role === "candidate" && e.text.startsWith("Option-chip answer:"));
    expect(optEntry?.fromOption).toBe(true);
    const echoed = t.msgs.find((m): m is Extract<ServerMsg, { type: "chat.message" }> => m.type === "chat.message" && m.clientMsgId === "opt-1");
    expect(echoed?.entry.fromOption).toBe(true);
    // With only an option-chip click and no typed chat/board/notes, stepEvidence treats the step as empty.
    expect(session.stepChecks.requirements).toBeUndefined();

    // Even after a real typed message triggers runStepCheck, the option-chip text never covers checklist items.
    await rt.handle({ type: "chat.send", channel: "interview", clientMsgId: "typed-1", text: "Let me think through the problem first." }, t.peer);
    await vi.advanceTimersByTimeAsync(2_000);
    await rt.handle({ type: "guided.feedback" }, t.peer);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(session.stepVerdicts?.requirements?.verdict).toBe("not_yet");
    expect(session.stepChecks.requirements?.items ?? {}).toEqual({});

    await rt.handle({ type: "session.end" }, t.peer);
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      expect(session.status).toBe("debriefed");
    });
    expect(JSON.stringify(session.scorecard)).not.toContain("Option-chip answer");

    rt.dispose();
  });

  it("attaches a board anchor on look-at-board in guided mode and never in interview mode", async () => {
    const board = [
      { id: "lb", type: "rectangle", x: 0, y: 0, width: 160, height: 60 },
      { id: "lb-t", type: "text", containerId: "lb", text: "Load balancer", originalText: "Load balancer", x: 10, y: 20, width: 140, height: 20 },
    ];

    const interviewSetup = setup(createFakeDriver({ chunkDelayMs: 0 }), "interview");
    const interviewSession = newSession("interview");
    const interviewRt = await interviewSetup.start(interviewSession);
    await vi.advanceTimersByTimeAsync(1_000);
    await interviewRt.handle({ type: "board.update", version: 1, elements: board }, interviewSetup.peer);
    await interviewRt.handle({ type: "chat.send", channel: "interview", clientMsgId: "i1", text: "Can you look at the board?" }, interviewSetup.peer);
    await vi.advanceTimersByTimeAsync(7_000);
    const interviewReply = interviewSession.transcript.findLast((e) => e.role === "interviewer");
    expect(interviewReply?.blocks).toBeUndefined();
    interviewRt.dispose();

    const guidedSetup = setup(createFakeDriver({ chunkDelayMs: 0 }), "guided");
    const guidedSession = newSession("guided");
    const guidedRt = await guidedSetup.start(guidedSession);
    await vi.advanceTimersByTimeAsync(1_000);
    await guidedRt.handle({ type: "board.update", version: 1, elements: board }, guidedSetup.peer);
    await guidedRt.handle({ type: "chat.send", channel: "interview", clientMsgId: "g1", text: "Can you look at the board?" }, guidedSetup.peer);
    await vi.advanceTimersByTimeAsync(7_000);
    const guidedReply = guidedSession.transcript.findLast((e) => e.role === "interviewer");
    expect(guidedReply?.blocks).toEqual([
      {
        kind: "anchor",
        target: { kind: "board", elementId: "lb" },
        label: "Load balancer",
      },
    ]);
    guidedRt.dispose();
  });
});
