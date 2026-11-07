import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { TurnStats } from "./driver";

export interface CumulativeTokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

// modelUsage also lists small helper models the SDK calls inside one request, so its first key is not the main model.
export function extractModel(msg: SDKResultMessage, requestedModel: string): string {
  const usage = "modelUsage" in msg && msg.modelUsage ? (msg.modelUsage as Record<string, { costUSD?: number; outputTokens?: number }>) : {};
  const keys = Object.keys(usage);
  if (keys.length === 0) return requestedModel;
  const requested = keys.find((k) => k === requestedModel || k.startsWith(`${requestedModel}[`));
  if (requested) return requested;
  const weight = (k: string) => usage[k]?.costUSD ?? usage[k]?.outputTokens ?? 0;
  return keys.reduce((best, k) => (weight(k) > weight(best) ? k : best));
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

interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

// USD per million tokens, Anthropic first-party list prices (claude-api skill model table, cached 2026-10-06).
// Cache writes use the 1-hour rate (2x input), which Claude Code's own cost figures also lean on.
const PRICES_PER_MTOK: Record<string, ModelPrice> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 8 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 4 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.2 },
};

/** The dearest known model: an upper bound for a row whose model label cannot be trusted. */
export const DEAREST_MODEL = "claude-opus-5-5";

/** Cost of a call from its token counts, or null for a model with no known price. */
export function estimateCostUsd(
  model: string,
  t: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number },
): number | null {
  const p = PRICES_PER_MTOK[model.replace(/\[.*$/, "")];
  if (!p) return null;
  return (t.inputTokens * p.input + t.outputTokens * p.output + t.cacheReadTokens * p.cacheRead + t.cacheCreationTokens * p.cacheWrite) / 1_000_000;
}

// A thrown error cannot carry the stats of a call that spent tokens, so they travel beside it.
const failedCallStats = new WeakMap<object, TurnStats>();

export function attachFailureStats<E extends object>(err: E, stats: TurnStats): E {
  failedCallStats.set(err, stats);
  return err;
}

export function failureStats(err: unknown): TurnStats | null {
  return typeof err === "object" && err !== null ? (failedCallStats.get(err) ?? null) : null;
}

/** Sum of two attempts at one call; an unknown cost on either side stays unknown. */
export function addStats(a: TurnStats, b: TurnStats): TurnStats {
  return {
    durationMs: a.durationMs + b.durationMs,
    costUsd: a.costUsd === null || b.costUsd === null ? null : a.costUsd + b.costUsd,
    inputTokens: (a.inputTokens ?? 0) + (b.inputTokens ?? 0),
    outputTokens: (a.outputTokens ?? 0) + (b.outputTokens ?? 0),
    cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0),
    cacheCreationTokens: (a.cacheCreationTokens ?? 0) + (b.cacheCreationTokens ?? 0),
    model: b.model ?? a.model,
  };
}
