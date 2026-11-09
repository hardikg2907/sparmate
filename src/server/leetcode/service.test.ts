import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "../../shared/types";
import { memoryLogger } from "../engine/log";
import { LeetcodeError } from "./client";
import { LeetcodeService } from "./service";
import { saveSnapshot } from "./snapshot";
import { EASY, HARD, MEDIUM, at, fakeClient, solve } from "./support";

const MIN = 60_000;
let dir: string;
let file: string;
let clock: number;
let settings: Settings;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "leetcode-service-"));
  file = join(dir, "leetcode.json");
  // Wednesday 4 November 2026, 10:00 local.
  clock = new Date(2026, 10, 4, 10, 0).getTime();
  settings = { ...DEFAULT_SETTINGS, leetcodeUsername: "example_user", dsaCountFrom: "2026-11-01", dsaWeeklyGoal: 3 };
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const make = (client = fakeClient()) => ({
  client,
  log: memoryLogger(),
  service: new LeetcodeService({ client, settings: { get: () => settings }, filePath: file, log: memoryLogger(), now: () => clock }),
});

const ledgerClient = () =>
  fakeClient({
    recent: async () => [solve("two-sum", at(2026, 11, 2)), solve("merge-intervals", at(2026, 11, 3)), solve("trapping-rain-water", at(2026, 11, 4, 9))],
    problem: async (slug) => (slug === "two-sum" ? EASY : slug === "merge-intervals" ? MEDIUM : HARD),
  });

describe("status", () => {
  it("answers no_username without calling LeetCode", async () => {
    delete settings.leetcodeUsername;
    const { service, client } = make();
    const res = await service.get();
    expect(res).toMatchObject({ status: "no_username", username: null, weeklyGoal: 3 });
    expect(client.calls.profile).toBe(0);
  });

  it("answers not_found when the name has no public profile", async () => {
    const { service } = make(fakeClient({ profile: async () => ({ found: false }) }));
    const res = await service.get();
    expect(res).toMatchObject({ status: "not_found", username: "example_user", fetchedAt: null, topics: [], recent: [] });
  });

  it("answers error when the first read fails and nothing was saved", async () => {
    const { service } = make(fakeClient({ profile: async () => Promise.reject(new LeetcodeError("down")) }));
    expect(await service.get()).toMatchObject({ status: "error", fetchedAt: null, pass: { solved: 0 } });
  });

  it("builds the pass from the ledger and the saved problem details", async () => {
    const { service } = make(ledgerClient());
    const res = await service.get();
    expect(res.status).toBe("ok");
    expect(res.countFrom).toBe("2026-11-01");
    expect(res.pass).toEqual({ solved: 3, easy: 1, medium: 1, hard: 1, unread: 0 });
    expect(res.topics.map((t) => [t.slug, t.solved])).toEqual([
      ["array", 2],
      ["graph", 1],
      ["heap-priority-queue", 1],
    ]);
    expect(res.week).toEqual({ solved: 3, mediums: 1, perDay: [1, 1, 1, 0, 0, 0, 0], mediumsPerDay: expect.any(Array) });
    expect(res.recent.map((r) => r.slug)).toEqual(["trapping-rain-water", "merge-intervals", "two-sum"]);
    expect(res.lifetimeSolved).toBe(100);
    expect(res.fetchedAt).toBe(new Date(clock).toISOString());
  });
});

describe("refresh interval and in-flight reads", () => {
  it("reads once for many page loads inside the minimum interval, and again after it", async () => {
    const { service, client } = make();
    await service.get();
    clock += 14 * MIN;
    await service.get();
    await service.get({ force: true });
    expect(client.calls.profile).toBe(1);
    clock += 2 * MIN;
    await service.get();
    expect(client.calls.profile).toBe(2);
  });

  it("shares one read between requests that arrive together", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const client = fakeClient();
    const slow = fakeClient({
      profile: async () => {
        client.calls.profile += 1;
        await gate;
        return { found: true, profile: { totals: { all: 1, easy: 1, medium: 0, hard: 0 } } };
      },
    });
    const { service } = make(slow);
    const a = service.get();
    const b = service.get({ force: true });
    const c = service.get();
    release();
    await Promise.all([a, b, c]);
    expect(client.calls.profile).toBe(1);
  });

  it("treats a saved read from a minute ago as fresh after a restart", async () => {
    await saveSnapshot(file, {
      version: 1,
      problems: {},
      lastFailure: null,
      account: { username: "example_user", fetchedAt: new Date(clock - MIN).toISOString(), lifetime: { all: 7, easy: 7, medium: 0, hard: 0 }, entries: [] },
    });
    const { service, client } = make();
    const res = await service.get();
    expect(client.calls.profile).toBe(0);
    expect(res).toMatchObject({ status: "ok", lifetimeSolved: 7 });
  });

  it("waits longer after a failure for a page load than for a read-again", async () => {
    let fail = true;
    const { service, client } = make(
      fakeClient({ profile: async () => (fail ? Promise.reject(new LeetcodeError("down")) : { found: true, profile: { totals: { all: 1, easy: 1, medium: 0, hard: 0 } } }) }),
    );
    await service.get();
    clock += 20_000;
    await service.get();
    expect(client.calls.profile).toBe(0);
    fail = false;
    expect((await service.get({ force: true })).status).toBe("ok");
  });
});

