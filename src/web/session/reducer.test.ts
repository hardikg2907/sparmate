import { describe, expect, it } from "vitest";
import type { ServerMsg } from "../../shared/protocol";
import type { Proposal, PublicSession, TranscriptEntry } from "../../shared/types";
import { chatItems, initialState, reducer, visibleStreamText, type Action } from "./reducer";
import type { SessionState } from "./types";

const T0 = Date.parse("2026-10-30T10:00:00.000Z");

function entry(id: string, role: TranscriptEntry["role"], text: string, extra: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return { id, at: 1000, wall: new Date(T0 + 1000).toISOString(), channel: "interview", role, text, ...extra };
}

function session(overrides: Partial<PublicSession> = {}): PublicSession {
  return {
    id: "s1",
    problemId: "p1",
    title: "URL Shortener",
    track: "hld",
    mode: "interview",
    custom: false,
    createdAt: new Date(T0).toISOString(),
    durationMs: 45 * 60_000,
    startedAt: new Date(T0).toISOString(),
    pausedMs: 0,
    pauseStartedAt: null,
    pauseReason: null,
    endedAt: null,
    status: "live",
    phase: "requirements",
    phaseHistory: [{ phase: "requirements", at: 0, by: "candidate" }],
    stepNotes: {},
    stepNotesVersion: 0,
    stepSummaries: {},
    steps: {},
    assistCount: 0,
    pins: [],
    focus: null,
    gapProgress: {},
    studyNotes: null,
    transcript: [entry("e1", "interviewer", "Where would you like to start?")],
    hints: [],
    extension: null,
    board: { version: 3, graphText: "Nodes:\n- [A] (kind: service)\nWarnings: node [A] has no connections", updatedAt: null },
    code: null,
    scorecard: null,
    models: { interviewer: "claude-opus-5-5", judge: "claude-opus-5-5" },
    clock: {
      startedAt: new Date(T0).toISOString(),
      pausedMs: 0,
      pauseStartedAt: null,
      durationMs: 45 * 60_000,
      serverNow: new Date(T0 + 60_000).toISOString(),
    },
    phasePlan: [
      { id: "requirements", label: "Requirements", minutes: 5 },
      { id: "capacity", label: "Capacity math", minutes: 3 },
    ],
    reference: null,
    ...overrides,
  };
}

function loaded(overrides: Partial<PublicSession> = {}): SessionState {
  return reducer(initialState, { type: "loaded", session: session(overrides), board: null, code: null, now: T0 + 60_000 });
}

function server(state: SessionState, msg: ServerMsg, options: { fresh?: boolean; now?: number } = {}): SessionState {
  const action: Action = { type: "server", msg, now: options.now ?? T0 + 60_000, fresh: options.fresh ?? false };
  return reducer(state, action);
}

describe("streaming", () => {
  it("builds a message from deltas and replaces it with the final entry by id", () => {
    let state = loaded();
    state = server(state, { type: "chat.delta", channel: "interview", messageId: "m1", textDelta: "Okay. " });
    state = server(state, { type: "chat.delta", channel: "interview", messageId: "m1", textDelta: "Go on." });
    expect(chatItems(state, "interview").at(-1)).toMatchObject({ id: "m1", text: "Okay. Go on.", state: "streaming" });

    state = server(state, { type: "chat.message", entry: entry("m1", "interviewer", "Okay. Go on.") });
    const items = chatItems(state, "interview");
    expect(items.filter((i) => i.id === "m1")).toHaveLength(1);
    expect(items.at(-1)).toMatchObject({ id: "m1", state: "done" });
    expect(state.streams).toEqual({});
  });

  it("keeps the two channels apart", () => {
    let state = loaded();
    state = server(state, { type: "chat.delta", channel: "coach", messageId: "c1", textDelta: "Let's start with caching." });
    expect(chatItems(state, "interview").some((i) => i.id === "c1")).toBe(false);
    expect(chatItems(state, "coach").map((i) => i.id)).toEqual(["c1"]);
  });

  it("ignores a late delta for a message that is already stored", () => {
    let state = loaded();
    state = server(state, { type: "chat.message", entry: entry("m1", "interviewer", "Done.") });
    state = server(state, { type: "chat.delta", channel: "interview", messageId: "m1", textDelta: "late" });
    expect(state.streams).toEqual({});
  });

  it("never shows a silent reply, even half typed", () => {
    expect(visibleStreamText("<")).toBe("");
    expect(visibleStreamText("<sil")).toBe("");
    expect(visibleStreamText("<silent/>")).toBe("");
    expect(visibleStreamText("  <silent/>  ")).toBe("");
    expect(visibleStreamText("Okay.<silent/>")).toBe("Okay.");
    expect(visibleStreamText("<b>bold</b>")).toBe("<b>bold</b>");
    expect(visibleStreamText("Vec<int> is fine")).toBe("Vec<int> is fine");
  });
});

