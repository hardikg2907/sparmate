import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GymSummary } from "../../shared/drills";
import type { SessionHistoryItem } from "../../shared/types";
import { PORT, makeStack, type Stack } from "../engine/__fixtures__/stack";
import { DrillStore } from "../engine/drill-store";
import { DrillService } from "../engine/drills";
import { createFakeDriver } from "../engine/fake-driver";
import { buildApp } from "./app";
import { newCsrfToken } from "./security";

const TOKEN = newCsrfToken();
const HOST = `127.0.0.1:${PORT}`;
const GOOD = { host: HOST, origin: `http://${HOST}`, "x-csrf-token": TOKEN };

let stack: Stack;
let app: FastifyInstance;
let history: SessionHistoryItem[];

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

beforeEach(async () => {
  stack = await makeStack();
  history = [played];
  const store = new DrillStore(join(stack.data, "drills.json"), stack.log);
  await store.load();
  const drills = new DrillService({
    store,
    history: () => history,
    problems: stack.deps.problems,
    driver: createFakeDriver({ chunkDelayMs: 0 }),
    settings: stack.settings,
    prompts: stack.deps.prompts,
    guard: stack.deps.guard,
    log: stack.log,
    now: () => new Date(2026, 10, 3, 10, 0),
  });
  app = await buildApp({ config: stack.config, csrfToken: TOKEN, manager: stack.manager, settings: stack.settings, store: stack.store, log: stack.log, drills });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  await stack.cleanup();
});

const post = (url: string, payload: unknown, headers: Record<string, string> = GOOD) => app.inject({ method: "POST", url, headers, payload: payload as object });

