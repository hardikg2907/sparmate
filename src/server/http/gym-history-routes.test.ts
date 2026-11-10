import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AttemptView, DrillDetail, GymSummary, RecentAttemptRow } from "../../shared/drills";
import type { SessionHistoryItem } from "../../shared/types";
import { PORT, makeStack, type Stack } from "../engine/__fixtures__/stack";
import { DrillStore } from "../engine/drill-store";
import { DrillService } from "../engine/drills";
import { createFakeDriver } from "../engine/fake-driver";
import { UsageLedger, type UsageRecord } from "../engine/usage-ledger";
import { buildApp } from "./app";
import { newCsrfToken } from "./security";

const TOKEN = newCsrfToken();
const HOST = `127.0.0.1:${PORT}`;
const GOOD = { host: HOST, origin: `http://${HOST}`, "x-csrf-token": TOKEN };
const KEY_TEXT = ["room to spare", "one code lives on one Redis shard", "Sharding by code is an option"];

let stack: Stack;
let app: FastifyInstance;
let store: DrillStore;
let ledger: UsageLedger;

const played: SessionHistoryItem = {
  id: "20261030-0900-c2-url-shortener-abcd",
  problemId: "c2-url-shortener",
  title: "URL Shortener",
  track: "hld",
  mode: "interview",
  createdAt: new Date(2026, 9, 30, 9, 0).toISOString(),
  endedAt: new Date(2026, 9, 30, 9, 45).toISOString(),
  status: "debriefed",
  verdict: "lean_no_hire",
  pause: null,
  notesSaved: false,
  gaps: [{ title: "Capacity math that changes the design", goodLooksLike: "Each number ends with a decision.", severity: "high", done: false }],
};

const ANSWER =
  "Writes are about forty per second, which means one primary database handles them.\nReads reach four thousand per second, which means a cache in front of the database.\nStorage is three terabytes, which means one large primary with replicas.";

const usageRow = (attemptId: string, cost: number): UsageRecord => ({
  time: "2026-11-03T10:00:00.000Z",
  sessionId: null,
  problemId: "c2-url-shortener",
  track: "hld",
  mode: null,
  drillAttemptId: attemptId,
  drillKind: "capacity",
  role: "grader",
  model: "claude-sonnet-5-5",
  effort: "low",
  inputTokens: 10,
  outputTokens: 10,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  cost,
  costUsd: cost,
  duration: 100,
  durationMs: 100,
  ok: true,
});

beforeEach(async () => {
  stack = await makeStack();
  store = new DrillStore(join(stack.data, "drills.json"), stack.log);
  await store.load();
  ledger = new UsageLedger({ filePath: join(stack.data, "usage.jsonl") });
  const drills = new DrillService({
    store,
    history: () => [played],
    problems: stack.deps.problems,
    driver: createFakeDriver({ chunkDelayMs: 0 }),
    settings: stack.settings,
    prompts: stack.deps.prompts,
    guard: stack.deps.guard,
    log: stack.log,
    now: () => new Date(2026, 10, 3, 10, 0),
    costs: () => ledger.drillCosts(),
  });
  app = await buildApp({ config: stack.config, csrfToken: TOKEN, manager: stack.manager, settings: stack.settings, store: stack.store, log: stack.log, drills });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  await stack.cleanup();
});

const get = (url: string) => app.inject({ method: "GET", url, headers: { host: HOST } });
const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, headers: GOOD, payload: payload as object });

/** One queued capacity attempt, then one free walk attempt. Returns both attempt ids and the queued drill id. */
async function playTwo() {
  const queued = (await get("/api/gym")).json<GymSummary>().queue[0];
  const first = (await post("/api/gym/submit", { drill: "capacity", problemId: "c2-url-shortener", drillId: queued?.id, answer: ANSWER })).json<{ attemptId: string }>();
  const second = (await post("/api/gym/submit", { drill: "walk", problemId: "c2-url-shortener", answer: ANSWER })).json<{ attemptId: string }>();
  return { drillId: queued?.id ?? "", first: first.attemptId, second: second.attemptId };
}

