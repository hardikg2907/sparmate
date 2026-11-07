import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { TurnStats } from "./driver";

export interface CumulativeTokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export function extractModel(msg: SDKResultMessage, fallbackModel: string): string {
  if ("modelUsage" in msg && msg.modelUsage) {
    const keys = Object.keys(msg.modelUsage);
    if (keys.length > 0 && keys[0]) return keys[0];
  }
  return fallbackModel;
}

/**
 * Extracts turn token counts from SDK usage.
 * According to SDK docs, usage is per-turn in streaming-input sessions, while modelUsage is cumulative.
 * When isCumulative is true (or when evaluating cumulative messages), deltas are computed against lastCumulative.
 */
export function extractTokenCounts(
  usage:
    | {
        input_tokens?: number | null;
        output_tokens?: number | null;
        cache_read_input_tokens?: number | null;
        cache_creation_input_tokens?: number | null;
      }
    | undefined,
  lastCumulative?: CumulativeTokens,
  isCumulative = false,
): {
  tokens: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
  nextCumulative: CumulativeTokens;
} {
  const rawInput = usage?.input_tokens ?? 0;
  const rawOutput = usage?.output_tokens ?? 0;
  const rawCacheRead = usage?.cache_read_input_tokens ?? 0;
  const rawCacheCreation = usage?.cache_creation_input_tokens ?? 0;

  const nextCumulative: CumulativeTokens = {
    inputTokens: rawInput,
    outputTokens: rawOutput,
    cacheReadTokens: rawCacheRead,
    cacheCreationTokens: rawCacheCreation,
  };

  if (!isCumulative || !lastCumulative) {
    return {
      tokens: {
        inputTokens: rawInput,
        outputTokens: rawOutput,
        cacheReadTokens: rawCacheRead,
        cacheCreationTokens: rawCacheCreation,
      },
      nextCumulative,
    };
  }

  return {
    tokens: {
      inputTokens: Math.max(0, rawInput - lastCumulative.inputTokens),
      outputTokens: Math.max(0, rawOutput - lastCumulative.outputTokens),
      cacheReadTokens: Math.max(0, rawCacheRead - lastCumulative.cacheReadTokens),
      cacheCreationTokens: Math.max(0, rawCacheCreation - lastCumulative.cacheCreationTokens),
    },
    nextCumulative,
  };
}

export function extractConversationStats(
  msg: SDKResultMessage,
  startedMs: number,
  lastCumulativeCost: number,
  fallbackModel: string,
  lastCumulativeTokens?: CumulativeTokens,
  isTokensCumulative = false,
): {
  stats: TurnStats;
  nextCumulativeCost: number;
  nextCumulativeTokens: CumulativeTokens;
} {
  const cumulativeCost = msg.total_cost_usd ?? 0;
  const costUsd = Math.max(0, cumulativeCost - lastCumulativeCost);
  const { tokens, nextCumulative } = extractTokenCounts(msg.usage, lastCumulativeTokens, isTokensCumulative);
  const model = extractModel(msg, fallbackModel);

  return {
    stats: {
      durationMs: Date.now() - startedMs,
      costUsd,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      cacheReadTokens: tokens.cacheReadTokens,
      cacheCreationTokens: tokens.cacheCreationTokens,
      model,
    },
    nextCumulativeCost: cumulativeCost,
    nextCumulativeTokens: nextCumulative,
  };
}

export function extractOneShotStats(msg: SDKResultMessage, startedMs: number, fallbackModel: string): TurnStats {
  const costUsd = msg.total_cost_usd ?? null;
  const { tokens } = extractTokenCounts(msg.usage);
  const model = extractModel(msg, fallbackModel);

  return {
    durationMs: Date.now() - startedMs,
    costUsd,
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    cacheReadTokens: tokens.cacheReadTokens,
    cacheCreationTokens: tokens.cacheCreationTokens,
    model,
  };
}
