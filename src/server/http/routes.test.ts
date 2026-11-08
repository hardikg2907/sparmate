import { stat } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PORT, makeStack, recordingPeer, type Stack } from "../engine/__fixtures__/stack";
import type { Session } from "../../shared/types";
import { buildApp } from "./app";
import { newCsrfToken } from "./security";
import { SetupStatus } from "../setup/checks";

const TOKEN = newCsrfToken();
const HOST = `127.0.0.1:${PORT}`;
const GOOD = { host: HOST, origin: `http://${HOST}`, "x-csrf-token": TOKEN };

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

let stack: Stack;
let app: FastifyInstance;

beforeEach(async () => {
  stack = await makeStack();
  app = await buildApp({ config: stack.config, csrfToken: TOKEN, manager: stack.manager, settings: stack.settings, store: stack.store, log: stack.log });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  await stack.cleanup();
});

const start = () => stack.manager.create({ problemId: "c2-url-shortener", mode: "interview" });
const del = (id: string, headers: Record<string, string>) => app.inject({ method: "DELETE", url: `/api/sessions/${id}`, headers });

describe("DELETE /api/sessions/:id", () => {
  it("discards the round, drops its history entry and answers ok", async () => {
    const id = await start();
    const res = await del(id, GOOD);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(await exists(stack.store.dir(id))).toBe(false);
    expect((await app.inject({ method: "GET", url: "/api/sessions", headers: { host: HOST } })).json()).toEqual([]);
    expect((await app.inject({ method: "GET", url: `/api/sessions/${id}`, headers: { host: HOST } })).statusCode).toBe(404);
  });

  it("closes the sockets of the round it deletes", async () => {
    const id = await start();
    const peer = recordingPeer();
    (await stack.manager.open(id))?.attach(peer);
    expect((await del(id, GOOD)).statusCode).toBe(200);
    expect(peer.msgs.at(-1)).toEqual({ type: "session.discarded" });
    expect(peer.closed).toBe(true);
  });

  it("refuses a foreign Host with 421, before anything else", async () => {
    const id = await start();
    const res = await del(id, { ...GOOD, host: "attacker.example" });
    expect(res.statusCode).toBe(421);
    expect(await exists(stack.store.dir(id))).toBe(true);
  });

  it.each([
    ["no Origin", { host: HOST, "x-csrf-token": TOKEN }],
    ["a foreign Origin", { host: HOST, origin: "http://evil.example", "x-csrf-token": TOKEN }],
    ["an https Origin", { host: HOST, origin: `https://${HOST}`, "x-csrf-token": TOKEN }],
    ["no CSRF token", { host: HOST, origin: `http://${HOST}` }],
    ["a wrong CSRF token", { host: HOST, origin: `http://${HOST}`, "x-csrf-token": newCsrfToken() }],
    ["a truncated CSRF token", { host: HOST, origin: `http://${HOST}`, "x-csrf-token": TOKEN.slice(0, 10) }],
  ])("refuses %s with 403 and deletes nothing", async (_name, headers) => {
    const id = await start();
    const res = await del(id, headers);
    expect(res.statusCode).toBe(403);
    expect(await exists(stack.store.dir(id))).toBe(true);
    expect(stack.manager.history().map((h) => h.id)).toEqual([id]);
  });

  it("answers 404 for an id that fails the id check, whatever it tries to reach", async () => {
    await start();
    for (const bad of ["abc", "..", "%2e%2e", "..%2F..%2Fdata", "20261030-0900-c2-url-shortener-ZZZZ", "a".repeat(90)]) {
      const res = await del(bad, GOOD);
      expect(res.statusCode, bad).toBe(404);
    }
    expect(await exists(stack.config.dataDir)).toBe(true);
    expect(stack.manager.history()).toHaveLength(1);
  });

  it("answers 404 for a well-formed id that does not exist", async () => {
    expect((await del("20261030-0900-c2-url-shortener-zzzz", GOOD)).statusCode).toBe(404);
  });

  it("answers 409 with a clear message while the debrief runs, and deletes nothing", async () => {
    const id = await start();
    const session = (await stack.manager.open(id))?.session as Session;
    session.status = "debriefing";
    const res = await del(id, GOOD);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/debrief is running/i);
    expect(await exists(stack.store.dir(id))).toBe(true);
  });
});

