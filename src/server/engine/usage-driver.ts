import type { Driver, RoleName, TurnReply, UserTurn } from "./driver";
import type { UsageLedger } from "./usage-ledger";

export function wrapDriverWithLedger(
  driver: Driver & { closeAll(): void },
  ledger: UsageLedger,
): Driver & { closeAll(): void } {
  return {
    kind: driver.kind,
    startConversation(setup) {
      const conv = driver.startConversation(setup);
      return {
        sdkSessionId: () => conv.sdkSessionId(),
        async send(turn: UserTurn, handlers) {
          const reply = await conv.send(turn, handlers);
          ledger.record({
            time: new Date().toISOString(),
            sessionId: setup.usage?.sessionId ?? null,
            problemId: setup.usage?.problemId ?? null,
            track: setup.usage?.track ?? null,
            mode: setup.usage?.mode ?? null,
            role: setup.role,
            model: reply.stats.model ?? setup.model,
            effort: setup.effort,
            inputTokens: reply.stats.inputTokens ?? 0,
            outputTokens: reply.stats.outputTokens ?? 0,
            cacheReadTokens: reply.stats.cacheReadTokens ?? 0,
            cacheCreationTokens: reply.stats.cacheCreationTokens ?? 0,
            cost: reply.stats.costUsd ?? 0,
            costUsd: reply.stats.costUsd ?? 0,
            duration: reply.stats.durationMs,
            durationMs: reply.stats.durationMs,
          });
          return reply;
        },
        close: () => conv.close(),
      };
    },
    async runOnce<T>(setup: any) {
      const res = await driver.runOnce<T>(setup);
      ledger.record({
        time: new Date().toISOString(),
        sessionId: setup.usage?.sessionId ?? null,
        problemId: setup.usage?.problemId ?? null,
        track: setup.usage?.track ?? null,
        mode: setup.usage?.mode ?? null,
        role: setup.role,
        model: res.stats.model ?? setup.model,
        effort: setup.effort,
        inputTokens: res.stats.inputTokens ?? 0,
        outputTokens: res.stats.outputTokens ?? 0,
        cacheReadTokens: res.stats.cacheReadTokens ?? 0,
        cacheCreationTokens: res.stats.cacheCreationTokens ?? 0,
        cost: res.stats.costUsd ?? 0,
        costUsd: res.stats.costUsd ?? 0,
        duration: res.stats.durationMs,
        durationMs: res.stats.durationMs,
      });
      return res;
    },
    closeAll: () => driver.closeAll(),
  };
}