describe("GET /api/gym", () => {
  it("returns the queue, the due count and the problems a drill may use", async () => {
    const res = await app.inject({ method: "GET", url: "/api/gym", headers: { host: HOST } });
    expect(res.statusCode).toBe(200);
    const body = res.json<GymSummary>();
    expect(body.dueCount).toBe(1);
    expect(body.queue[0]).toMatchObject({ drill: "capacity", problemId: "c2-url-shortener", due: true, passes: 0, minutes: 10 });
    expect(body.problems.map((p) => p.id)).toEqual(["c2-url-shortener"]);
    expect(body.week).toEqual({ ready: 0, attempted: 0 });
  });

  it("is a 404 when the server has no drill service", async () => {
    const bare = await buildApp({ config: stack.config, csrfToken: TOKEN, manager: stack.manager, settings: stack.settings, store: stack.store, log: stack.log });
    await bare.ready();
    const res = await bare.inject({ method: "GET", url: "/api/gym", headers: { host: HOST } });
    await bare.close();
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/gym/prompt", () => {
  it("starts a free drill on a played problem", async () => {
    const res = await post("/api/gym/prompt", { drill: "walk", problemId: "c2-url-shortener" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.title).toBe("Walk a request");
    expect(body.minutes).toBe(10);
    expect(body.task).toContain("Walk one redirect");
    expect(JSON.stringify(body)).not.toContain("Reference design");
  });

  it("starts a queued drill by its id", async () => {
    const queued = (await app.inject({ method: "GET", url: "/api/gym", headers: { host: HOST } })).json<GymSummary>().queue[0];
    const res = await post("/api/gym/prompt", { drill: "capacity", problemId: "c2-url-shortener", drillId: queued?.id });
    expect(res.statusCode).toBe(200);
  });

  it("refuses a problem that was never played", async () => {
    expect((await post("/api/gym/prompt", { drill: "capacity", problemId: "c2-rate-limiter" })).statusCode).toBe(404);
  });

  it("refuses a drill that does not fit the problem's track", async () => {
    expect((await post("/api/gym/prompt", { drill: "lld_skeleton", problemId: "c2-url-shortener" })).statusCode).toBe(400);
  });

  it.each([
    ["an unknown key", { drill: "walk", problemId: "c2-url-shortener", extra: 1 }],
    ["an unknown drill", { drill: "juggling", problemId: "c2-url-shortener" }],
    ["a path in the problem id", { drill: "walk", problemId: "../sessions" }],
    ["a path in the drill id", { drill: "walk", problemId: "c2-url-shortener", drillId: "../../x" }],
    ["no body", undefined],
  ])("rejects %s with 400", async (_n, payload) => {
    expect((await post("/api/gym/prompt", payload)).statusCode).toBe(400);
  });

  it("rejects a request without the CSRF token", async () => {
    const res = await post("/api/gym/prompt", { drill: "walk", problemId: "c2-url-shortener" }, { host: HOST, origin: `http://${HOST}` });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /api/gym/submit", () => {
  it("grades the answer and moves the queued drill", async () => {
    const res = await post("/api/gym/submit", { drill: "capacity", problemId: "c2-url-shortener", answer: ANSWER });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ outcome: "ready", readyCount: 1, closed: false, nextDueOn: "2026-11-06", canRevise: false, revised: false, firstOutcome: null });
    const after = (await app.inject({ method: "GET", url: "/api/gym", headers: { host: HOST } })).json<GymSummary>();
    expect(after.dueCount).toBe(0);
    expect(after.week).toEqual({ ready: 1, attempted: 1 });
  });

  it("returns needs work for a thin answer, with the criteria, feedback and the quoted line, and no answer-key text", async () => {
    const res = await post("/api/gym/submit", { drill: "capacity", problemId: "c2-url-shortener", answer: "It is big." });
    const body = res.json();
    expect(body.outcome).toBe("needs_work");
    expect(body.canRevise).toBe(true);
    expect(body.readyCount).toBe(0);
    expect(body.nextDueOn).toBe("2026-11-04");
    expect(body.improve.length).toBeGreaterThan(0);
    expect(body.yourLine).toBe("It is big.");
    expect(body.scores).toEqual([
      { id: "picks_numbers", label: "Picks the numbers that decide", core: true, score: 1 },
      { id: "math", label: "Math is about right", core: true, score: 1 },
      { id: "decisions", label: "Each number ends in a decision", core: true, score: 1 },
      { id: "assumptions", label: "States its assumptions", core: false, score: 2 },
    ]);
    expect(Object.keys(body).sort()).toEqual(
      ["attemptId", "canRevise", "closed", "firstOutcome", "improve", "next", "nextDueOn", "outcome", "readyCount", "revised", "scores", "wentWell", "yourLine"].sort(),
    );
    expect(JSON.stringify(body)).not.toContain("strong");
  });

  it("puts the grader call on the usage ledger as the grader role", async () => {
    const records: { role: string }[] = [];
    const { wrapDriverWithLedger } = await import("../engine/usage-driver");
    const wrapped = wrapDriverWithLedger(createFakeDriver({ chunkDelayMs: 0 }), { record: (r: { role: string }) => records.push(r) } as never);
    await wrapped.runOnce({
      role: "grader",
      model: "claude-sonnet-5-5",
      effort: "medium",
      systemPrompt: async () => "",
      tools: [],
      fake: { drill: { kind: "capacity", key: "alpha beta gamma delta", answer: "x" } },
      turn: { text: "x", meta: { kind: "oneshot" } },
      output: null,
      maxTurns: 1,
    });
    expect(records.map((r) => r.role)).toEqual(["grader"]);
  });

  it.each([
    ["an empty answer", { drill: "capacity", problemId: "c2-url-shortener", answer: "" }],
    ["a blank answer", { drill: "capacity", problemId: "c2-url-shortener", answer: "   " }],
    ["a missing answer", { drill: "capacity", problemId: "c2-url-shortener" }],
    ["an answer over 8000 characters", { drill: "capacity", problemId: "c2-url-shortener", answer: "x".repeat(8001) }],
    ["an unknown key", { drill: "capacity", problemId: "c2-url-shortener", answer: "x", outcome: "ready" }],
    ["a path in the variant", { drill: "capacity", problemId: "c2-url-shortener", answer: "x", variant: "../x" }],
    ["a variant on a free drill", { drill: "capacity", problemId: "c2-url-shortener", answer: "x", variant: "global-latency" }],
    ["a path in the problem id", { drill: "capacity", problemId: "../x", answer: "x" }],
  ])("rejects %s with 400", async (_n, payload) => {
    expect((await post("/api/gym/submit", payload)).statusCode).toBe(400);
  });

  it("tells the candidate to write an answer when it is blank", async () => {
    const res = await post("/api/gym/submit", { drill: "capacity", problemId: "c2-url-shortener", answer: "  \n" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Write an answer first.");
  });

  it("answers 409 to a second submit while the first is still being graded", async () => {
    const queued = (await app.inject({ method: "GET", url: "/api/gym", headers: { host: HOST } })).json<GymSummary>().queue[0];
    const body = { drill: "capacity", problemId: "c2-url-shortener", drillId: queued?.id, answer: ANSWER };
    const codes = (await Promise.all([post("/api/gym/submit", body), post("/api/gym/submit", body)])).map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 409]);
  });

  it("refuses an answer for a problem that was never played", async () => {
    expect((await post("/api/gym/submit", { drill: "capacity", problemId: "c2-rate-limiter", answer: "x" })).statusCode).toBe(404);
  });
});

describe("POST /api/gym/revise", () => {
  const submit = async (answer: string) => (await post("/api/gym/submit", { drill: "capacity", problemId: "c2-url-shortener", answer })).json<{ attemptId: string }>();

  it("grades one revision and returns the final outcome", async () => {
    const first = await submit("It is big.");
    const res = await post("/api/gym/revise", { attemptId: first.attemptId, answer: ANSWER, elapsedSeconds: 20 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      attemptId: first.attemptId,
      outcome: "ready",
      firstOutcome: "needs_work",
      revised: true,
      canRevise: false,
      readyCount: 1,
      nextDueOn: "2026-11-05",
    });
    expect(JSON.stringify(res.json())).not.toContain("strong");
  });

  it("answers 404 for an unknown attempt and 409 for one that cannot be revised", async () => {
    expect((await post("/api/gym/revise", { attemptId: "0123456789abcdef", answer: ANSWER })).statusCode).toBe(404);
    const ready = await submit(ANSWER);
    expect((await post("/api/gym/revise", { attemptId: ready.attemptId, answer: ANSWER })).statusCode).toBe(409);
    const thin = await submit("It is big.");
    expect((await post("/api/gym/revise", { attemptId: thin.attemptId, answer: ANSWER })).statusCode).toBe(200);
    const again = await post("/api/gym/revise", { attemptId: thin.attemptId, answer: ANSWER });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe("This attempt was already revised.");
  });

  it("answers 409 to a second revision sent while the first is being graded", async () => {
    const first = await submit("It is big.");
    const codes = (
      await Promise.all([post("/api/gym/revise", { attemptId: first.attemptId, answer: ANSWER }), post("/api/gym/revise", { attemptId: first.attemptId, answer: ANSWER })])
    ).map((r) => r.statusCode);
    expect(codes.sort()).toEqual([200, 409]);
  });

  it.each([
    ["an empty answer", { attemptId: "0123456789abcdef", answer: "" }],
    ["a blank answer", { attemptId: "0123456789abcdef", answer: "  " }],
    ["a missing answer", { attemptId: "0123456789abcdef" }],
    ["a missing id", { answer: "x" }],
    ["an answer over 8000 characters", { attemptId: "0123456789abcdef", answer: "x".repeat(8001) }],
    ["an unknown key", { attemptId: "0123456789abcdef", answer: "x", drill: "capacity" }],
    ["a path in the id", { attemptId: "../../x", answer: "x" }],
    ["a time over two hours", { attemptId: "0123456789abcdef", answer: "x", elapsedSeconds: 7201 }],
    ["no body", undefined],
  ])("rejects %s with 400", async (_n, payload) => {
    expect((await post("/api/gym/revise", payload)).statusCode).toBe(400);
  });

  it("rejects a request without the CSRF token", async () => {
    const res = await post("/api/gym/revise", { attemptId: "0123456789abcdef", answer: "x" }, { host: HOST, origin: `http://${HOST}` });
    expect(res.statusCode).toBe(403);
  });
});
