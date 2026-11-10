import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { estimateCostUsd } from "./usage-capture";
import { calcCacheHitRate, isDrillRecord, parseUsageRecord, UsageLedger, type UsageRecord } from "./usage-ledger";

describe("calcCacheHitRate", () => {
  it("computes cache read / (input + cache read + cache creation)", () => {
    // 500 / (1000 + 500 + 500) = 500 / 2000 = 0.25
    expect(calcCacheHitRate(1000, 500, 500)).toBe(0.25);
  });

  it("returns 0 when total tokens are 0 to avoid division by zero", () => {
    expect(calcCacheHitRate(0, 0, 0)).toBe(0);
  });
});

describe("parseUsageRecord", () => {
  it("parses valid JSON line with full fields", () => {
    const raw = JSON.stringify({
      time: "2026-10-31T12:00:00.000Z",
      sessionId: "s1",
      problemId: "p1",
      track: "hld",
      mode: "interview",
      role: "interviewer",
      model: "claude-opus-5-5",
      effort: "high",
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 300,
      cacheCreationTokens: 400,
      costUsd: 0.015,
      durationMs: 800,
    });
    const rec = parseUsageRecord(raw);
    expect(rec).not.toBeNull();
    expect(rec?.sessionId).toBe("s1");
    expect(rec?.costUsd).toBe(0.015);
    expect(rec?.inputTokens).toBe(1000);
  });

  it("accepts alternative cost and duration field names (cost, duration)", () => {
    const raw = JSON.stringify({
      time: "2026-10-31T12:00:00.000Z",
      sessionId: null,
      problemId: "p1",
      role: "brief-writer",
      model: "claude-opus-5-5",
      effort: "medium",
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 0,
      cacheCreationTokens: 500,
      cost: 0.02,
      duration: 1200,
    });
    const rec = parseUsageRecord(raw);
    expect(rec).not.toBeNull();
    expect(rec?.sessionId).toBeNull();
    expect(rec?.costUsd).toBe(0.02);
    expect(rec?.durationMs).toBe(1200);
  });

  describe("drill fields", () => {
    const line = (extra: Record<string, unknown>) => JSON.stringify({ time: "2026-11-01T10:00:00.000Z", role: "grader", model: "claude-sonnet-5-5", ...extra });

    it("reads a valid attempt id and drill kind", () => {
      const rec = parseUsageRecord(line({ drillAttemptId: "0123456789abcdef", drillKind: "deep_dive" }));
      expect(rec?.drillAttemptId).toBe("0123456789abcdef");
      expect(rec?.drillKind).toBe("deep_dive");
    });

    it("reads null for rows that have neither field", () => {
      const rec = parseUsageRecord(line({}));
      expect(rec?.drillAttemptId).toBeNull();
      expect(rec?.drillKind).toBeNull();
    });

    it.each([
      ["wrong length", "0123456789abcde"],
      ["upper case", "0123456789ABCDEF"],
      ["path characters", "../../etc/passwd"],
      ["not a string", 1234567890123456],
      ["trailing newline", "0123456789abcdef\n"],
    ])("drops an attempt id with %s", (_name, value) => {
      expect(parseUsageRecord(line({ drillAttemptId: value }))?.drillAttemptId).toBeNull();
    });

    it.each([
      ["empty", ""],
      ["upper case", "Capacity"],
      ["markup", "<b>x</b>"],
      ["too long", "a".repeat(41)],
      ["digits", "walk2"],
      ["not a string", 5],
    ])("drops a drill kind that is %s", (_name, value) => {
      expect(parseUsageRecord(line({ drillKind: value }))?.drillKind).toBeNull();
    });

    it("treats a grader row without an attempt id, and any row with one, as a drill record", () => {
      expect(isDrillRecord({ role: "grader", drillAttemptId: null })).toBe(true);
      expect(isDrillRecord({ role: "judge", drillAttemptId: "0123456789abcdef" })).toBe(true);
      expect(isDrillRecord({ role: "judge", drillAttemptId: null })).toBe(false);
    });
  });

  it("returns null for non-JSON lines or empty lines", () => {
    expect(parseUsageRecord("")).toBeNull();
    expect(parseUsageRecord("   \n ")).toBeNull();
    expect(parseUsageRecord("corrupted-not-json {[[")).toBeNull();
  });

  it("returns null for lines missing mandatory fields (time, role, model)", () => {
    expect(parseUsageRecord(JSON.stringify({ time: "2026-01-01" }))).toBeNull();
    expect(parseUsageRecord(JSON.stringify({ role: "judge", model: "m1" }))).toBeNull();
  });
});

