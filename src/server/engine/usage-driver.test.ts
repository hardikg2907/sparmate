import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DriverError, type Driver, type OneShotSetup, type TurnStats } from "./driver";
import { attachFailureStats } from "./usage-capture";
import { UsageLedger } from "./usage-ledger";
import { wrapDriverWithLedger } from "./usage-driver";

const tokens = { inputTokens: 2, outputTokens: 1000, cacheReadTokens: 10_000, cacheCreationTokens: 1000 };

function driverWith(outcome: () => Promise<{ stats: TurnStats }>): Driver & { closeAll(): void } {
  return {
    kind: "fake",
    startConversation: () => ({
      sdkSessionId: () => null,
      send: async () => ({ text: "hi", ...(await outcome()) }),
      close: () => {},
    }),
    runOnce: (async () => ({ text: "x", output: null, ...(await outcome()) })) as Driver["runOnce"],
    closeAll: () => {},
  };
}

const setup = { role: "judge", model: "claude-haiku-5-5", effort: "low", usage: { sessionId: "s1" } } as any;
const turn = { text: "q", meta: {} } as any;

describe("wrapDriverWithLedger", () => {
  let dir: string;
  let ledger: UsageLedger;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ir-wrap-"));
    ledger = new UsageLedger({ filePath: join(dir, "usage.jsonl") });
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("estimates the cost of a turn whose cost is unknown instead of storing 0", async () => {
    const d = wrapDriverWithLedger(
      driverWith(async () => ({ stats: { durationMs: 5, costUsd: null, ...tokens, model: "claude-haiku-5-5" } })),
      ledger,
    );
    await d.startConversation(setup).send(turn, { onTextDelta() {} });
    const [row] = await ledger.readAll();
    expect(row!.costUsd).toBeGreaterThan(0);
    expect(row!.costEstimated).toBe(true);
    expect(row!.ok).toBe(true);
  });

  it("records a failed one-shot call with the tokens the SDK reported", async () => {
    const d = wrapDriverWithLedger(
      driverWith(async () => {
        const err = new DriverError("bad shape");
        attachFailureStats(err, { durationMs: 7, costUsd: 0.02, ...tokens, model: "claude-haiku-5-5" });
        throw err;
      }),
      ledger,
    );
    await expect(d.runOnce(setup as OneShotSetup<unknown>)).rejects.toThrow("bad shape");
    const rows = await ledger.readAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ok).toBe(false);
    expect(rows[0]!.costUsd).toBeCloseTo(0.02);
    expect(rows[0]!.outputTokens).toBe(1000);
  });

  it("records a failed conversation turn and rethrows", async () => {
    const d = wrapDriverWithLedger(
      driverWith(async () => {
        const err = new DriverError("overloaded");
        attachFailureStats(err, { durationMs: 7, costUsd: 0.01, ...tokens });
        throw err;
      }),
      ledger,
    );
    await expect(d.startConversation(setup).send(turn, { onTextDelta() {} })).rejects.toThrow("overloaded");
    expect((await ledger.readAll())[0]!.ok).toBe(false);
  });

  it("writes nothing when the call failed before any model result", async () => {
    const d = wrapDriverWithLedger(
      driverWith(async () => {
        throw new DriverError("aborted");
      }),
      ledger,
    );
    await expect(d.runOnce(setup as OneShotSetup<unknown>)).rejects.toThrow("aborted");
    expect(await ledger.readAll()).toHaveLength(0);
  });

  it("copies the drill attempt id and kind into the row, and null when absent", async () => {
    const d = wrapDriverWithLedger(
      driverWith(async () => ({ stats: { durationMs: 5, costUsd: 0.01, ...tokens, model: "claude-haiku-5-5" } })),
      ledger,
    );
    const drillSetup = { ...setup, role: "grader", usage: { problemId: "p1", drillAttemptId: "0123456789abcdef", drillKind: "walk" } };
    await d.runOnce(drillSetup as OneShotSetup<unknown>);
    await d.runOnce(setup as OneShotSetup<unknown>);
    const [drill, plain] = await ledger.readAll();
    expect(drill).toMatchObject({ drillAttemptId: "0123456789abcdef", drillKind: "walk" });
    expect(plain).toMatchObject({ drillAttemptId: null, drillKind: null });
  });
});