describe("optimistic messages", () => {
  const pending = { clientMsgId: "c-1", channel: "interview" as const, text: "My design has a CDN.", sentAt: T0 + 60_000 };

  it("replaces the local copy when the server echoes the client id", () => {
    let state = loaded();
    state = reducer(state, { type: "pending-add", message: pending });
    expect(chatItems(state, "interview").at(-1)).toMatchObject({ role: "candidate", state: "pending" });

    state = server(state, {
      type: "chat.message",
      clientMsgId: "c-1",
      entry: entry("e2", "candidate", "My design has a CDN.", { wall: new Date(T0 + 60_500).toISOString() }),
    });
    const mine = chatItems(state, "interview").filter((i) => i.role === "candidate");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: "e2", state: "done" });
  });

  it("does not add a second copy when the echo came before the local one", () => {
    let state = loaded();
    state = server(state, { type: "chat.message", clientMsgId: "c-1", entry: entry("e2", "candidate", "My design has a CDN.") });
    state = reducer(state, { type: "pending-add", message: pending });
    state = reducer(state, { type: "pending-drop", clientMsgId: "c-1" });
    expect(chatItems(state, "interview").filter((i) => i.role === "candidate")).toHaveLength(1);
  });

  it("drops a local copy that a full state already holds", () => {
    let state = loaded();
    state = reducer(state, { type: "pending-add", message: pending });
    const withMessage = session({
      transcript: [entry("e1", "interviewer", "Hi"), entry("e2", "candidate", "My design has a CDN.", { wall: new Date(T0 + 61_000).toISOString() })],
    });
    state = server(state, { type: "session.state", session: withMessage });
    expect(state.pending).toEqual([]);
  });

  it("tells the user when a message never reached the server after a reconnect", () => {
    let state = loaded();
    state = reducer(state, { type: "pending-add", message: pending });
    state = reducer(state, { type: "connection", status: "open" });
    state = server(state, { type: "session.state", session: session() }, { fresh: true });
    expect(state.pending).toEqual([]);
    expect(state.notice).toMatch(/did not send/i);
  });

  it("keeps one of two identical messages as unsent when the server got only one", () => {
    let state = loaded();
    state = reducer(state, { type: "pending-add", message: { clientMsgId: "a", channel: "interview", text: "ok", sentAt: T0 + 60_000 } });
    state = reducer(state, { type: "pending-add", message: { clientMsgId: "b", channel: "interview", text: "ok", sentAt: T0 + 60_200 } });
    state = reducer(state, { type: "connection", status: "open" });
    const one = session({ transcript: [entry("e1", "interviewer", "Hi"), entry("e2", "candidate", "ok", { wall: new Date(T0 + 60_100).toISOString() })] });
    state = server(state, { type: "session.state", session: one }, { fresh: true });
    expect(state.notice).toBe("A message did not send. Please send it again.");
    expect(
      chatItems(state, "interview")
        .filter((i) => i.role === "candidate")
        .map((i) => i.state),
    ).toEqual(["done"]);
  });

  it("does not take an earlier identical message as the echo of a new one", () => {
    let state = loaded();
    state = server(state, { type: "chat.message", clientMsgId: "a", entry: entry("e2", "candidate", "ok", { wall: new Date(T0 + 60_000).toISOString() }) });
    state = reducer(state, { type: "pending-add", message: { clientMsgId: "b", channel: "interview", text: "ok", sentAt: T0 + 61_000 } });
    state = reducer(state, { type: "connection", status: "open" });
    const before = state.session?.transcript ?? [];
    state = server(state, { type: "session.state", session: session({ transcript: before }) }, { fresh: true });
    expect(state.notice).toMatch(/did not send/i);
    expect(state.pending).toEqual([]);
  });

  it("keeps a message sent between the socket opening and the first state, and settles it on the echo", () => {
    let state = loaded();
    state = reducer(state, { type: "connection", status: "open" });
    state = reducer(state, { type: "pending-add", message: pending });
    // The opening state was taken before the server read the message.
    state = server(state, { type: "session.state", session: session() }, { fresh: true });
    expect(state.notice).toBeNull();
    expect(state.pending).toHaveLength(1);
    state = server(state, { type: "chat.message", clientMsgId: "c-1", entry: entry("e2", "candidate", "My design has a CDN.") });
    expect(state.pending).toEqual([]);
    expect(chatItems(state, "interview").filter((i) => i.role === "candidate")).toHaveLength(1);
  });
});