describe("UsageLedger file operations and aggregations", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ir-ledger-test-"));
    filePath = join(tmpDir, "usage.jsonl");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("handles empty ledger file or non-existent file cleanly", async () => {
    const ledger = new UsageLedger({ filePath });
    const summary = await ledger.summary();

    expect(summary.trackingSince).toBeNull();
    expect(summary.totals).toEqual({
      cost: 0,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      cacheHitRate: 0,
      calls: 0,
      failedCalls: 0,
      estimatedCalls: 0,
      rounds: 0,
      drillCost: 0,
    });
    expect(summary.bySession).toEqual([]);
    expect(summary.byProblem).toEqual([]);
    expect(summary.byRole).toEqual([]);
    expect(summary.byModel).toEqual([]);
    expect(summary.byDay.length).toBe(30);

    const sessionUsage = await ledger.sessionSummary("non-existent");
    expect(sessionUsage.hasData).toBe(false);
    expect(sessionUsage.totals).toBeNull();
    expect(sessionUsage.byRole).toEqual([]);
  });

  it("appends records asynchronously and tolerates corrupt lines on read", async () => {
    const ledger = new UsageLedger({ filePath });
    const r1: UsageRecord = {
      time: "2026-10-30T10:00:00.000Z",
      sessionId: "sess-1",
      problemId: "c2-url-shortener",
      track: "hld",
      mode: "interview",
      drillAttemptId: null,
      drillKind: null,
      role: "interviewer",
      model: "claude-opus-5-5",
      effort: "low",
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 1000,
      cacheCreationTokens: 500,
      cost: 0.01,
      costUsd: 0.01,
      duration: 1000,
      durationMs: 1000,
    };
    ledger.record(r1);

    // Wait for async write to flush.
    await new Promise((r) => setTimeout(r, 60));

    // Manually inject bad lines into the file:
    const content = await readFile(filePath, "utf8");
    const corrupted = content + '\nnot-valid-json\n{"missing":"fields"}\n\n';
    await writeFile(filePath, corrupted, "utf8");

    const r2: UsageRecord = {
      time: "2026-10-31T11:00:00.000Z",
      sessionId: "sess-1",
      problemId: "c2-url-shortener",
      track: "hld",
      mode: "interview",
      drillAttemptId: null,
      drillKind: null,
      role: "judge",
      model: "claude-opus-5-5",
      effort: "high",
      inputTokens: 3000,
      outputTokens: 800,
      cacheReadTokens: 2000,
      cacheCreationTokens: 1000,
      cost: 0.02,
      costUsd: 0.02,
      duration: 3000,
      durationMs: 3000,
    };
    ledger.record(r2);
    await new Promise((r) => setTimeout(r, 60));

    const all = await ledger.readAll();
    expect(all.length).toBe(2);
    expect(all[0]?.role).toBe("interviewer");
    expect(all[1]?.role).toBe("judge");
  });

  it("computes accurate totals and breakdowns across multiple sessions and roles", async () => {
    const ledger = new UsageLedger({ filePath });

    // Session 1: 2 calls (interviewer + judge)
    ledger.record({
      time: "2026-10-25T10:00:00.000Z",
      sessionId: "s1",
      problemId: "prob-a",
      track: "hld",
      mode: "interview",
      drillAttemptId: null,
      drillKind: null,
      role: "interviewer",
      model: "model-x",
      effort: "low",
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 500,
      cacheCreationTokens: 500,
      cost: 0.01,
      costUsd: 0.01,
      duration: 1000,
      durationMs: 1000,
    });

    ledger.record({
      time: "2026-10-25T10:30:00.000Z",
      sessionId: "s1",
      problemId: "prob-a",
      track: "hld",
      mode: "interview",
      drillAttemptId: null,
      drillKind: null,
      role: "judge",
      model: "model-x",
      effort: "high",
      inputTokens: 2000,
      outputTokens: 800,
      cacheReadTokens: 1500,
      cacheCreationTokens: 500,
      cost: 0.03,
      costUsd: 0.03,
      duration: 2000,
      durationMs: 2000,
    });

    // Session 2: 1 call (interviewer on prob-b)
    ledger.record({
      time: "2026-10-26T14:00:00.000Z",
      sessionId: "s2",
      problemId: "prob-b",
      track: "lld",
      mode: "guided",
      drillAttemptId: null,
      drillKind: null,
      role: "interviewer",
      model: "model-y",
      effort: "medium",
      inputTokens: 500,
      outputTokens: 100,
      cacheReadTokens: 200,
      cacheCreationTokens: 300,
      cost: 0.005,
      costUsd: 0.005,
      duration: 500,
      durationMs: 500,
    });

    // Outside round call (brief-writer): sessionId is null
    ledger.record({
      time: "2026-10-27T16:00:00.000Z",
      sessionId: null,
      problemId: "prob-b",
      track: "lld",
      mode: "interview",
      drillAttemptId: null,
      drillKind: null,
      role: "brief-writer",
      model: "model-x",
      effort: "high",
      inputTokens: 2500,
      outputTokens: 1000,
      cacheReadTokens: 1000,
      cacheCreationTokens: 1500,
      cost: 0.025,
      costUsd: 0.025,
      duration: 2500,
      durationMs: 2500,
    });

    await new Promise((r) => setTimeout(r, 80));

    const summary = await ledger.summary();

    expect(summary.trackingSince).toBe("2026-10-25T10:00:00.000Z");
    expect(summary.totals.calls).toBe(4);
    expect(summary.totals.rounds).toBe(2); // s1 and s2 (null sessionId not counted as round)
    expect(summary.totals.costUsd).toBeCloseTo(0.07);
    expect(summary.totals.inputTokens).toBe(6000);
    expect(summary.totals.outputTokens).toBe(2100);
    expect(summary.totals.cacheReadTokens).toBe(3200);
    expect(summary.totals.cacheCreationTokens).toBe(2800);

    // Total cache hit rate: 3200 / (6000 + 3200 + 2800) = 3200 / 12000 = 0.26666...
    expect(summary.totals.cacheHitRate).toBeCloseTo(3200 / 12000);

    // bySession
    expect(summary.bySession.length).toBe(2);
    const s1Summary = summary.bySession.find((s) => s.sessionId === "s1");
    expect(s1Summary).toBeDefined();
    expect(s1Summary?.calls).toBe(2);
    expect(s1Summary?.costUsd).toBeCloseTo(0.04);
    expect(s1Summary?.inputTokens).toBe(3000);
    expect(s1Summary?.cacheReadTokens).toBe(2000);

    // byProblem
    expect(summary.byProblem.length).toBe(2);
    const probA = summary.byProblem.find((p) => p.problemId === "prob-a");
    expect(probA?.calls).toBe(2);
    expect(probA?.rounds).toBe(1);
    expect(probA?.costUsd).toBeCloseTo(0.04);

    const probB = summary.byProblem.find((p) => p.problemId === "prob-b");
    expect(probB?.calls).toBe(2);
    expect(probB?.rounds).toBe(1);
    expect(probB?.costUsd).toBeCloseTo(0.03);

    // byRole
    expect(summary.byRole.length).toBe(3);
    const interviewerRole = summary.byRole.find((r) => r.role === "interviewer");
    expect(interviewerRole?.calls).toBe(2);
    expect(interviewerRole?.costUsd).toBeCloseTo(0.015);

    // byModel
    expect(summary.byModel.length).toBe(2);
    const modelX = summary.byModel.find((m) => m.model === "model-x");
    expect(modelX?.calls).toBe(3);
    expect(modelX?.costUsd).toBeCloseTo(0.065);

    // sessionSummary
    const s1Res = await ledger.sessionSummary("s1");
    expect(s1Res.hasData).toBe(true);
    expect(s1Res.totals?.calls).toBe(2);
    expect(s1Res.totals?.costUsd).toBeCloseTo(0.04);
    expect(s1Res.byRole.length).toBe(2);
  });
});

