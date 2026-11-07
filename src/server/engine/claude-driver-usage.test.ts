import { beforeEach, describe, expect, it, vi } from "vitest";

const scripted: { messages: any[][] } = { messages: [] };

vi.mock("@anthropic-ai/claude-agent-sdk", async (importActual) => {
  const actual = await importActual<typeof import("@anthropic-ai/claude-agent-sdk")>();
  return {
    ...actual,
    query: () => {
      const msgs = scripted.messages.shift() ?? [];
      return {
        close() {},
        async *[Symbol.asyncIterator]() {
          for (const m of msgs) yield m;
        },
      };
    },
  };
});

import { createClaudeDriver } from "./claude-driver";
import { failureStats } from "./usage-capture";
import { memoryLogger } from "./log";
import { z } from "zod";

function result(over: Record<string, unknown> = {}) {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "ok",
    structured_output: { a: 1 },
    total_cost_usd: 0.05,
    usage: { input_tokens: 3, output_tokens: 40, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 },
    modelUsage: { "claude-haiku-5-5": {} },
    session_id: "sdk-1",
    ...over,
  };
}

const driver = () => createClaudeDriver({ cwd: "/tmp", log: memoryLogger(), clientApp: "t/1" });
const base = { role: "judge", model: "claude-haiku-5-5", effort: "low", fake: {}, systemPrompt: async () => "s", tools: [], turn: { text: "q", meta: {} }, maxTurns: 1 } as any;

describe("claude driver failure stats", () => {
  beforeEach(() => {
    scripted.messages = [];
  });

  it("attaches stats to a one-shot result error", async () => {
    scripted.messages = [[result({ subtype: "error_during_execution", is_error: true })]];
    const err = await driver().runOnce({ ...base, output: null }).catch((e) => e);
    expect(failureStats(err)?.outputTokens).toBe(40);
    expect(failureStats(err)?.costUsd).toBeCloseTo(0.05);
  });

  it("attaches stats to a schema-validation failure", async () => {
    scripted.messages = [[result({ structured_output: { a: "nope" } })]];
    const output = { schema: z.object({ a: z.number() }), jsonSchema: {}, fallbackJsonSchema: null };
    const err = await driver().runOnce({ ...base, output }).catch((e) => e);
    expect(failureStats(err)?.inputTokens).toBe(3);
  });

  it("adds the tokens of a refused first schema attempt to the retry", async () => {
    scripted.messages = [
      [result({ subtype: "error_during_execution", is_error: true, errors: ["invalid json_schema"], total_cost_usd: 0.01 })],
      [result({ total_cost_usd: 0.02 })],
    ];
    const output = { schema: z.object({ a: z.number() }), jsonSchema: {}, fallbackJsonSchema: {} };
    const res = await driver().runOnce({ ...base, output });
    expect(res.stats.outputTokens).toBe(80);
    expect(res.stats.costUsd).toBeCloseTo(0.03);
  });

  it("attaches stats to a failed conversation turn", async () => {
    scripted.messages = [[result({ subtype: "error_during_execution", is_error: true })]];
    const conv = driver().startConversation({ ...base, resumeSessionId: undefined });
    const err = await conv.send({ text: "q", meta: {} } as any, { onTextDelta() {} }).catch((e) => e);
    expect(failureStats(err)?.outputTokens).toBe(40);
    conv.close();
  });
});