describe("agent state after a reconnect", () => {
  it("shows the guide idle when it finished while the socket was down", () => {
    let state = server(loaded(), { type: "agent.status", channel: "interview", state: "thinking" });
    // The server sends no status for an idle channel, so the opening state alone must clear it.
    state = server(state, { type: "session.state", session: session() }, { fresh: true });
    expect(state.agent.interview).toEqual({ state: "idle", error: null });
  });

  it("drops an error cover that was resolved while away, and keeps one the server repeats", () => {
    let state = server(loaded(), { type: "agent.status", channel: "interview", state: "error", error: "Rate limited." });
    state = server(state, { type: "agent.status", channel: "coach", state: "thinking" });
    state = server(state, { type: "session.state", session: session() }, { fresh: true });
    expect(state.agent).toEqual(initialState.agent);
    state = server(state, { type: "agent.status", channel: "coach", state: "thinking" });
    expect(state.agent.coach.state).toBe("thinking");
  });

  it("keeps the agent state on a state that is not a reconnect", () => {
    let state = server(loaded(), { type: "agent.status", channel: "interview", state: "thinking" });
    state = server(state, { type: "session.state", session: session() });
    expect(state.agent.interview.state).toBe("thinking");
  });
});

describe("session.state", () => {
  it("drops partial streams after a reconnect but keeps them otherwise", () => {
    let state = loaded();
    state = server(state, { type: "chat.delta", channel: "interview", messageId: "m1", textDelta: "Half a thought" });
    expect(Object.keys(server(state, { type: "session.state", session: session() }).streams)).toEqual(["m1"]);
    expect(server(state, { type: "session.state", session: session() }, { fresh: true }).streams).toEqual({});
  });

  it("drops a stream once its final entry is in the transcript", () => {
    let state = loaded();
    state = server(state, { type: "chat.delta", channel: "interview", messageId: "m1", textDelta: "Half" });
    const done = session({ transcript: [entry("e1", "interviewer", "Hi"), entry("m1", "interviewer", "Half a thought, finished.")] });
    expect(server(state, { type: "session.state", session: done }).streams).toEqual({});
  });

  it("takes the graph from the session and reads its warnings", () => {
    const state = loaded();
    expect(state.graph.warnings).toEqual(["node [A] has no connections"]);
    expect(state.graph.version).toBe(3);
  });

  it("measures the clock offset from the server's time", () => {
    // The server says 10:01:00 and the browser thinks it is 10:00:40.
    const state = server(loaded(), { type: "session.state", session: session() }, { now: T0 + 40_000 });
    expect(state.clockOffsetMs).toBe(20_000);
  });

  it("clears an old error when the connection comes back", () => {
    let state = server(loaded(), { type: "error", code: "unauthorized", message: "Not allowed." });
    expect(state.error).toBe("Not allowed.");
    state = server(state, { type: "session.state", session: session() });
    expect(state.error).toBe("Not allowed.");
    state = server(state, { type: "session.state", session: session() }, { fresh: true });
    expect(state.error).toBeNull();
  });

  it("marks the debrief done once the session is debriefed", () => {
    const state = server(loaded(), { type: "session.state", session: session({ status: "debriefed" }) });
    expect(state.debrief.stage).toBe("done");
  });
});

