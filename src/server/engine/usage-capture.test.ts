import { describe, expect, it } from "vitest";
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { extractConversationStats, extractModel, extractOneShotStats, extractTokenCounts } from "./usage-capture";

function mockResult(overrides: Partial<SDKResultMessage> = {}): SDKResultMessage {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 1200,
    duration_api_ms: 1000,
    num_turns: 1,
    result: "All good",
    stop_reason: "end_turn",
    total_cost_usd: 0.015,
    usage: {
      input_tokens: 1500,
      output_tokens: 300,
      cache_read_input_tokens: 400,
      cache_creation_input_tokens: 800,
    },
    modelUsage: {
      "claude-opus-5-5": {
        inputTokens: 1500,
        outputTokens: 300,
        cacheReadInputTokens: 400,
        cacheCreationInputTokens: 800,
      },
    },
    permission_denials: [],
    uuid: "123e4567-e89b-12d3-a456-426614174000" as any,
    session_id: "sess-1",
    ...overrides,
  } as unknown as SDKResultMessage;
}

describe("usage extraction from SDK result messages", () => {
  it("extracts model name from modelUsage or falls back to configured model", () => {
    const withModel = mockResult();
    expect(extractModel(withModel, "fallback-model")).toBe("claude-opus-5-5");

    const withoutModel = mockResult({ modelUsage: {} });
    expect(extractModel(withoutModel, "fallback-model")).toBe("fallback-model");
  });

  it("labels the call with the requested model even when a helper model comes first in modelUsage", () => {
    const msg = mockResult({
      modelUsage: {
        "claude-haiku-5-5": { inputTokens: 50, outputTokens: 5, costUSD: 0.0001 },
        "claude-opus-5-5": { inputTokens: 1500, outputTokens: 300, costUSD: 0.04 },
      } as any,
    });
    expect(extractModel(msg, "claude-opus-5-5")).toBe("claude-opus-5-5");
  });

  it("picks the costliest model in modelUsage when the requested model is absent", () => {
    const msg = mockResult({
      modelUsage: {
        "claude-haiku-5-5": { inputTokens: 50, outputTokens: 5, costUSD: 0.0001 },
        "claude-opus-5-5": { inputTokens: 1500, outputTokens: 300, costUSD: 0.04 },
      } as any,
    });
    expect(extractModel(msg, "alias-not-listed")).toBe("claude-opus-5-5");
  });

  describe("per-turn usage extraction", () => {
    it("extracts exact per-turn token counts when usage is per-turn", () => {
      const usage = {
        input_tokens: 500,
        output_tokens: 150,
        cache_read_input_tokens: 200,
        cache_creation_input_tokens: 300,
      };
      const { tokens, nextCumulative } = extractTokenCounts(usage, undefined, false);
      expect(tokens).toEqual({
        inputTokens: 500,
        outputTokens: 150,
        cacheReadTokens: 200,
        cacheCreationTokens: 300,
      });
      expect(nextCumulative).toEqual({
        inputTokens: 500,
        outputTokens: 150,
        cacheReadTokens: 200,
        cacheCreationTokens: 300,
      });
    });

    it("defaults missing or null cache tokens to 0", () => {
      const usage = {
        input_tokens: 500,
        output_tokens: 150,
      } as any;
      const { tokens } = extractTokenCounts(usage);
      expect(tokens).toEqual({
        inputTokens: 500,
        outputTokens: 150,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      });
    });

    it("computes cost delta and extracts stats for a conversation turn", () => {
      const started = Date.now() - 500;
      const msg = mockResult({ total_cost_usd: 0.05 });
      const { stats, nextCumulativeCost } = extractConversationStats(msg, started, 0.02, "default-model");

      expect(stats.costUsd).toBeCloseTo(0.03);
      expect(stats.inputTokens).toBe(1500);
      expect(stats.outputTokens).toBe(300);
      expect(stats.cacheReadTokens).toBe(400);
      expect(stats.cacheCreationTokens).toBe(800);
      expect(stats.model).toBe("claude-opus-5-5");
      expect(stats.durationMs).toBeGreaterThanOrEqual(400);
      expect(nextCumulativeCost).toBe(0.05);
    });

    it("extracts stats for a one-shot call", () => {
      const started = Date.now() - 250;
      const msg = mockResult({ total_cost_usd: 0.02 });
      const stats = extractOneShotStats(msg, started, "default-model");

      expect(stats.costUsd).toBe(0.02);
      expect(stats.inputTokens).toBe(1500);
      expect(stats.outputTokens).toBe(300);
      expect(stats.cacheReadTokens).toBe(400);
      expect(stats.cacheCreationTokens).toBe(800);
      expect(stats.model).toBe("claude-opus-5-5");
      expect(stats.durationMs).toBeGreaterThanOrEqual(200);
    });
  });

  describe("cumulative token usage extraction", () => {
    it("computes per-turn token deltas across consecutive turns when tokens are cumulative", () => {
      const turn1Usage = {
        input_tokens: 1000,
        output_tokens: 200,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 1000,
      };
      const turn1 = extractTokenCounts(turn1Usage, undefined, true);
      expect(turn1.tokens).toEqual({
        inputTokens: 1000,
        outputTokens: 200,
        cacheReadTokens: 0,
        cacheCreationTokens: 1000,
      });

      const turn2Usage = {
        input_tokens: 1600,
        output_tokens: 450,
        cache_read_input_tokens: 1000,
        cacheCreationTokens: 1200,
        cache_creation_input_tokens: 1200,
      };
      const turn2 = extractTokenCounts(turn2Usage, turn1.nextCumulative, true);
      expect(turn2.tokens).toEqual({
        inputTokens: 600,
        outputTokens: 250,
        cacheReadTokens: 1000,
        cacheCreationTokens: 200,
      });

      const turn3Usage = {
        input_tokens: 2100,
        output_tokens: 700,
        cache_read_input_tokens: 2200,
        cache_creation_input_tokens: 1300,
      };
      const turn3 = extractTokenCounts(turn3Usage, turn2.nextCumulative, true);
      expect(turn3.tokens).toEqual({
        inputTokens: 500,
        outputTokens: 250,
        cacheReadTokens: 1200,
        cacheCreationTokens: 100,
      });
    });

    it("extractConversationStats computes deltas for both cost and tokens in cumulative mode", () => {
      const msg1 = mockResult({
        total_cost_usd: 0.01,
        usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 100, cache_creation_input_tokens: 500 } as any,
      });
      const res1 = extractConversationStats(msg1, Date.now(), 0, "model-1", undefined, true);
      expect(res1.stats.costUsd).toBe(0.01);
      expect(res1.stats.inputTokens).toBe(1000);

      const msg2 = mockResult({
        total_cost_usd: 0.035,
        usage: { input_tokens: 1800, output_tokens: 500, cache_read_input_tokens: 600, cache_creation_input_tokens: 600 } as any,
      });
      const res2 = extractConversationStats(msg2, Date.now(), res1.nextCumulativeCost, "model-1", res1.nextCumulativeTokens, true);
      expect(res2.stats.costUsd).toBeCloseTo(0.025);
      expect(res2.stats.inputTokens).toBe(800);
      expect(res2.stats.outputTokens).toBe(300);
      expect(res2.stats.cacheReadTokens).toBe(500);
      expect(res2.stats.cacheCreationTokens).toBe(100);
    });
  });
});
