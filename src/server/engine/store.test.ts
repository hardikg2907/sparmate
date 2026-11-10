import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Session } from "../../shared/types";
import { memoryLogger } from "./log";
import { SessionStore, scorecardWithCurrentPlan, summarize } from "./store";

const ID = "20261030-0900-c2-url-shortener-abcd";
const OTHER = "20261030-0901-c2-url-shortener-wxyz";
const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

function session(overrides: Partial<Session> = {}): Session {
  const now = new Date().toISOString();
  return {
    id: ID,
    problemId: "c2-url-shortener",
    title: "URL Shortener",
    track: "hld",
    mode: "interview",
    custom: false,
    createdAt: now,
    durationMs: 45 * 60_000,
    startedAt: now,
    pausedMs: 0,
    pauseStartedAt: null,
    pauseReason: null,
    endedAt: null,
    status: "live",
    phase: "requirements",
    phaseHistory: [],
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
    ...overrides,
  };
}

let root: string;
let dir: string;
let store: SessionStore;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "ir-store-")));
  dir = join(root, "sessions");
  await mkdir(dir);
  store = new SessionStore(dir, memoryLogger());
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("pause reason on load", () => {
  async function loadSaved(raw: Record<string, unknown>) {
    await mkdir(join(dir, ID), { recursive: true });
    await writeFile(join(dir, ID, "session.json"), JSON.stringify({ ...session(), ...raw }));
    return store.load(ID);
  }

  it("reads a session saved before the field existed as not paused", async () => {
    const { pauseReason: _gone, ...old } = session();
    await mkdir(join(dir, ID));
    await writeFile(join(dir, ID, "session.json"), JSON.stringify(old));
    expect((await store.load(ID))?.pauseReason).toBeNull();
  });

  it("reads an old paused session as paused by a restart", async () => {
    const { pauseReason: _gone, ...old } = session({ status: "paused", pauseStartedAt: new Date().toISOString() });
    await mkdir(join(dir, ID));
    await writeFile(join(dir, ID, "session.json"), JSON.stringify(old));
    expect((await store.load(ID))?.pauseReason).toBe("restart");
  });

  it("keeps a valid reason on a paused session and drops a stray one elsewhere", async () => {
    expect((await loadSaved({ status: "paused", pauseReason: "away" }))?.pauseReason).toBe("away");
    expect((await loadSaved({ status: "paused", pauseReason: "nonsense" }))?.pauseReason).toBe("restart");
    expect((await loadSaved({ status: "debriefed", pauseReason: "user" }))?.pauseReason).toBeNull();
  });

  it("loads an old scorecard without steps with an empty steps array", async () => {
    const rawCard = {
      verdict: { sde2: "hire", senior: "hire", confidence: "high", summary: "Good." },
      dimensions: [],
      strengths: [],
      gaps: [],
      timeline: [],
      practiceTask: "t",
      trackerMark: "[x]",
      trackerMarkReason: "r",
      lldScenarios: [],
    };
    const loaded = await loadSaved({ status: "debriefed", scorecard: rawCard });
    expect(loaded?.scorecard?.steps).toEqual([]);
  });

  it("loads a scorecard saved before levels were named with the default level names", async () => {
    const rawCard = {
      verdict: { sde2: "hire", senior: "lean_no_hire", confidence: "high", summary: "Good." },
      dimensions: [],
      steps: [],
      strengths: [],
      gaps: [],
      timeline: [],
      practiceTask: "t",
      trackerMark: "[x]",
      trackerMarkReason: "r",
      lldScenarios: [],
    };
    const loaded = await loadSaved({ status: "debriefed", scorecard: rawCard });
    expect(loaded?.scorecard?.verdict).toMatchObject({ sde2: "hire", senior: "lean_no_hire", targetLevel: "SDE-2", stretchLevel: "senior" });
    expect(store.history()[0]?.verdict).toBe("hire");
  });
});