describe("stale fallback", () => {
  it("keeps the last good numbers with their date when a later read fails", async () => {
    let fail = false;
    const base = ledgerClient();
    const { service } = make(
      fakeClient({
        ...base,
        profile: async () => (fail ? Promise.reject(new LeetcodeError("down")) : { found: true, profile: { totals: { all: 100, easy: 1, medium: 1, hard: 1 } } }),
      }),
    );
    const first = await service.get();
    fail = true;
    clock += 20 * MIN;
    const second = await service.get();
    expect(second.status).toBe("stale");
    expect(second.fetchedAt).toBe(first.fetchedAt);
    expect(second.pass).toEqual(first.pass);
  });

  it("falls back to the file saved by an earlier run", async () => {
    const first = make(ledgerClient());
    await first.service.get();
    clock += 30 * MIN;
    const { service } = make(fakeClient({ profile: async () => Promise.reject(new LeetcodeError("down")) }));
    const res = await service.get();
    expect(res.status).toBe("stale");
    expect(res.pass.solved).toBe(3);
  });

  it("ignores saved numbers that belong to another username", async () => {
    const first = make(ledgerClient());
    await first.service.get();
    settings = { ...settings, leetcodeUsername: "someone_else" };
    clock += 30 * MIN;
    const { service } = make(fakeClient({ profile: async () => Promise.reject(new LeetcodeError("down")) }));
    expect(await service.get()).toMatchObject({ status: "error", username: "someone_else", pass: { solved: 0 } });
  });
});

describe("ledger across reads", () => {
  it("adds new solves, keeps old ones and does not double count", async () => {
    let list = [solve("two-sum", at(2026, 11, 2))];
    const client = fakeClient({ recent: async () => list, problem: async () => EASY });
    const { service } = make(client);
    await service.get();
    list = [solve("two-sum", at(2026, 11, 2)), solve("two-sum", at(2026, 11, 3)), solve("valid-parentheses", at(2026, 11, 3, 15))];
    clock += 20 * MIN;
    const res = await service.get();
    expect(res.pass.solved).toBe(2);
    list = [solve("valid-parentheses", at(2026, 11, 3, 15))];
    clock += 20 * MIN;
    expect((await service.get()).pass.solved).toBe(2);
  });

  it("looks up each problem once and keeps the answer in the file", async () => {
    const client = ledgerClient();
    let lookups = 0;
    const counted = fakeClient({ ...client, problem: async (slug) => (lookups++, client.problem(slug)) });
    const { service } = make(counted);
    await service.get();
    expect(lookups).toBe(3);
    clock += 20 * MIN;
    await service.get();
    expect(lookups).toBe(3);
    const saved = JSON.parse(await readFile(file, "utf8")) as { problems: Record<string, unknown> };
    expect(Object.keys(saved.problems).sort()).toEqual(["merge-intervals", "trapping-rain-water", "two-sum"]);
  });

  it("leaves a problem it could not read out of the topic counts and retries it later", async () => {
    let broken = true;
    const base = ledgerClient();
    const client = fakeClient({ ...base, problem: async (slug) => (broken && slug === "two-sum" ? Promise.reject(new LeetcodeError("down")) : base.problem(slug)) });
    const { service } = make(client);
    const first = await service.get();
    expect(first.pass).toEqual({ solved: 3, easy: 0, medium: 1, hard: 1, unread: 1 });
    expect(first.recent.find((r) => r.slug === "two-sum")?.difficulty).toBeNull();
    broken = false;
    clock += 20 * MIN;
    expect((await service.get()).pass.easy).toBe(1);
  });

  it("looks up at most twenty problems in one read", async () => {
    const entries = Array.from({ length: 30 }, (_, i) => solve(`problem-${i}`, at(2026, 11, 3) + i));
    const client = fakeClient({ recent: async () => entries });
    const { service } = make(client);
    await service.get();
    expect(client.calls.problem).toBe(20);
  });

  it("drops solves from before the count-from day when it moves later", async () => {
    const { service } = make(ledgerClient());
    await service.get();
    settings = { ...settings, dsaCountFrom: "2026-11-04" };
    const res = await service.get();
    expect(res.pass.solved).toBe(1);
    expect(res.countFrom).toBe("2026-11-04");
  });

  it("starts counting today when no day is set", async () => {
    delete settings.dsaCountFrom;
    const { service } = make(ledgerClient());
    const res = await service.get();
    expect(res.countFrom).toBe("2026-11-04");
    expect(res.pass.solved).toBe(1);
  });

  it("rewrites a corrupt file on the next good read", async () => {
    await writeFile(file, "garbage");
    const { service } = make(ledgerClient());
    await service.get();
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ version: 1 });
  });
});

