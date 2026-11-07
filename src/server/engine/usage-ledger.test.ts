import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { calcCacheHitRate, parseUsageRecord, UsageLedger, type UsageRecord } from "./usage-ledger";

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
      rounds: 0,
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
    const corrupted = content + "\nnot-valid-json\n{\"missing\":\"fields\"}\n\n";
    await writeFile(filePath, corrupted, "utf8");

    const r2: UsageRecord = {
      time: "2026-10-31T11:00:00.000Z",
      sessionId: "sess-1",
      problemId: "c2-url-shortener",
      track: "hld",
      mode: "interview",
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
