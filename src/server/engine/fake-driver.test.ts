import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeDriver } from "./fake-driver";
import { wrapDriverWithLedger } from "./usage-driver";
import { UsageLedger } from "./usage-ledger";

describe("the fake driver and the usage ledger", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ir-fake-cost-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("writes a ledger row for a scripted turn and a scripted one-shot call, both priced at 0", async () => {
    const ledger = new UsageLedger({ filePath: join(dir, "usage.jsonl") });
    const driver = wrapDriverWithLedger(createFakeDriver({ chunkDelayMs: 0 }), ledger);
    const conv = driver.startConversation({
      role: "interviewer",
      model: "claude-opus-5-5",
      effort: "low",
      systemPrompt: async () => "x",
      tools: [],
      fake: { track: "hld", mode: "interview" },
      usage: { sessionId: "s1", problemId: "p1", track: "hld", mode: "interview" },
    } as never);
    await conv.send({ text: "hello", meta: {} } as never, { onTextDelta() {} });
    await driver
      .runOnce({
        role: "checker",
        model: "claude-sonnet-5-5",
        effort: "low",
        systemPrompt: async () => "x",
        tools: [],
        fake: {},
        usage: { sessionId: "s1", problemId: "p1", track: "hld", mode: "interview" },
        turn: { text: "q", meta: { kind: "oneshot" } },
        output: { schema: { parse: (v: unknown) => v } },
      } as never)
      .catch(() => undefined);
    await ledger.flush();
    const rows = await ledger.readAll();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.costUsd === 0 && r.cost === 0)).toBe(true);
    expect(rows.every((r) => r.costEstimated === false)).toBe(true);
    expect((await ledger.summary({ timeZone: "UTC" })).totals.costUsd).toBe(0);
  });
});