describe("TTS routes", () => {
  it("answers GET /api/tts/status with availability", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tts/status", headers: { host: HOST } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: false });
  });

  it("checks CSRF and Origin on POST /api/tts", async () => {
    const resNoCsrf = await app.inject({
      method: "POST",
      url: "/api/tts",
      headers: { host: HOST, origin: `http://${HOST}` },
      payload: { text: "Hello", voice: "bm_george", speed: 0.95 },
    });
    expect(resNoCsrf.statusCode).toBe(403);
  });

  it("rejects invalid TTS request bodies with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/tts",
      headers: GOOD,
      payload: { text: "", voice: "invalid_voice", speed: 2.5 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 503 when Kokoro TTS is unavailable", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/tts",
      headers: GOOD,
      payload: { text: "Hello world", voice: "bm_george", speed: 0.95 },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "Kokoro TTS is not available." });
  });
});

describe("DELETE /api/custom-problems/:jobId", () => {
  const cancelJob = (jobId: string, headers: Record<string, string>) => app.inject({ method: "DELETE", url: `/api/custom-problems/${jobId}`, headers });

  it("cancels a running custom problem job with valid CSRF headers", async () => {
    const { jobId } = stack.manager.startCustomProblemJob("Design a cache", "hld");
    const res = await cancelJob(jobId, GOOD);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: jobId, stage: "cancelled" });
    expect(stack.manager.getCustomProblemJob(jobId)?.stage).toBe("cancelled");
  });

  it("refuses cancellation with 403 on missing or invalid CSRF", async () => {
    const { jobId } = stack.manager.startCustomProblemJob("Design a queue", "hld");

    const noCsrf = await cancelJob(jobId, { host: HOST, origin: `http://${HOST}` });
    expect(noCsrf.statusCode).toBe(403);

    const badCsrf = await cancelJob(jobId, { host: HOST, origin: `http://${HOST}`, "x-csrf-token": newCsrfToken() });
    expect(badCsrf.statusCode).toBe(403);

    const foreignOrigin = await cancelJob(jobId, { host: HOST, origin: "http://attacker.example", "x-csrf-token": TOKEN });
    expect(foreignOrigin.statusCode).toBe(403);

    expect(stack.manager.getCustomProblemJob(jobId)?.stage).not.toBe("cancelled");
    stack.manager.cancelCustomProblemJob(jobId);
  });

  it("refuses foreign Host with 421", async () => {
    const res = await cancelJob("nonexistent-job", { ...GOOD, host: "attacker.example" });
    expect(res.statusCode).toBe(421);
  });

  it("returns 404 for unknown job id", async () => {
    const res = await cancelJob("00000000-0000-0000-0000-000000000000", GOOD);
    expect(res.statusCode).toBe(404);
  });
});

describe("Usage routes", () => {
  it("GET /api/usage answers with totals and breakdowns", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/usage",
      headers: { host: HOST },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals).toBeDefined();
    expect(Array.isArray(body.bySession)).toBe(true);
    expect(Array.isArray(body.byProblem)).toBe(true);
    expect(Array.isArray(body.byRole)).toBe(true);
    expect(Array.isArray(body.byModel)).toBe(true);
    expect(Array.isArray(body.byDay)).toBe(true);
  });

  it("GET /api/sessions/:id/usage answers 404 on malformed id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/sessions/bad-id/usage",
      headers: { host: HOST },
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /api/sessions/:id/usage answers with session usage for well-formed id", async () => {
    const id = await start();
    const res = await app.inject({
      method: "GET",
      url: `/api/sessions/${id}/usage`,
      headers: { host: HOST },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessionId).toBe(id);
    expect(body.hasData).toBe(false);
  });
});

describe("GET /api/bootstrap setup field", () => {
  const checks = [{ id: "compiler" as const, ok: false, optional: false, title: "C++ compiler", detail: "missing", fix: "xcode-select --install" }];

  it("is an empty list when no checks are wired", async () => {
    const res = await app.inject({ method: "GET", url: "/api/bootstrap", headers: { host: HOST } });
    expect(res.json().setup).toEqual([]);
  });

  it("carries the cached check results", async () => {
    const withSetup = await buildApp({
      config: stack.config,
      csrfToken: TOKEN,
      manager: stack.manager,
      settings: stack.settings,
      store: stack.store,
      log: stack.log,
      setupStatus: new SetupStatus(async () => checks),
    });
    await withSetup.ready();
    const res = await withSetup.inject({ method: "GET", url: "/api/bootstrap", headers: { host: HOST } });
    await withSetup.close();
    expect(res.json().setup).toEqual(checks);
  });
});