describe("UsageLedger cost honesty and local days", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ir-ledger-honest-"));
    filePath = join(tmpDir, "usage.jsonl");
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(tmpDir, { recursive: true, force: true });
  });

  const base = {
    sessionId: "s1",
    problemId: "p1",
    track: "hld" as const,
    mode: "guided" as const,
    drillAttemptId: null,
    drillKind: null,
    role: "guide",
    model: "claude-haiku-5-5",
    effort: "low",
    inputTokens: 2,
    outputTokens: 1000,
    cacheReadTokens: 10_000,
    cacheCreationTokens: 1000,
    cost: 0,
    costUsd: 0,
    duration: 1,
    durationMs: 1,
  };

  it("prices a legacy row that has tokens but cost 0 and marks it estimated", async () => {
    await writeFile(filePath, JSON.stringify({ ...base, time: "2026-11-06T10:00:00.000Z" }) + "\n", "utf8");
    const s = await new UsageLedger({ filePath }).summary();
    expect(s.totals.costUsd).toBeGreaterThan(0);
    expect(s.totals.estimatedCalls).toBe(1);
    expect(s.totals.failedCalls).toBe(0);
  });

  it("prices a legacy row at the dearest known model because its label cannot be trusted", async () => {
    await writeFile(filePath, JSON.stringify({ ...base, time: "2026-11-06T10:00:00.000Z" }) + "\n", "utf8");
    const [row] = await new UsageLedger({ filePath }).readAll();
    const opus = estimateCostUsd("claude-opus-5-5", row!);
    expect(row!.costUsd).toBeCloseTo(opus!);
    expect(row!.costUsd).toBeGreaterThan(estimateCostUsd("claude-haiku-5-5", row!)!);
  });

  it("counts failed calls in every total and keeps the breakdowns equal", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-07T10:00:00Z"));
    const ledger = new UsageLedger({ filePath });
    ledger.record({ ...base, time: "2026-11-07T01:00:00.000Z", cost: 0.5, costUsd: 0.5 });
    ledger.record({ ...base, role: "judge", model: "claude-sonnet-5-5", time: "2026-11-07T02:00:00.000Z", cost: 0.25, costUsd: 0.25, ok: false });
    const s = await ledger.summary({ timeZone: "UTC" });
    expect(s.totals.calls).toBe(2);
    expect(s.totals.failedCalls).toBe(1);
    const sum = (xs: { costUsd: number }[]) => xs.reduce((t, x) => t + x.costUsd, 0);
    expect(sum(s.byRole)).toBeCloseTo(s.totals.costUsd);
    expect(sum(s.byModel)).toBeCloseTo(s.totals.costUsd);
    expect(sum(s.byDay)).toBeCloseTo(s.totals.costUsd);
  });

  it("puts a call at 2026-11-06T20:00Z on 2026-11-07 in Asia/Kolkata", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-07T10:00:00Z"));
    const ledger = new UsageLedger({ filePath });
    ledger.record({ ...base, time: "2026-11-06T20:00:00.000Z", cost: 1, costUsd: 1 });
    const s = await ledger.summary({ timeZone: "Asia/Kolkata" });
    expect(s.byDay.at(-1)?.date).toBe("2026-11-07");
    expect(s.byDay.at(-1)?.calls).toBe(1);
    expect(s.byDay.at(-2)?.calls).toBe(0);
    expect(s.byDay.reduce((t, d) => t + d.calls, 0)).toBe(1);
  });
});