describe("moving the count-from day", () => {
  it("keeps every solve when the day moves later and then earlier again", async () => {
    const { service } = make(ledgerClient());
    await service.get();
    settings = { ...settings, dsaCountFrom: "2026-11-04" };
    expect((await service.get()).pass.solved).toBe(1);
    settings = { ...settings, dsaCountFrom: "2026-11-01" };
    clock += 20 * MIN;
    const back = await service.get();
    expect(back.pass.solved).toBe(3);
    expect(back.topics.length).toBeGreaterThan(0);
  });

  it("keeps old solves in the file after a read made with a later day", async () => {
    settings = { ...settings, dsaCountFrom: "2026-11-04" };
    const { service } = make(ledgerClient());
    await service.get();
    const saved = JSON.parse(await readFile(file, "utf8")) as { account: { entries: unknown[] } };
    expect(saved.account.entries).toHaveLength(3);
  });
});

describe("a problem LeetCode returns nothing for", () => {
  it("is remembered as missing, asked for once, and counted as not read", async () => {
    let asked = 0;
    const client = fakeClient({
      recent: async () => [solve("two-sum", at(2026, 11, 2)), solve("removed-problem", at(2026, 11, 3))],
      problem: async (slug) => (asked++, slug === "removed-problem" ? null : EASY),
    });
    const { service } = make(client);
    const first = await service.get();
    expect(first.pass).toEqual({ solved: 2, easy: 1, medium: 0, hard: 0, unread: 1 });
    clock += 20 * MIN;
    await service.get();
    expect(asked).toBe(2);
    const saved = JSON.parse(await readFile(file, "utf8")) as { problems: Record<string, unknown> };
    expect(saved.problems["removed-problem"]).toEqual({ missing: true });
  });
});

describe("a name that stops resolving", () => {
  it("shows the saved numbers as stale, not a blank not-found page", async () => {
    let found = true;
    const base = ledgerClient();
    const { service } = make(
      fakeClient({ ...base, profile: async () => (found ? { found: true, profile: { totals: { all: 5, easy: 5, medium: 0, hard: 0 } } } : { found: false }) }),
    );
    const first = await service.get();
    found = false;
    clock += 20 * MIN;
    const res = await service.get();
    expect(res.status).toBe("stale");
    expect(res.failure?.reason).toBe("not_found");
    expect(res.pass).toEqual(first.pass);
    expect(res.fetchedAt).toBe(first.fetchedAt);
  });

  it("still says not_found for a name that never resolved, with the reason", async () => {
    const { service } = make(fakeClient({ profile: async () => ({ found: false }) }));
    const res = await service.get();
    expect(res).toMatchObject({ status: "not_found", failure: { reason: "not_found" } });
  });
});

describe("failures", () => {
  const failing = (reason: LeetcodeError["reason"]) => fakeClient({ profile: async () => Promise.reject(new LeetcodeError("down", reason)) });

  it.each(["timeout", "unreachable", "unexpected_reply", "busy"] as const)("reports %s as the reason the last read failed", async (reason) => {
    const { service } = make(failing(reason));
    expect((await service.get()).failure?.reason).toBe(reason);
  });

  it("remembers the failure across a restart and keeps waiting", async () => {
    let down = false;
    const base = ledgerClient();
    const first = make(fakeClient({ ...base, profile: async () => (down ? Promise.reject(new LeetcodeError("down", "timeout")) : base.profile("example_user")) }));
    await first.service.get();
    clock += 20 * MIN;
    down = true;
    const failed = await first.service.get();
    expect(failed).toMatchObject({ status: "stale", failure: { reason: "timeout" } });
    clock += 1_000;
    const restarted = make(fakeClient());
    const res = await restarted.service.get();
    expect(restarted.client.calls.profile).toBe(0);
    expect(res).toMatchObject({ status: "stale", failure: { reason: "timeout" } });
  });

  it("clears the failure after a good read", async () => {
    let fail = true;
    const { service } = make(
      fakeClient({ profile: async () => (fail ? Promise.reject(new LeetcodeError("x", "busy")) : { found: true, profile: { totals: { all: 1, easy: 1, medium: 0, hard: 0 } } }) }),
    );
    await service.get();
    fail = false;
    clock += 20_000;
    expect((await service.get({ force: true })).failure).toBeNull();
  });

  it("tells when a read-again is allowed", async () => {
    const { service } = make(failing("busy"));
    const res = await service.get();
    expect(res.nextReadAt).toBe(new Date(clock + 15_000).toISOString());
    clock += 16_000;
    expect((await service.get({ force: true })).failure).not.toBeNull();
  });

  it("tells when the next read of a good profile is allowed", async () => {
    const { service } = make();
    const fresh = await service.get();
    expect(fresh.nextReadAt).toBe(new Date(clock + 15 * MIN).toISOString());
  });
});