describe("remove", () => {
  it("deletes the whole folder and the history entry", async () => {
    await store.create(session());
    await store.writeBoard(ID, { version: 1, elements: [] });
    await store.saveProposal(ID, { id: "p1" } as never);
    expect(store.history().map((h) => h.id)).toEqual([ID]);

    expect(await store.remove(ID)).toBe(true);
    expect(await exists(join(dir, ID))).toBe(false);
    expect(store.history()).toEqual([]);
    expect(await store.load(ID)).toBeNull();
  });

  it("leaves other sessions alone", async () => {
    await store.create(session());
    await store.create(session({ id: OTHER }));
    await store.remove(ID);
    expect(store.history().map((h) => h.id)).toEqual([OTHER]);
    expect(JSON.parse(await readFile(join(dir, OTHER, "session.json"), "utf8")).id).toBe(OTHER);
  });

  it("ignores a save, a board write or a proposal that arrives after the removal", async () => {
    await store.create(session());
    await store.remove(ID);
    await store.save(session());
    await store.writeBoard(ID, { version: 2, elements: [] });
    await store.saveProposal(ID, { id: "p2" } as never);
    expect(await exists(join(dir, ID))).toBe(false);
    expect(store.history()).toEqual([]);
  });

  it("waits for a save that is still in flight instead of racing it", async () => {
    await store.create(session());
    const pending = store.save(session({ phase: "capacity" }));
    await store.remove(ID);
    await pending;
    expect(await exists(join(dir, ID))).toBe(false);
  });

  it("reports false when there was nothing on disk", async () => {
    expect(await store.remove(OTHER)).toBe(false);
  });

  it("refuses an id that is not a session id, and never goes near the path", async () => {
    await expect(store.remove("../sessions")).rejects.toThrow("Invalid session id");
    await expect(store.remove("")).rejects.toThrow("Invalid session id");
    expect(await exists(dir)).toBe(true);
  });

  it("refuses to delete through a symlinked session folder and keeps the target", async () => {
    const outside = join(root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "precious.txt"), "keep");
    await symlink(outside, join(dir, ID));
    await expect(store.remove(ID)).rejects.toThrow();
    expect(await readFile(join(outside, "precious.txt"), "utf8")).toBe("keep");
  });
});