describe("chat items", () => {
  it("leaves out entries meant only for the model", () => {
    const state = loaded({
      transcript: [
        entry("e1", "interviewer", "Hi"),
        entry("e2", "system", "clock nudge", { kind: "clock", hidden: true }),
        entry("e3", "system", "Moved to API", { kind: "phase" }),
      ],
    });
    expect(chatItems(state, "interview").map((i) => i.id)).toEqual(["e1", "e3"]);
  });
});

describe("phase changes", () => {
  it("moves the phase and records it once", () => {
    let state = loaded();
    state = server(state, { type: "phase.changed", phase: "capacity", by: "interviewer" });
    expect(state.session?.phase).toBe("capacity");
    expect(state.session?.phaseHistory.at(-1)).toMatchObject({ phase: "capacity", by: "interviewer" });

    const again = server(state, { type: "phase.changed", phase: "capacity", by: "interviewer" });
    expect(again.session?.phaseHistory).toHaveLength(state.session?.phaseHistory.length ?? 0);
  });

  it("applies the user's own click at once, before the server confirms", () => {
    const state = reducer(loaded(), { type: "phase-local", phase: "capacity", now: T0 + 120_000 });
    expect(state.session?.phase).toBe("capacity");
    expect(state.session?.phaseHistory.at(-1)).toMatchObject({ phase: "capacity", by: "candidate" });
  });
});

describe("code", () => {
  function withCode(): SessionState {
    return reducer(initialState, {
      type: "loaded",
      session: session({ track: "lld", code: { path: "lld/p/attempt.cpp", version: 4, lastRun: null } }),
      board: null,
      code: { version: 4, content: "int main() {}", path: "lld/p/attempt.cpp" },
      now: T0,
    });
  }

  it("replaces the text and version on an outside change", () => {
    const state = server(withCode(), { type: "code.external", version: 7, content: "int main() { return 1; }" });
    expect(state.code).toMatchObject({ content: "int main() { return 1; }", version: 7 });
  });

  it("ignores diagnostics older than the ones it has", () => {
    let state = withCode();
    state = server(state, { type: "code.diagnostics", version: 6, diagnostics: [{ line: 1, column: 1, severity: "error", message: "new" }] });
    state = server(state, { type: "code.diagnostics", version: 5, diagnostics: [] });
    expect(state.code?.diagnostics).toHaveLength(1);
    expect(state.code?.diagnosticsVersion).toBe(6);
  });

  it("clears the running flag when the result arrives", () => {
    let state = reducer(withCode(), { type: "run-start" });
    expect(state.code?.running).toBe(true);
    const result = { at: 5, compile: { ok: true, diagnostics: [], stderr: "", durationMs: 10 }, run: null };
    state = server(state, { type: "code.run.result", result });
    expect(state.code).toMatchObject({ running: false, lastRun: result });
  });

  it("keeps the newer of two runs when a full state arrives", () => {
    const newer = { at: 90, compile: { ok: true, diagnostics: [], stderr: "", durationMs: 10 }, run: null };
    let state = server(withCode(), { type: "code.run.result", result: newer });
    const older = { ...newer, at: 10 };
    state = server(state, { type: "session.state", session: session({ track: "lld", code: { path: "lld/p/attempt.cpp", version: 4, lastRun: older } }) });
    expect(state.code?.lastRun?.at).toBe(90);
  });

  it("unlocks Run when a state shows a newer run than the one it waited on", () => {
    const run = (at: number) => ({ at, compile: { ok: true, diagnostics: [], stderr: "", durationMs: 10 }, run: null });
    let state = server(withCode(), { type: "code.run.result", result: run(10) });
    state = reducer(state, { type: "run-start" });
    const lld = (at: number) => session({ track: "lld", code: { path: "lld/p/attempt.cpp", version: 4, lastRun: run(at) } });
    // The same run as before: still waiting.
    state = server(state, { type: "session.state", session: lld(10) }, { fresh: true });
    expect(state.code?.running).toBe(true);
    // The result was broadcast while the socket was down.
    state = server(state, { type: "session.state", session: lld(40) }, { fresh: true });
    expect(state.code).toMatchObject({ running: false, lastRun: { at: 40 } });
  });

  it("stops the spinner when the server reports an error", () => {
    let state = reducer(withCode(), { type: "run-start" });
    state = server(state, { type: "error", code: "bad", message: "That did not work." });
    expect(state.code?.running).toBe(false);
    expect(state.error).toBe("That did not work.");
  });
});