describe("GET /api/gym/drills/:drillId", () => {
  it("returns the drill, what it earned and its counted attempts with labelled scores and the ledger cost", async () => {
    const { drillId, first } = await playTwo();
    ledger.record(usageRow(first, 0.1));
    ledger.record(usageRow(first, 0.25));
    const res = await get(`/api/gym/drills/${drillId}`);
    expect(res.statusCode).toBe(200);
    const body = res.json<DrillDetail>();
    expect(body.today).toBe("2026-11-03");
    expect(body.item).toMatchObject({
      id: drillId,
      drill: "capacity",
      title: "Capacity math",
      gapTitle: "Capacity math that changes the design",
      status: "open",
      passes: 1,
      originProblemTitle: "URL Shortener",
      proofs: ["URL Shortener"],
    });
    expect(typeof body.item.problemTitle).toBe("string");
    expect(body.attempts).toHaveLength(1);
    const attempt = body.attempts[0];
    expect(attempt).toMatchObject({ id: first, problemTitle: "URL Shortener", variantTitle: null, outcome: "ready", firstOutcome: null, revised: false, legacy: false });
    expect(attempt?.costUsd).toBeCloseTo(0.35);
    expect(attempt?.scores[0]).toEqual({ id: "picks_numbers", label: "Picks the numbers that decide", core: true, score: expect.any(Number) });
    expect(attempt?.scores.map((s) => s.id)).toEqual(["picks_numbers", "math", "decisions", "assumptions"]);
  });

  it("shows no cost for an attempt the ledger never saw, and leaves out a score the rubric lost", async () => {
    const { drillId, first } = await playTwo();
    await store.update((draft) => {
      const row = draft.attempts.find((a) => a.id === first);
      row?.scores.push({ id: "retired_criterion", score: 2 });
      return { save: true, value: null };
    });
    const attempt = (await get(`/api/gym/drills/${drillId}`)).json<DrillDetail>().attempts[0];
    expect(attempt?.costUsd).toBeNull();
    expect(attempt?.scores.map((s) => s.id)).not.toContain("retired_criterion");
  });

  it("lists legacy rows and skips open rows", async () => {
    const { drillId } = await playTwo();
    await store.update((draft) => {
      const base = draft.attempts[0];
      if (!base) throw new Error("no attempt");
      draft.attempts.push(
        { ...base, id: "1111111111111111", legacy: true, scores: [], at: "2026-11-01T10:00:00.000Z" },
        { ...base, id: "2222222222222222", status: "open", outcome: null, scores: [] },
      );
      return { save: true, value: null };
    });
    const rows = (await get(`/api/gym/drills/${drillId}`)).json<DrillDetail>().attempts;
    expect(rows.map((r) => r.id)).toHaveLength(2);
    expect(rows.at(-1)).toMatchObject({ id: "1111111111111111", legacy: true, scores: [] });
  });

  it("is 404 for an unknown id and 400 for one that is not an id", async () => {
    expect((await get("/api/gym/drills/0123456789abcdef")).statusCode).toBe(404);
    for (const bad of ["zz", "0123456789ABCDEF", "..%2F..%2Fx", "0123456789abcdef0"]) expect((await get(`/api/gym/drills/${bad}`)).statusCode).toBe(400);
  });

  it("is 404 when the server has no drill service", async () => {
    const bare = await buildApp({ config: stack.config, csrfToken: TOKEN, manager: stack.manager, settings: stack.settings, store: stack.store, log: stack.log });
    await bare.ready();
    const res = await bare.inject({ method: "GET", url: "/api/gym/drills/0123456789abcdef", headers: { host: HOST } });
    await bare.close();
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/gym/attempts", () => {
  it("lists free and queued attempts, newest first, with the kind and the queued drill", async () => {
    const { drillId, first, second } = await playTwo();
    const rows = (await get("/api/gym/attempts")).json<RecentAttemptRow[]>();
    expect(rows.map((r) => r.id)).toEqual([second, first]);
    expect(rows[0]).toMatchObject({ drill: "walk", title: "Walk a request", drillId: null, outcome: expect.any(String) });
    expect(rows[1]).toMatchObject({ drill: "capacity", title: "Capacity math", drillId });
  });

  it("limits the list", async () => {
    await playTwo();
    expect((await get("/api/gym/attempts?limit=1")).json<unknown[]>()).toHaveLength(1);
    expect((await get("/api/gym/attempts?limit=100")).statusCode).toBe(200);
  });

  it.each(["limit=0", "limit=101", "limit=abc", "limit=1.5", "limit=-1", "limit=", "limit=%201", "limit=1e1", "limit=007x", "limit=1&limit=2", "limit=5&other=1", "other=1"])(
    "refuses the query %s",
    async (query) => {
      expect((await get(`/api/gym/attempts?${query}`)).statusCode).toBe(400);
    },
  );

  it("never lists an open attempt", async () => {
    await playTwo();
    await store.update((draft) => {
      const base = draft.attempts[0];
      if (!base) throw new Error("no attempt");
      draft.attempts.push({ ...base, id: "2222222222222222", status: "open", outcome: null, scores: [] });
      return { save: true, value: null };
    });
    expect((await get("/api/gym/attempts")).json<RecentAttemptRow[]>().map((r) => r.id)).not.toContain("2222222222222222");
  });
});

describe("GET /api/gym/attempts/:attemptId", () => {
  it("returns what the page needs to show an attempt", async () => {
    const { first } = await playTwo();
    const res = await get(`/api/gym/attempts/${first}`);
    expect(res.statusCode).toBe(200);
    const body = res.json<AttemptView>();
    expect(body).toMatchObject({ id: first, drill: "capacity", title: "Capacity math", problemTitle: "URL Shortener", changed: null, answers: [ANSWER], turns: [] });
    expect(body.task).toContain("numbers");
    const grade = body.grades[0];
    expect(grade).toMatchObject({ outcome: "ready" });
    expect(grade?.scores.map((s) => s.label)).toContain("Math is about right");
    expect(grade?.yourLine).not.toBe("");
    expect(Object.keys(body).sort()).toEqual(["answers", "changed", "drill", "grades", "id", "problemTitle", "task", "title", "turns"]);
    expect(Object.keys(grade ?? {}).sort()).toEqual(["improve", "outcome", "scores", "wentWell", "yourLine"]);
  });

  it("withholds the strong answer while a queued drill of the same kind is open", async () => {
    const { first } = await playTwo();
    const body = (await get(`/api/gym/attempts/${first}`)).json<AttemptView>();
    expect(body.grades.every((g) => !("strong" in g))).toBe(true);
    expect(JSON.stringify(body)).not.toContain("Each number or step ends with what it forces");
  });

  it("shows the strong answer of a free drill when no queued drill of that kind is open", async () => {
    const { second } = await playTwo();
    // The line stays back while a revision is possible, so the attempt's one revision is marked as used.
    await store.update((draft) => {
      const row = draft.attempts.find((r) => r.id === second);
      if (row) row.revised = true;
      return { save: true, value: null };
    });
    const body = (await get(`/api/gym/attempts/${second}`)).json<AttemptView>();
    expect(body.grades[0]?.strong).toEqual(expect.stringContaining("Each number or step ends with what it forces"));
  });

  it("withholds the strong answer while the attempt can still be revised", async () => {
    const weak = (await post("/api/gym/submit", { drill: "walk", problemId: "c2-url-shortener", answer: "I would just try it and see." })).json<{
      attemptId: string;
      canRevise: boolean;
    }>();
    expect(weak.canRevise).toBe(true);
    const body = (await get(`/api/gym/attempts/${weak.attemptId}`)).json<AttemptView>();
    expect(body.grades.every((g) => !("strong" in g))).toBe(true);
    expect(JSON.stringify(body)).not.toContain("Each number or step ends with what it forces");
  });

  it("shows the strong answer once the queued drill of the kind is closed", async () => {
    const { drillId, first } = await playTwo();
    await store.update((draft) => {
      const item = draft.items.find((i) => i.id === drillId);
      if (item) item.status = "closed";
      return { save: true, value: null };
    });
    const body = (await get(`/api/gym/attempts/${first}`)).json<AttemptView>();
    expect(body.grades[0]?.strong).toEqual(expect.any(String));
    expect((await get("/api/gym")).json<GymSummary>().closed.map((c) => c.id)).toEqual([drillId]);
  });

  it("is 404 for an unknown, an open or a legacy attempt, and 400 for a bad id", async () => {
    const { first } = await playTwo();
    await store.update((draft) => {
      const base = draft.attempts.find((a) => a.id === first);
      if (!base) throw new Error("no attempt");
      draft.attempts.push({ ...base, id: "1111111111111111", legacy: true, scores: [] }, { ...base, id: "2222222222222222", status: "open", outcome: null, scores: [] });
      return { save: true, value: null };
    });
    for (const id of ["0123456789abcdef", "1111111111111111", "2222222222222222"]) expect((await get(`/api/gym/attempts/${id}`)).statusCode).toBe(404);
    for (const bad of ["zz", "..%2F..%2Fx", "0123456789ABCDEF"]) expect((await get(`/api/gym/attempts/${bad}`)).statusCode).toBe(400);
  });

  it("is 404 when the body file is missing", async () => {
    const { first } = await playTwo();
    await store.removeBody(first);
    expect((await get(`/api/gym/attempts/${first}`)).statusCode).toBe(404);
  });
});

describe("what the history never sends", () => {
  it("holds no text of the answer key in any response", async () => {
    const { drillId, first, second } = await playTwo();
    const bodies = await Promise.all([
      get(`/api/gym/drills/${drillId}`),
      get("/api/gym/attempts"),
      get(`/api/gym/attempts/${first}`),
      get(`/api/gym/attempts/${second}`),
      get("/api/gym"),
    ]);
    const text = bodies.map((r) => r.body).join("\n");
    for (const key of KEY_TEXT) expect(text).not.toContain(key);
  });
});

describe("GET /api/gym additions", () => {
  it("sends the drill points for Progress and no closed row while nothing is closed", async () => {
    const { first } = await playTwo();
    const summary = (await get("/api/gym")).json<GymSummary>();
    expect(summary.closed).toEqual([]);
    expect(summary.points).toHaveLength(2);
    expect(summary.points[0]).toMatchObject({ day: "2026-11-03", kind: "capacity", skill: "scale_reliability", outcome: "ready", firstTry: true });
    expect(summary.points[1]).toMatchObject({ kind: "walk", skill: "design" });
    expect(first).toBeTruthy();
  });

  it("lists closed drills newest first, at most 50", async () => {
    await playTwo();
    await store.update((draft) => {
      const base = draft.items[0];
      if (!base) throw new Error("no item");
      base.status = "closed";
      base.dueOn = "2026-11-01";
      for (let i = 0; i < 60; i++) draft.items.push({ ...base, id: i.toString(16).padStart(16, "0"), dueOn: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}` });
      return { save: true, value: null };
    });
    const closed = (await get("/api/gym")).json<GymSummary>().closed;
    expect(closed).toHaveLength(50);
    expect(closed[0]).toMatchObject({ closedOn: "2026-11-01", drill: "capacity", title: "Capacity math", originProblemTitle: "URL Shortener" });
    const days = closed.map((c) => c.closedOn);
    expect([...days].sort().reverse()).toEqual(days);
  });
});