describe("fields added later", () => {
  it("loads a session saved without step answers, a focus or a notes record", async () => {
    const { stepNotes: _a, stepNotesVersion: _b, stepSummaries: _e, focus: _c, studyNotes: _d, ...old } = session();
    await mkdir(join(dir, ID), { recursive: true });
    await writeFile(join(dir, ID, "session.json"), JSON.stringify(old));
    const loaded = await store.load(ID);
    expect(loaded?.stepNotes).toEqual({});
    expect(loaded?.stepNotesVersion).toBe(0);
    expect(loaded?.focus).toBeNull();
    expect(loaded?.studyNotes).toBeNull();
    expect(loaded?.stepSummaries).toEqual({});
  });

  it("loads a guided session saved without verdicts, assists or a readiness call, and summarises it by verdict", async () => {
    const old = session({ mode: "guided", status: "debriefed" });
    expect(old.stepVerdicts).toBeUndefined();
    await mkdir(join(dir, ID), { recursive: true });
    await writeFile(join(dir, ID, "session.json"), JSON.stringify(old));
    const loaded = await store.load(ID);
    expect(loaded?.stepVerdicts).toBeUndefined();
    expect(loaded?.assists).toBeUndefined();
    expect(summarize(loaded!).readiness).toBeNull();
  });

  it("puts a guided round's readiness call in its history summary", () => {
    const card = { verdict: { sde2: "no_hire" }, readiness: { call: "not_yet", reasons: ["API was assisted."] } } as unknown as Session["scorecard"];
    expect(summarize(session({ mode: "guided", status: "debriefed", scorecard: card })).readiness).toBe("not_yet");
  });

  it("leaves the scores out of an unscored round and carries its clock", () => {
    const item = summarize(session());
    expect(item.scores).toBeUndefined();
    expect(item.gaps).toBeUndefined();
    expect(item.clock).toMatchObject({ pausedMs: 0, pauseStartedAt: null, durationMs: 45 * 60_000 });
  });

  it("puts the scores, phase timing and gap state of a scored round in its summary", () => {
    const card = {
      verdict: { sde2: "lean_no_hire" },
      dimensions: [
        { id: "driving", name: "Driving and time", score: 1, evidence: [], whatA4LooksLike: "" },
        { id: "depth", name: "Technical depth", score: 3, evidence: [], whatA4LooksLike: "" },
      ],
      gaps: [
        { title: "Capacity math", severity: "high", whyItMatters: "", whatGoodLooksLike: "Each number ends in which means", teachMinutes: 5 },
        { title: "Retries", severity: "low", whyItMatters: "", whatGoodLooksLike: "Backoff", teachMinutes: 3 },
      ],
      phaseTiming: [{ phase: "capacity", label: "Capacity math", plannedMinutes: 4, actualMinutes: 22 }],
    } as unknown as Session["scorecard"];
    const item = summarize(session({ status: "debriefed", scorecard: card, gapProgress: { "Capacity math": { by: "coach", state: "taught", at: "2026-11-01T10:00:00Z" } } }));
    expect(item.scores).toEqual([
      { id: "driving", name: "Driving and time", score: 1 },
      { id: "depth", name: "Technical depth", score: 3 },
    ]);
    expect(item.phaseTiming).toEqual([{ phase: "capacity", label: "Capacity math", plannedMinutes: 4, actualMinutes: 22 }]);
    expect(item.gaps).toEqual([
      { title: "Capacity math", goodLooksLike: "Each number ends in which means", severity: "high", done: true, whyItMatters: "" },
      { title: "Retries", goodLooksLike: "Backoff", severity: "low", done: false, whyItMatters: "" },
    ]);
  });

  it("gives a scored round the step plan that adds up to its length, whatever plan was saved", () => {
    const old = [
      { phase: "requirements", label: "Requirements", plannedMinutes: 7, actualMinutes: 8 },
      { phase: "entities", label: "Core entities", plannedMinutes: 3, actualMinutes: 6 },
      { phase: "api", label: "API", plannedMinutes: 7, actualMinutes: 5 },
      { phase: "design", label: "High-level design", plannedMinutes: 17, actualMinutes: 20 },
      { phase: "deep_dives", label: "Deep dives", plannedMinutes: 27, actualMinutes: 0 },
    ];
    const card = { verdict: { sde2: "hire" }, dimensions: [], gaps: [], phaseTiming: old } as unknown as Session["scorecard"];
    const item = summarize(session({ status: "debriefed", scorecard: card, durationMs: 60 * 60_000 }));
    expect(item.phaseTiming?.map((r) => r.plannedMinutes)).toEqual([7, 2, 7, 17, 27]);
    expect(item.phaseTiming?.map((r) => r.actualMinutes)).toEqual([8, 6, 5, 20, 0]);
  });

  it("hands the coach, the scribe and the debrief one scorecard, with the saved timing set against today's plan", () => {
    const card = {
      verdict: { sde2: "hire" },
      summary: "kept as saved",
      phaseTiming: [
        { phase: "entities", label: "Core entities", plannedMinutes: 3, actualMinutes: 6 },
        { phase: "api", label: "API", plannedMinutes: 7, actualMinutes: 5 },
      ],
    } as unknown as Session["scorecard"];
    const s = session({ status: "debriefed", scorecard: card, durationMs: 60 * 60_000 });
    const out = scorecardWithCurrentPlan(s);
    expect(out).toMatchObject({ summary: "kept as saved" });
    expect(out?.phaseTiming?.map((r) => r.plannedMinutes)).toEqual([2, 7]);
    expect(s.scorecard?.phaseTiming?.[0]?.plannedMinutes).toBe(3);
    expect(scorecardWithCurrentPlan(session())).toBeUndefined();
  });

  it("marks a gap round in its summary, and an ordinary or older round as not one", () => {
    expect(summarize(session({ focus: { title: "Capacity math", goodLooksLike: "x" } })).focus).toBe(true);
    expect(summarize(session()).focus).toBe(false);
    const { focus: _f, ...old } = session();
    expect(summarize(old as Session).focus).toBe(false);
  });

  it("says when a paused round stopped", () => {
    const at = "2026-11-07T09:00:00.000Z";
    const item = summarize(session({ status: "paused", pauseReason: "user", pauseStartedAt: at, startedAt: "2026-11-07T08:00:00.000Z" }));
    expect(item.pause).toEqual({ reason: "user", pausedAt: at, timeLeftMs: 0 });
  });

  it("loads a session saved before gap progress existed with no records, and keeps saved ones", async () => {
    const { gapProgress: _g, ...old } = session({ status: "debriefed" });
    await mkdir(join(dir, ID), { recursive: true });
    await writeFile(join(dir, ID, "session.json"), JSON.stringify(old));
    expect((await store.load(ID))?.gapProgress).toEqual({});

    const record = { by: "coach", state: "taught", at: "2026-11-01T10:00:00.000Z" } as const;
    await writeFile(join(dir, ID, "session.json"), JSON.stringify({ ...old, gapProgress: { "Hot keys": record } }));
    expect((await store.load(ID))?.gapProgress).toEqual({ "Hot keys": record });
  });

  it("loads a debriefed session from before the checklist with its step answers and notepads intact", async () => {
    const {
      checklist: _a,
      stepChecks: _b,
      pins: _c,
      ...old
    } = session({
      status: "debriefed",
      stepNotes: { requirements: "Functional: shorten and redirect." },
      stepNotesVersion: 2,
      stepSummaries: { requirements: { status: "done", proposed: ["Shorten and redirect"], agreed: ["Links live 5 years"] } },
    });
    await mkdir(join(dir, ID), { recursive: true });
    await writeFile(join(dir, ID, "session.json"), JSON.stringify(old));
    const loaded = await store.load(ID);
    expect(loaded?.checklist).toEqual({});
    expect(loaded?.stepChecks).toEqual({});
    expect(loaded?.pins).toEqual([]);
    expect(loaded?.stepNotes.requirements).toBe("Functional: shorten and redirect.");
    expect(loaded?.stepSummaries.requirements).toEqual({ status: "done", proposed: ["Shorten and redirect"], agreed: ["Links live 5 years"] });
  });

  it("ends a step check that was running at shutdown, keeping what it found before", async () => {
    const item = { state: "covered", source: "chat", at: 1000, quote: "redirect", detail: "" };
    const saved = {
      ...session(),
      stepChecks: {
        requirements: { status: "checking", checkedAt: 900, usedImage: false, items: { "requirements-2": item } },
        capacity: { status: "checking", checkedAt: null, usedImage: false, items: {} },
      },
    };
    await mkdir(join(dir, ID), { recursive: true });
    await writeFile(join(dir, ID, "session.json"), JSON.stringify(saved));
    const loaded = await store.load(ID);
    expect(loaded?.stepChecks.requirements).toMatchObject({ status: "done", items: { "requirements-2": item } });
    expect(loaded?.stepChecks.capacity?.status).toBe("failed");
  });

  it("marks a step summary that was still running at shutdown as failed", async () => {
    const saved = { ...session(), stepSummaries: { requirements: { status: "pending", proposed: ["a"], agreed: [] } } };
    await mkdir(join(dir, ID), { recursive: true });
    await writeFile(join(dir, ID, "session.json"), JSON.stringify(saved));
    expect((await store.load(ID))?.stepSummaries.requirements).toEqual({ status: "failed", proposed: ["a"], agreed: [] });
  });

  it("tells the history how much time a paused round has left, and whether its notes were saved", async () => {
    const start = new Date("2026-10-30T09:00:00Z");
    await store.create(
      session({
        status: "paused",
        pauseReason: "away",
        startedAt: start.toISOString(),
        pausedMs: 60_000,
        pauseStartedAt: new Date(start.getTime() + 11 * 60_000).toISOString(),
        studyNotes: { proposalId: "p1", status: "applied", appliedCount: 2, savedAt: start.toISOString() },
      }),
    );
    const [item] = store.history();
    expect(item?.pause).toEqual({ reason: "away", pausedAt: new Date(start.getTime() + 11 * 60_000).toISOString(), timeLeftMs: 35 * 60_000 });
    expect(item?.notesSaved).toBe(true);
  });
});
