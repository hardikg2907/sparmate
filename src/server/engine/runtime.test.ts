import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { teachMessage } from "../../shared/gaps";
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

const interviewerTexts = (msgs: ServerMsg[]) =>
  msgs.flatMap((m) => (m.type === "chat.message" && m.entry.role === "interviewer" ? [m.entry.text] : []));

describe("a full interview round on the clock", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }));
  afterEach(() => vi.useRealTimers());

  it("nudges silently, delivers the extension, warns quietly, closes at time-up and debriefs", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }));
    const session = newSession("interview");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(interviewerTexts(t.msgs)).toEqual(["Let's design a URL shortener, something like bit.ly. Where would you like to start?"]);

    await vi.advanceTimersByTimeAsync(5 * MIN);
    // The planned end of requirements fired, the fake interviewer chose silence: nothing shown, a hidden note kept.
    expect(interviewerTexts(t.msgs)).toHaveLength(1);
    expect(session.transcript.some((e) => e.kind === "clock" && e.hidden && e.text.includes("requirements"))).toBe(true);
    expect(t.msgs.some((m) => m.type === "chat.message" && m.entry.hidden)).toBe(false);

    await vi.advanceTimersByTimeAsync(30 * MIN);
    const texts = interviewerTexts(t.msgs);
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
    // The coach opened after the debrief.
    expect(t.msgs.some((m) => m.type === "chat.message" && m.entry.channel === "coach")).toBe(true);
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
    expect(err).toMatchObject({ channel: "interview", error: "The model is rate limited right now. Wait a minute, then retry." });

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
    await rt.handle({ type: "phase.set", phase: "capacity" }, t.peer);
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
    await rt.handle({ type: "phase.set", phase: "capacity" }, t.peer);
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
    await rt.handle({ type: "phase.set", phase: "capacity" }, t.peer);
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
    expect(body).toContain("Your feedback must agree with this list. If you think an item is wrong, name the item and say why.");
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

  /** A debriefed round whose coach has already opened, with the coach's tools and the turns it receives captured. */
  async function coachRoom() {
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
    session.transcript.push({ id: "c0", at: 0, wall: new Date().toISOString(), channel: "coach", role: "coach", text: "Let's start." });
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

  it("never changes who opened a gap, and leaves an existing record alone on a repeat click", async () => {
    const { rt, session, say, tool, dividers } = await coachRoom();
    await say(teachMessage({ title: "Hot keys" }));
    await tool({ title: "Hot keys", state: "taught" });
    expect(session.gapProgress["Hot keys"]).toMatchObject({ by: "candidate", state: "taught" });
    const taughtAt = session.gapProgress["Hot keys"]!.at;
    await say(teachMessage({ title: "Hot keys" }));
    expect(session.gapProgress["Hot keys"]).toMatchObject({ by: "candidate", state: "taught", at: taughtAt });

    await tool({ title: "Retry storms", state: "started" });
    await tool({ title: "Retry storms", state: "taught" });
    await say(teachMessage({ title: "Retry storms" }));
    expect(session.gapProgress["Retry storms"]).toMatchObject({ by: "coach", state: "taught" });
    // Hot keys, then Retry storms: a repeat click on the current gap added nothing.
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

  it("opens the coach again after a restart when only a divider was saved", async () => {
    const { rt, session } = await coachRoom();
    rt.dispose();
    session.transcript.splice(0, session.transcript.length, { id: "d1", at: 0, wall: new Date().toISOString(), channel: "coach", role: "system", kind: "gap", text: "Now on: Hot keys" });
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }));
    const again = new SessionRuntime(t.deps, session, await urlShortener());
    await again.init();
    again.attach(t.peer);
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
    await vi.advanceTimersByTimeAsync(4 * MIN);
    await rt.handle({ type: "chat.send", channel: "interview", clientMsgId: "c1", text: "We need short links and redirects." }, t.peer);
    // The planned end of requirements passes while that reply streams, so its nudge waits in the queue.
    await vi.advanceTimersByTimeAsync(1.5 * MIN);
    await rt.handle({ type: "phase.set", phase: "capacity" }, t.peer);
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
      expect(session.transcript.some((e) => e.channel === "coach" && e.role === "coach")).toBe(true);
    });
    rt.detach(t.peer);
    expect(rt.isDormant()).toBe(true);
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
});

describe("step quotes in the debrief", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }));
  afterEach(() => vi.useRealTimers());

  it("fails a step quote that was said only in another step", async () => {
    const t = setup(createFakeDriver({ chunkDelayMs: 0 }));
    const session = newSession("interview");
    const rt = await t.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    await rt.handle({ type: "phase.set", phase: "capacity" }, t.peer);
    await vi.advanceTimersByTimeAsync(1_000);
    await rt.handle({ type: "chat.send", channel: "interview", clientMsgId: "c1", text: "Reads outnumber writes by a hundred to one here." }, t.peer);
    await rt.handle({ type: "session.end" }, t.peer);
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      expect(session.status).toBe("debriefed");
    });
    // The fake judge quotes his only line under the first step, but he said it in the capacity step.
    const first = session.scorecard?.steps?.[0]?.phase;
    expect(first).toBe("requirements");
    expect(session.scorecard?.stepQuoteChecks?.filter((c) => c.phase === first).map((c) => c.verified)).toEqual([false]);
    rt.dispose();
  });
});