describe("UsageLedger drill cost", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ir-ledger-drills-"));
    filePath = join(tmpDir, "usage.jsonl");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const row = (over: Partial<UsageRecord>): UsageRecord => ({
    time: "2026-11-07T01:00:00.000Z",
    sessionId: null,
    problemId: "p1",
    track: "hld",
    mode: null,
    drillAttemptId: null,
    drillKind: null,
    role: "grader",
    model: "claude-sonnet-5-5",
    effort: "low",
    inputTokens: 10,
    outputTokens: 10,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cost: 0.1,
    costUsd: 0.1,
    duration: 100,
    durationMs: 100,
    ok: true,
    ...over,
  });

  const A1 = "aaaaaaaaaaaaaaaa";
  const A2 = "bbbbbbbbbbbbbbbb";

  async function ledgerWith(rows: UsageRecord[]): Promise<UsageLedger> {
    const ledger = new UsageLedger({ filePath });
    for (const r of rows) ledger.record(r);
    await ledger.flush();
    return ledger;
  }

  it("splits a problem's cost into rounds and drills without touching the rounds count", async () => {
    const ledger = await ledgerWith([
      row({ sessionId: "s1", role: "interviewer", cost: 1, costUsd: 1 }),
      row({ sessionId: "s1", role: "judge", cost: 2, costUsd: 2 }),
      row({ drillAttemptId: A1, drillKind: "capacity", cost: 0.25, costUsd: 0.25 }),
      row({ cost: 0.5, costUsd: 0.5 }),
    ]);
    const s = await ledger.summary({ timeZone: "UTC" });
    const p = s.byProblem[0]!;
    expect(p.roundCost).toBeCloseTo(3);
    expect(p.drillCost).toBeCloseTo(0.75);
    expect(p.roundCost + p.drillCost).toBeCloseTo(p.costUsd);
    expect(p.rounds).toBe(1);
    expect(s.totals.rounds).toBe(1);
    expect(s.totals.drillCost).toBeCloseTo(0.75);
    expect(s.totals.costUsd).toBeCloseTo(3.75);
  });

  it("totals drills, groups by kind and keeps old grader rows apart as earlier", async () => {
    const ledger = await ledgerWith([
      row({ sessionId: "s1", role: "judge", cost: 5, costUsd: 5 }),
      row({ drillAttemptId: A1, drillKind: "capacity", cost: 0.2, costUsd: 0.2 }),
      row({ drillAttemptId: A1, drillKind: "capacity", cost: 0.1, costUsd: 0.1, ok: false }),
      row({ drillAttemptId: A2, drillKind: "walk", cost: 0.05, costUsd: 0.05 }),
      row({ cost: 0.4, costUsd: 0.4 }),
    ]);
    const { drills } = await ledger.summary({ timeZone: "UTC" });
    expect(drills.cost).toBeCloseTo(0.75);
    expect(drills.calls).toBe(4);
    expect(drills.failedCalls).toBe(1);
    expect(drills.attempts).toBe(2);
    expect(drills.earlier.calls).toBe(1);
    expect(drills.earlier.cost).toBeCloseTo(0.4);
    expect(drills.byKind.map((k) => k.kind)).toEqual([null, "capacity", "walk"]);
    const capacity = drills.byKind.find((k) => k.kind === "capacity")!;
    expect(capacity).toMatchObject({ calls: 2, attempts: 1 });
    expect(capacity.cost).toBeCloseTo(0.3);
    expect(drills.byKind.find((k) => k.kind === null)).toMatchObject({ calls: 1, attempts: 0 });
  });

  it("lists attempts newest first with their own cost, calls and failures", async () => {
    const ledger = await ledgerWith([
      row({ drillAttemptId: A1, drillKind: "capacity", time: "2026-11-06T01:00:00.000Z", durationMs: 50, cost: 0.2, costUsd: 0.2 }),
      row({ drillAttemptId: A1, drillKind: "capacity", time: "2026-11-06T01:00:05.000Z", durationMs: 70, cost: 0.1, costUsd: 0.1, ok: false }),
      row({ drillAttemptId: A2, drillKind: "walk", time: "2026-11-07T01:00:00.000Z", cost: 0.05, costUsd: 0.05 }),
    ]);
    const { drills } = await ledger.summary({ timeZone: "UTC" });
    expect(drills.byAttempt.map((a) => a.attemptId)).toEqual([A2, A1]);
    const a1 = drills.byAttempt[1]!;
    expect(a1).toMatchObject({ kind: "capacity", problemId: "p1", problemTitle: "p1", calls: 2, failedCalls: 1, durationMs: 120 });
    expect(a1.cost).toBeCloseTo(0.3);
  });

  it("caps the attempt list at 200 and keeps the newest", async () => {
    const rows = Array.from({ length: 205 }, (_, i) =>
      row({ drillAttemptId: i.toString(16).padStart(16, "0"), drillKind: "walk", time: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString() }),
    );
    const { drills } = await (await ledgerWith(rows)).summary({ timeZone: "UTC" });
    expect(drills.attempts).toBe(205);
    expect(drills.byAttempt).toHaveLength(200);
    expect(drills.byAttempt[0]!.attemptId).toBe((204).toString(16).padStart(16, "0"));
  });

  it("counts only the rounds that are still saved, keeps a discarded round's cost, and says how many were discarded", async () => {
    const ledger = await ledgerWith([
      row({ sessionId: "kept", role: "interviewer", cost: 1, costUsd: 1 }),
      row({ sessionId: "gone", role: "interviewer", cost: 2, costUsd: 2 }),
      row({ sessionId: "gone2", role: "interviewer", cost: 4, costUsd: 4 }),
    ]);
    const s = await ledger.summary({ timeZone: "UTC", known: { rounds: new Set(["kept"]) } });
    expect(s.totals.rounds).toBe(1);
    expect(s.totals.discardedRounds).toBe(2);
    expect(s.totals.costUsd).toBeCloseTo(7);
    expect(s.byProblem[0]?.rounds).toBe(1);
    expect(
      s.bySession
        .filter((x) => x.discarded)
        .map((x) => x.sessionId)
        .sort(),
    ).toEqual(["gone", "gone2"]);
    expect(s.bySession.find((x) => x.sessionId === "kept")?.discarded).toBeUndefined();
  });

  it("counts every round as kept when it is not told which are saved", async () => {
    const ledger = await ledgerWith([row({ sessionId: "a", role: "judge" }), row({ sessionId: "b", role: "judge" })]);
    const s = await ledger.summary({ timeZone: "UTC" });
    expect(s.totals.rounds).toBe(2);
    expect(s.totals.discardedRounds).toBeUndefined();
  });

  it("gives custom question preparation its own row, so the rows add up to the total", async () => {
    const ledger = await ledgerWith([
      row({ sessionId: "s1", role: "interviewer", cost: 1, costUsd: 1 }),
      row({ problemId: null, track: "hld", role: "brief-writer", cost: 0.6, costUsd: 0.6 }),
      row({ problemId: null, track: "hld", role: "brief-checker", cost: 0.31, costUsd: 0.31 }),
      row({ problemId: null, role: "grader", cost: 0.4, costUsd: 0.4 }),
    ]);
    const s = await ledger.summary({ timeZone: "UTC" });
    expect(s.unassigned?.preparation).toMatchObject({ calls: 2 });
    expect(s.unassigned?.preparation?.costUsd).toBeCloseTo(0.91);
    expect(s.unassigned?.other).toMatchObject({ calls: 1 });
    const rows = [...s.byProblem, s.unassigned?.preparation, s.unassigned?.other].reduce((sum, r) => sum + (r?.costUsd ?? 0), 0);
    expect(rows).toBeCloseTo(s.totals.costUsd);
  });

  it("has no preparation row when no custom question was prepared", async () => {
    const s = await (await ledgerWith([row({ sessionId: "s1", role: "judge" })])).summary({ timeZone: "UTC" });
    expect(s.unassigned).toEqual({ preparation: null, other: null });
  });

  it("does not count a drill the user started over as an attempt, and keeps its cost apart", async () => {
    const ledger = await ledgerWith([
      row({ drillAttemptId: A1, drillKind: "walk", cost: 0.2, costUsd: 0.2 }),
      row({ drillAttemptId: A1, drillKind: "walk", cost: 0.1, costUsd: 0.1 }),
      row({ drillAttemptId: A2, drillKind: "tradeoff", cost: 0.05, costUsd: 0.05 }),
    ]);
    const { drills } = await ledger.summary({ timeZone: "UTC", known: { attempts: new Set([A1]), legacyAttempts: 3 } });
    expect(drills.attempts).toBe(1);
    expect(drills.byAttempt.map((a) => a.attemptId)).toEqual([A1]);
    expect(drills.byKind.find((k) => k.kind === "tradeoff")).toMatchObject({ attempts: 0, calls: 1 });
    expect(drills.startedOver).toMatchObject({ attempts: 1, calls: 1 });
    expect(drills.startedOver?.cost).toBeCloseTo(0.05);
    expect(drills.legacyAttempts).toBe(3);
    expect(drills.cost).toBeCloseTo(0.35);
  });

  it("sums the cost of each attempt over its calls and leaves out rows without an attempt id", async () => {
    const a = "0123456789abcdef";
    const b = "fedcba9876543210";
    const costs = await (
      await ledgerWith([
        row({ drillAttemptId: a, drillKind: "walk", cost: 0.1, costUsd: 0.1 }),
        row({ drillAttemptId: a, drillKind: "walk", cost: 0.25, costUsd: 0.25 }),
        row({ drillAttemptId: b, drillKind: "walk", cost: 0.2, costUsd: 0.2 }),
        row({ role: "grader", drillAttemptId: null, cost: 9, costUsd: 9 }),
        row({ sessionId: "s1", role: "judge", cost: 5, costUsd: 5 }),
      ])
    ).drillCosts();
    expect([...costs.keys()].sort()).toEqual([b, a].sort());
    expect(costs.get(a)).toBeCloseTo(0.35);
    expect(costs.get(b)).toBeCloseTo(0.2);
  });

  it("reports empty drills when no row is a drill", async () => {
    const ledger = await ledgerWith([row({ sessionId: "s1", role: "judge" })]);
    const { drills, totals } = await ledger.summary({ timeZone: "UTC" });
    expect(drills).toMatchObject({ cost: 0, calls: 0, failedCalls: 0, attempts: 0, byKind: [], byAttempt: [], earlier: { cost: 0, calls: 0 } });
    expect(totals.drillCost).toBe(0);
  });
});
