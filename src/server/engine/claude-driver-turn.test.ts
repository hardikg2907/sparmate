import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scripted: { messages: any[][]; hang: Promise<void> | null } = { messages: [], hang: null };

vi.mock("@anthropic-ai/claude-agent-sdk", async (importActual) => {
  const actual = await importActual<typeof import("@anthropic-ai/claude-agent-sdk")>();
  return {
    ...actual,
    query: () => {
      const msgs = scripted.messages.shift() ?? [];
      return {
        close() {},
        async *[Symbol.asyncIterator]() {
          for (const m of msgs) {
            if (m === "hang") await scripted.hang;
            else if (m instanceof Error) throw m;
            else yield m;
          }
        },
      };
    },
  };
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClaudeDriver } from "./claude-driver";
import { memoryLogger } from "./log";
import { UsageLedger } from "./usage-ledger";
import { wrapDriverWithLedger } from "./usage-driver";

const start = (index: number) => ({
  type: "stream_event",
  parent_tool_use_id: null,
  session_id: "s",
  event: { type: "content_block_start", index, content_block: { type: "text", text: "" } },
});
const delta = (text: string) => ({
  type: "stream_event",
  parent_tool_use_id: null,
  session_id: "s",
  event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
});
const stop = (index: number) => ({ type: "stream_event", parent_tool_use_id: null, session_id: "s", event: { type: "content_block_stop", index } });
const toolStart = (index: number) => ({
  type: "stream_event",
  parent_tool_use_id: null,
  session_id: "s",
  event: { type: "content_block_start", index, content_block: { type: "tool_use" } },
});
const assistant = (...texts: string[]) => ({ type: "assistant", parent_tool_use_id: null, session_id: "s", message: { content: texts.map((text) => ({ type: "text", text })) } });
const spent = (id: string, input: number, output: number) => ({
  type: "assistant",
  parent_tool_use_id: null,
  session_id: "s",
  message: { id, usage: { input_tokens: input, output_tokens: output }, content: [{ type: "text", text: "hm" }] },
});
const done = (result = "final") => ({
  type: "result",
  subtype: "success",
  is_error: false,
  result,
  total_cost_usd: 0.01,
  usage: { input_tokens: 1, output_tokens: 2 },
  modelUsage: {},
  session_id: "s",
});

/** A text block as the SDK streams it: start, pieces, stop. */
const block = (index: number, ...pieces: string[]) => [start(index), ...pieces.map(delta), stop(index)];

const driver = () => createClaudeDriver({ cwd: "/tmp", log: memoryLogger(), clientApp: "t/1" });
const setup = { role: "interviewer", model: "claude-haiku-5-5", effort: "low", fake: {}, systemPrompt: async () => "s", tools: [], resumeSessionId: undefined } as any;

async function runTurn(messages: unknown[]) {
  scripted.messages = [messages as any[]];
  const conv = driver().startConversation(setup);
  const deltas: string[] = [];
  const reply = await conv.send({ text: "q", meta: {} } as any, { onTextDelta: (d: string) => deltas.push(d) });
  conv.close();
  return { reply, streamed: deltas.join("") };
}

describe("a reply the model writes twice", () => {
  beforeEach(() => {
    scripted.messages = [];
    scripted.hang = null;
  });

  it("shows text repeated after a tool call once", async () => {
    const { reply, streamed } = await runTurn([...block(0, "Try the ", "sorted array."), toolStart(1), stop(1), ...block(2, "Try the ", "sorted array."), done()]);
    expect(streamed).toBe("Try the sorted array.");
    expect(reply.text).toBe("Try the sorted array.");
  });

  it("drops a repeat that differs only in surrounding whitespace", async () => {
    const { reply, streamed } = await runTurn([...block(0, "Same text."), ...block(1, "\n", "Same text.\n"), done()]);
    expect(streamed).toBe("Same text.");
    expect(reply.text).toBe("Same text.");
  });

  it("keeps a new block after the first, joined by a blank line", async () => {
    const { reply, streamed } = await runTurn([...block(0, "First idea."), toolStart(1), stop(1), ...block(2, "Second idea."), done()]);
    expect(streamed).toBe("First idea.\n\nSecond idea.");
    expect(reply.text).toBe("First idea.\n\nSecond idea.");
  });

  it("emits a block that starts like an earlier one and then diverges", async () => {
    const { reply, streamed } = await runTurn([...block(0, "Start with a hash map."), ...block(1, "Start with ", "a heap instead."), done()]);
    expect(streamed).toBe("Start with a hash map.\n\nStart with a heap instead.");
    expect(reply.text).toBe(streamed);
  });

  it("emits a block that is only the start of an earlier one", async () => {
    const { reply, streamed } = await runTurn([...block(0, "Start with a hash map."), ...block(1, "Start with"), done()]);
    expect(streamed).toBe("Start with a hash map.\n\nStart with");
    expect(reply.text).toBe(streamed);
  });

  it("drops a repeat whose block never gets a stop event before the result", async () => {
    const { reply, streamed } = await runTurn([...block(0, "Hello there."), start(1), delta("Hello "), delta("there."), done()]);
    expect(streamed).toBe("Hello there.");
    expect(reply.text).toBe("Hello there.");
  });

  it("drops the earlier paragraph from a block that repeats it and goes on", async () => {
    const { reply, streamed } = await runTurn([
      ...block(0, "Try the sorted array."),
      toolStart(1),
      stop(1),
      ...block(2, "Try the sorted ", "array.", " What does it cost?"),
      done(),
    ]);
    expect(streamed).toBe("Try the sorted array.\n\nWhat does it cost?");
    expect(reply.text).toBe(streamed);
  });

  it("drops a repeat that differs only in inner whitespace, and the repeated part of a longer one", async () => {
    const same = await runTurn([...block(0, "A\nB"), ...block(1, "A\n\nB"), done()]);
    expect(same.streamed).toBe("A\nB");
    const longer = await runTurn([...block(0, "A\nB"), ...block(1, "A\n\n", "B C"), done()]);
    expect(longer.streamed).toBe("A\nB\n\nC");
    expect(longer.reply.text).toBe(longer.streamed);
  });

  it("drops a repeat that arrives in a new assistant message with block index 0", async () => {
    const { reply, streamed } = await runTurn([...block(0, "Same paragraph."), toolStart(1), stop(1), assistant("Same paragraph."), ...block(0, "Same paragraph."), done()]);
    expect(streamed).toBe("Same paragraph.");
    expect(reply.text).toBe("Same paragraph.");
  });

  it("drops a repeated block on the non-streamed path", async () => {
    const { reply, streamed } = await runTurn([assistant("Same answer."), assistant("Same answer.", "Extra."), done("ignored")]);
    expect(streamed).toBe("Same answer.\n\nExtra.");
    expect(reply.text).toBe("Same answer.\n\nExtra.");
  });
});

describe("a model process that stops on its own", () => {
  let dir: string;
  let ledger: UsageLedger;
  beforeEach(async () => {
    scripted.messages = [];
    scripted.hang = null;
    dir = await mkdtemp(join(tmpdir(), "ir-turn-"));
    ledger = new UsageLedger({ filePath: join(dir, "usage.jsonl") });
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  const wrapped = () => wrapDriverWithLedger(driver(), ledger);

  it("writes one failed row with zero tokens when the stream ends mid-turn", async () => {
    scripted.messages = [[...block(0, "Partial")]];
    const conv = wrapped().startConversation({ ...setup, usage: { sessionId: "s1" } });
    await expect(conv.send({ text: "q", meta: {} } as any, { onTextDelta() {} })).rejects.toThrow("The model process stopped.");
    const rows = await ledger.readAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ok: false, costEstimated: false, costUsd: 0, inputTokens: 0, outputTokens: 0, model: "claude-haiku-5-5" });
    expect((await ledger.summary()).totals.failedCalls).toBe(1);
    expect((await ledger.summary()).totals.estimatedCalls).toBe(0);
  });

  it("writes one failed row when the stream throws", async () => {
    scripted.messages = [[new Error("Claude Code process exited with code 143")]];
    const conv = wrapped().startConversation(setup);
    await expect(conv.send({ text: "q", meta: {} } as any, { onTextDelta() {} })).rejects.toThrow("The model process stopped.");
    const rows = await ledger.readAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ok: false, costEstimated: false });
  });

  it("writes no row when the conversation was closed during the turn", async () => {
    let release = () => {};
    scripted.hang = new Promise<void>((r) => (release = r));
    scripted.messages = [["hang"]];
    const conv = wrapped().startConversation(setup);
    const sent = conv.send({ text: "q", meta: {} } as any, { onTextDelta() {} });
    await new Promise((r) => setTimeout(r, 20));
    conv.close();
    release();
    await expect(sent).rejects.toThrow("The conversation was closed.");
    expect(await ledger.readAll()).toHaveLength(0);
  });

  it("writes one failed row when a one-shot ends without a result", async () => {
    scripted.messages = [[assistant("x")]];
    const base = {
      role: "judge",
      model: "claude-haiku-5-5",
      effort: "low",
      fake: {},
      systemPrompt: async () => "s",
      tools: [],
      turn: { text: "q", meta: {} },
      maxTurns: 1,
      output: null,
    } as any;
    await expect(wrapped().runOnce(base)).rejects.toThrow("stopped early");
    const rows = await ledger.readAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ok: false, costEstimated: false, outputTokens: 0 });
  });

  it("writes no row when a one-shot was aborted by its signal", async () => {
    let release = () => {};
    scripted.hang = new Promise<void>((r) => (release = r));
    scripted.messages = [["hang"]];
    const ctl = new AbortController();
    const base = {
      role: "judge",
      model: "claude-haiku-5-5",
      effort: "low",
      fake: {},
      systemPrompt: async () => "s",
      tools: [],
      turn: { text: "q", meta: {} },
      maxTurns: 1,
      output: null,
      signal: ctl.signal,
    } as any;
    const run = wrapped().runOnce(base);
    await new Promise((r) => setTimeout(r, 20));
    ctl.abort();
    release();
    await expect(run).rejects.toThrow();
    expect(await ledger.readAll()).toHaveLength(0);
  });

  it("keeps the tokens of assistant messages seen before the process died, once per message id, and prices them", async () => {
    scripted.messages = [[spent("m1", 10, 20), spent("m1", 10, 20), spent("m2", 5, 7)]];
    const conv = wrapped().startConversation(setup);
    await expect(conv.send({ text: "q", meta: {} } as any, { onTextDelta() {} })).rejects.toThrow("The model process stopped.");
    const [row] = await ledger.readAll();
    expect(row).toMatchObject({ ok: false, inputTokens: 15, outputTokens: 27, costEstimated: true });
    expect(row!.costUsd).toBeGreaterThan(0);
  });

  it("keeps the tokens seen before a one-shot died", async () => {
    scripted.messages = [[spent("m1", 4, 6)]];
    const base = {
      role: "judge",
      model: "claude-haiku-5-5",
      effort: "low",
      fake: {},
      systemPrompt: async () => "s",
      tools: [],
      turn: { text: "q", meta: {} },
      maxTurns: 1,
      output: null,
    } as any;
    await expect(wrapped().runOnce(base)).rejects.toThrow("stopped early");
    expect((await ledger.readAll())[0]).toMatchObject({ ok: false, inputTokens: 4, outputTokens: 6, costEstimated: true });
  });

  it("writes no row for a process that dies after the driver was told it is stopping", async () => {
    let release = () => {};
    scripted.hang = new Promise<void>((r) => (release = r));
    scripted.messages = [["hang"], ["hang"]];
    const d = wrapped();
    const conv = d.startConversation(setup);
    const turn = conv.send({ text: "q", meta: {} } as any, { onTextDelta() {} });
    const base = {
      role: "judge",
      model: "claude-haiku-5-5",
      effort: "low",
      fake: {},
      systemPrompt: async () => "s",
      tools: [],
      turn: { text: "q", meta: {} },
      maxTurns: 1,
      output: null,
    } as any;
    const once = d.runOnce(base);
    await new Promise((r) => setTimeout(r, 20));
    d.markStopping();
    release();
    await expect(turn).rejects.toThrow();
    await expect(once).rejects.toThrow();
    expect(await ledger.readAll()).toHaveLength(0);
  });
});
