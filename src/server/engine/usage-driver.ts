import type { Driver, OneShotSetup, TurnStats } from "./driver";
import { estimateCostUsd, failureStats } from "./usage-capture";
import type { UsageLedger, UsageRecord } from "./usage-ledger";

interface UsageSetup {
  role: string;
  model: string;
  effort: string;
  usage?: { sessionId?: string | null; problemId?: string | null; track?: UsageRecord["track"]; mode?: UsageRecord["mode"] };
}

function toRecord(setup: UsageSetup, stats: TurnStats, ok: boolean): UsageRecord {
  const model = stats.model ?? setup.model;
  const tokens = {
    inputTokens: stats.inputTokens ?? 0,
    outputTokens: stats.outputTokens ?? 0,
    cacheReadTokens: stats.cacheReadTokens ?? 0,
    cacheCreationTokens: stats.cacheCreationTokens ?? 0,
  };
  // A null cost means the SDK could not say what this call cost, so price it from its tokens.
  const estimate = stats.costUsd === null ? estimateCostUsd(model, tokens) : null;
  const cost = stats.costUsd ?? estimate ?? 0;
  return {
    time: new Date().toISOString(),
    sessionId: setup.usage?.sessionId ?? null,
    problemId: setup.usage?.problemId ?? null,
    track: setup.usage?.track ?? null,
    mode: setup.usage?.mode ?? null,
    role: setup.role,
    model,
    effort: setup.effort,
    ...tokens,
    cost,
    costUsd: cost,
    costEstimated: estimate !== null,
    ok,
    duration: stats.durationMs,
    durationMs: stats.durationMs,
  };
}

export function wrapDriverWithLedger(
  driver: Driver & { closeAll(): void },
  ledger: UsageLedger,
): Driver & { closeAll(): void } {
  // Only a failure that carried a model result spent tokens; an abort before the model ran writes no row.
  const recordFailure = (setup: UsageSetup, err: unknown) => {
    const stats = failureStats(err);
    if (stats) ledger.record(toRecord(setup, stats, false));
  };
  return {
    kind: driver.kind,
    startConversation(setup) {
      const conv = driver.startConversation(setup);
      return {
        sdkSessionId: () => conv.sdkSessionId(),
        async send(turn, handlers) {
          try {
            const reply = await conv.send(turn, handlers);
            ledger.record(toRecord(setup, reply.stats, true));
            return reply;
          } catch (err) {
            recordFailure(setup, err);
            throw err;
          }
        },
        close: () => conv.close(),
      };
    },
    async runOnce<T>(setup: OneShotSetup<T>) {
      try {
        const res = await driver.runOnce<T>(setup);
        ledger.record(toRecord(setup, res.stats, true));
        return res;
      } catch (err) {
        recordFailure(setup, err);
        throw err;
      }
    },
    closeAll: () => driver.closeAll(),
  };
}
