import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PORT, makeStack, type Stack } from "../engine/__fixtures__/stack";
import { LeetcodeError } from "../leetcode/client";
import { LeetcodeService } from "../leetcode/service";
import { EASY, at, fakeClient, solve } from "../leetcode/support";
import type { LeetcodeClient } from "../leetcode/client";
import { DEFAULT_SETTINGS } from "../../shared/types";
import { localDay } from "../../shared/week";
import { buildApp } from "./app";
import { newCsrfToken } from "./security";

const TOKEN = newCsrfToken();
const HOST = `127.0.0.1:${PORT}`;
const GOOD = { host: HOST, origin: `http://${HOST}`, "x-csrf-token": TOKEN };

let stack: Stack;
let app: FastifyInstance;

async function start(client: LeetcodeClient, withService = true) {
  const leetcode = new LeetcodeService({ client, settings: stack.settings, filePath: `${stack.data}/leetcode.json`, log: stack.log });
  app = await buildApp({
    config: stack.config,
    csrfToken: TOKEN,
    manager: stack.manager,
    settings: stack.settings,
    store: stack.store,
    log: stack.log,
    ...(withService ? { leetcode } : {}),
  });
  await app.ready();
}

const name = (leetcodeUsername?: string) => stack.settings.save({ ...DEFAULT_SETTINGS, ...(leetcodeUsername ? { leetcodeUsername, dsaCountFrom: "2020-01-01" } : {}) });
const get = () => app.inject({ method: "GET", url: "/api/dsa", headers: { host: HOST } });

beforeEach(async () => {
  stack = await makeStack();
});
afterEach(async () => {
  await app.close();
  await stack.cleanup();
});

describe("GET /api/dsa", () => {
  it("returns no_username before a name is saved", async () => {
    await start(fakeClient());
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "no_username", username: null, fetchedAt: null, pass: { solved: 0 }, recent: [], weeklyGoal: 3 });
  });

  it("returns ok with the pass, the week and the recent solves", async () => {
    await name("example_user");
    const recent = [solve("two-sum", at(2020, 1, 2)), solve("lru-cache", at(2020, 1, 3))];
    await start(fakeClient({ recent: async () => recent, problem: async () => EASY }));
    const body = (await get()).json();
    expect(body).toMatchObject({ status: "ok", username: "example_user", countFrom: "2020-01-01", pass: { solved: 2, easy: 2 }, lifetimeSolved: 100 });
    expect(body.recent).toHaveLength(2);
    expect(body.topics).toEqual([{ name: "Array", slug: "array", solved: 2 }]);
    expect(body.week.perDay).toHaveLength(7);
    expect(typeof body.fetchedAt).toBe("string");
  });

  it("returns not_found for an unknown name", async () => {
    await name("example_user");
    await start(fakeClient({ profile: async () => ({ found: false }) }));
    expect((await get()).json()).toMatchObject({ status: "not_found", username: "example_user" });
  });

  it("returns stale with the last numbers when a later read fails", async () => {
    await name("example_user");
    let fail = false;
    let clock = Date.now();
    const client = fakeClient({
      recent: async () => [solve("two-sum", at(2020, 1, 2))],
      profile: async () => (fail ? Promise.reject(new LeetcodeError("down")) : { found: true, profile: { totals: { all: 1, easy: 1, medium: 0, hard: 0 } } }),
    });
    const leetcode = new LeetcodeService({ client, settings: stack.settings, filePath: `${stack.data}/leetcode.json`, log: stack.log, now: () => clock });
    app = await buildApp({ config: stack.config, csrfToken: TOKEN, manager: stack.manager, settings: stack.settings, store: stack.store, log: stack.log, leetcode });
    await app.ready();
    const ok = (await get()).json();
    fail = true;
    clock += 3_600_000;
    const stale = (await get()).json();
    expect(stale).toMatchObject({ status: "stale", fetchedAt: ok.fetchedAt, pass: { solved: 1 } });
  });

  it("returns error when the read fails and nothing was saved", async () => {
    await name("example_user");
    await start(fakeClient({ profile: async () => Promise.reject(new LeetcodeError("down")) }));
    expect((await get()).json()).toMatchObject({ status: "error", fetchedAt: null });
  });

  it("answers 503 when the feature is not wired", async () => {
    await start(fakeClient(), false);
    expect((await get()).statusCode).toBe(503);
  });
});

describe("POST /api/dsa/refresh", () => {
  it("needs the origin and the CSRF token", async () => {
    await name("example_user");
    const client = fakeClient();
    await start(client);
    expect((await app.inject({ method: "POST", url: "/api/dsa/refresh", headers: { host: HOST } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/dsa/refresh", headers: { ...GOOD, "x-csrf-token": "wrong" } })).statusCode).toBe(403);
    expect(client.calls.profile).toBe(0);
  });

  it("returns the same shape and still respects the minimum interval", async () => {
    await name("example_user");
    const client = fakeClient();
    await start(client);
    await get();
    const res = await app.inject({ method: "POST", url: "/api/dsa/refresh", headers: GOOD });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
    expect(client.calls.profile).toBe(1);
  });
});

describe("PUT /api/settings and the count-from day", () => {
  const put = (body: unknown) => app.inject({ method: "PUT", url: "/api/settings", headers: GOOD, payload: body as object });

  it("sets today when a username is first saved", async () => {
    await start(fakeClient());
    const res = await put({ ...DEFAULT_SETTINGS, leetcodeUsername: "example_user" });
    expect(res.json().dsaCountFrom).toBe(localDay(new Date()));
  });

  it("keeps a day the person chose and refuses a future or false one", async () => {
    await start(fakeClient());
    expect((await put({ ...DEFAULT_SETTINGS, leetcodeUsername: "example_user", dsaCountFrom: "2026-01-02" })).json().dsaCountFrom).toBe("2026-01-02");
    expect((await put({ ...DEFAULT_SETTINGS, leetcodeUsername: "example_user", dsaCountFrom: "2999-01-01" })).statusCode).toBe(400);
    expect((await put({ ...DEFAULT_SETTINGS, leetcodeUsername: "example_user", dsaCountFrom: "2026-02-30" })).statusCode).toBe(400);
  });

  it("adds no day without a username", async () => {
    await start(fakeClient());
    expect((await put(DEFAULT_SETTINGS)).json().dsaCountFrom).toBeUndefined();
  });
});