describe("study notes", () => {
  const proposal: Proposal = {
    id: "p1",
    sessionId: "s1",
    createdAt: new Date(T0).toISOString(),
    ops: [],
    diffs: [],
    baseHashes: {},
    status: "draft",
  };

  it("clears the drafting flag when the proposal arrives", () => {
    let state = reducer(loaded(), { type: "notes-drafting" });
    expect(state.notes.drafting).toBe(true);
    state = server(state, { type: "bookkeeping.proposal", proposal });
    expect(state.notes).toMatchObject({ drafting: false, proposal: { id: "p1" } });
  });

  it("marks a proposal stale when every change failed because a file moved", () => {
    let state = server(loaded(), { type: "bookkeeping.proposal", proposal });
    state = server(state, {
      type: "bookkeeping.applied",
      proposalId: "p1",
      applied: [],
      failed: [{ opId: "op1", reason: "The file changed since the draft; draft again." }],
    });
    expect(state.notes.proposal?.status).toBe("stale");
    expect(state.notes.applying).toBe(false);
  });

  it("keeps the result of a save when the server sends the same proposal again with its new status", () => {
    let state = server(loaded(), { type: "bookkeeping.proposal", proposal });
    state = server(state, { type: "bookkeeping.applied", proposalId: "p1", applied: ["op1"], failed: [] });
    state = server(state, { type: "bookkeeping.proposal", proposal: { ...proposal, status: "applied" } });
    expect(state.notes.result).toMatchObject({ applied: ["op1"] });
    expect(state.notes.proposal?.status).toBe("applied");

    // A new draft starts clean.
    state = server(state, { type: "bookkeeping.proposal", proposal: { ...proposal, id: "p2" } });
    expect(state.notes.result).toBeNull();
  });

  it("marks a proposal applied only when nothing failed", () => {
    let state = server(loaded(), { type: "bookkeeping.proposal", proposal });
    const partial = server(state, { type: "bookkeeping.applied", proposalId: "p1", applied: ["op1"], failed: [{ opId: "op2", reason: "Blocked" }] });
    expect(partial.notes.proposal?.status).toBe("draft");
    state = server(state, { type: "bookkeeping.applied", proposalId: "p1", applied: ["op1"], failed: [] });
    expect(state.notes.proposal?.status).toBe("applied");
  });
});

describe("debrief", () => {
  it("follows progress and finishes with the scorecard", () => {
    let state = server(loaded({ status: "debriefing" }), { type: "debrief.progress", stage: "judging", detail: "One moment" });
    expect(state.debrief).toEqual({ stage: "judging", detail: "One moment" });
    state = server(state, { type: "debrief.progress", stage: "checking" });
    expect(state.debrief.detail).toBeNull();
  });
});

describe("graph refresh", () => {
  it("does not go back to an older board", () => {
    const state = loaded();
    const older = reducer(state, { type: "graph-refreshed", board: { version: 1, graphText: "old", updatedAt: null } });
    expect(older.graph.text).toContain("Nodes:");
    const newer = reducer(state, { type: "graph-refreshed", board: { version: 9, graphText: "new", updatedAt: null } });
    expect(newer.graph).toMatchObject({ text: "new", version: 9 });
  });
});

describe("pausing and discarding", () => {
  it("shows the reason the server gives for a pause, and clears it on resume", () => {
    let state = server(loaded(), { type: "session.state", session: session({ status: "paused", pauseReason: "away", pauseStartedAt: new Date(T0).toISOString() }) });
    expect(state.session).toMatchObject({ status: "paused", pauseReason: "away" });
    state = server(state, { type: "session.state", session: session({ status: "live", pauseReason: null }) });
    expect(state.session).toMatchObject({ status: "live", pauseReason: null });
  });

  it("marks the round as discarded when the server says so, and a fresh load starts clean", () => {
    const state = server(loaded(), { type: "session.discarded" });
    expect(state.discarded).toBe(true);
    expect(reducer(state, { type: "reset" }).discarded).toBe(false);
    expect(loaded().discarded).toBe(false);
  });
});
