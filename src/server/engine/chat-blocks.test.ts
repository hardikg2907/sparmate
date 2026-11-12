import { describe, expect, it } from "vitest";
import type { ChatBlock } from "../../shared/blocks";
import type { Track } from "../../shared/phases";
import type { Channel } from "../../shared/types";
import type { TurnMeta } from "./driver";
import { createEmitBlockTool, isSilentReply, stripDisallowedHintBlocks } from "./chat-blocks";

interface HarnessOptions {
  channel?: Channel;
  track?: Track;
  meta?: TurnMeta | null;
  hintNoted?: boolean;
  phase?: string;
  countOnlyPhases?: string[];
  countOnlyVerdictThisTurn?: boolean;
  boardElements?: Record<string, unknown>[];
  code?: string;
}

const SAMPLE_BOARD: Record<string, unknown>[] = [
  { id: "f-req", type: "frame", name: "Requirements", x: 0, y: 0, width: 400, height: 300, customData: { step: "requirements" } },
  { id: "f-design", type: "frame", name: "High-level design", x: 500, y: 0, width: 400, height: 300, customData: { step: "design" } },
  { id: "box-gw", type: "rectangle", frameId: "f-design", x: 520, y: 40, width: 120, height: 60 },
  { id: "txt-gw", type: "text", containerId: "box-gw", text: "API Gateway", originalText: "API Gateway", x: 530, y: 55, width: 100, height: 24 },
  { id: "box-req", type: "rectangle", frameId: "f-req", x: 20, y: 40, width: 120, height: 60 },
];

function makeHarness(opts: HarnessOptions = {}) {
  const blocks: ChatBlock[] = [];
  const countOnly = new Set(opts.countOnlyPhases ?? []);
  const tool = createEmitBlockTool({
    channel: opts.channel ?? "interview",
    track: opts.track ?? "hld",
    pendingCount: () => blocks.length,
    pushBlock: (b) => {
      blocks.push(b);
      return blocks.length;
    },
    turnMeta: () => opts.meta ?? { kind: "candidate", candidateText: "hello" },
    hintNotedThisTurn: () => opts.hintNoted ?? false,
    currentPhase: () => opts.phase ?? "requirements",
    isCountOnly: (phase) => countOnly.has(phase),
    countOnlyVerdictThisTurn: () => opts.countOnlyVerdictThisTurn ?? false,
    boardElements: () => opts.boardElements ?? SAMPLE_BOARD,
    readCode: () => opts.code ?? "",
  });
  return { tool, blocks };
}

function firstText(out: { content: { type: string; text?: string }[] }): string {
  const first = out.content[0];
  return first?.type === "text" ? (first.text ?? "") : "";
}

describe("chat-blocks", () => {
  it("sanitizes whitespace and control characters and enforces MAX_BLOCKS_PER_TURN", async () => {
    const { tool, blocks } = makeHarness({ channel: "coach" });
    for (let i = 1; i <= 4; i++) {
      const res = await tool.run({
        block: {
          kind: "callout",
          label: `  Note\x07  ${i} `,
          text: `  Line one\r\nLine two  `,
        },
      });
      expect(res.isError).toBeUndefined();
      expect(firstText(res)).toBe(`Queued callout block (${i}/4).`);
    }
    expect(blocks).toHaveLength(4);
    expect(blocks[0]).toEqual({
      kind: "callout",
      label: "Note 1",
      text: "Line one\nLine two",
    });

    const fifth = await tool.run({
      block: { kind: "callout", text: "One too many" },
    });
    expect(fifth.isError).toBe(true);
    expect(firstText(fifth)).toContain("At most 4 blocks");
    expect(blocks).toHaveLength(4);
  });

  it("rejects invalid schema inputs before queueing", async () => {
    const { tool, blocks } = makeHarness({ channel: "coach" });
    const bad = await tool.run({
      block: {
        kind: "diagram",
        layout: "flow",
        nodes: [
          { id: "a", label: "Client" },
          { id: "b", label: "Server" },
        ],
        edges: [{ from: "a", to: "missing" }],
      },
    });
    expect(bad.isError).toBe(true);
    expect(firstText(bad)).toContain("Unknown node id");
    expect(blocks).toHaveLength(0);
  });

  it("refuses diagram and kv on hint turns while allowing options, callout, and anchor", async () => {
    const { tool, blocks } = makeHarness({
      meta: { kind: "request", request: "hint" },
    });

    const diag = await tool.run({
      block: {
        kind: "diagram",
        layout: "flow",
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [{ from: "a", to: "b" }],
      },
    });
    expect(diag.isError).toBe(true);

    const kv = await tool.run({
      block: { kind: "kv", rows: [{ key: "QPS", value: "10k" }] },
    });
    expect(kv.isError).toBe(true);

    const opts = await tool.run({
      block: {
        kind: "options",
        items: [{ label: "Push on write" }, { label: "Pull on read" }],
      },
    });
    expect(opts.isError).toBeUndefined();

    const anchor = await tool.run({
      block: {
        kind: "anchor",
        target: { kind: "board", elementId: "box-gw" },
        label: "API Gateway",
      },
    });
    expect(anchor.isError).toBeUndefined();
    expect(blocks.map((b) => b.kind)).toEqual(["options", "anchor"]);
  });

  it("applies hint guardrails when note_hint was called on a candidate turn and strips earlier diagram/kv blocks", async () => {
    const { tool } = makeHarness({
      meta: { kind: "candidate", candidateText: "Can I get a hint?" },
      hintNoted: true,
    });
    const kv = await tool.run({
      block: { kind: "kv", rows: [{ key: "Latency", value: "50 ms" }] },
    });
    expect(kv.isError).toBe(true);

    const stripped = stripDisallowedHintBlocks([
      {
        kind: "diagram",
        layout: "flow",
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [{ from: "a", to: "b" }],
      },
      { kind: "callout", text: "Keep this" },
      { kind: "kv", rows: [{ key: "k", value: "v" }] },
      { kind: "options", items: [{ label: "One" }, { label: "Two" }] },
    ]);
    expect(stripped.map((b) => b.kind)).toEqual(["callout", "options"]);
  });

  it("refuses options and kv on 'I'm stuck' turns while allowing diagram, callout, and anchor", async () => {
    const { tool, blocks } = makeHarness({
      meta: { kind: "request", request: "stuck" },
    });

    const opts = await tool.run({
      block: { kind: "options", items: [{ label: "A" }, { label: "B" }] },
    });
    expect(opts.isError).toBe(true);

    const kv = await tool.run({
      block: { kind: "kv", rows: [{ key: "Write QPS", value: "5k" }] },
    });
    expect(kv.isError).toBe(true);

    const diag = await tool.run({
      block: {
        kind: "diagram",
        layout: "flow",
        nodes: [
          { id: "c", label: "Client" },
          { id: "s", label: "Service" },
          { id: "db", label: "Store" },
        ],
        edges: [
          { from: "c", to: "s" },
          { from: "s", to: "db" },
        ],
      },
    });
    expect(diag.isError).toBeUndefined();

    const callout = await tool.run({
      block: { kind: "callout", text: "Redo the step in your own words." },
    });
    expect(callout.isError).toBeUndefined();
    expect(blocks.map((b) => b.kind)).toEqual(["diagram", "callout"]);
  });

  it("refuses all blocks on count-only step checks, including anchors into another count-only step, while allowing hints and clock offers", async () => {
    const countCheck = makeHarness({
      meta: { kind: "request", request: "feedback" },
      phase: "requirements",
      countOnlyPhases: ["requirements"],
    });
    const refused = await countCheck.tool.run({
      block: { kind: "callout", text: "Check your latency target." },
    });
    expect(refused.isError).toBe(true);
    expect(firstText(refused)).toContain("only a count");

    const crossStep = makeHarness({
      meta: { kind: "request", request: "feedback" },
      phase: "design",
      countOnlyPhases: ["requirements"],
    });
    const crossAnchor = await crossStep.tool.run({
      block: {
        kind: "anchor",
        target: { kind: "board", elementId: "box-req" },
        label: "Requirements box",
      },
    });
    expect(crossAnchor.isError).toBe(true);

    const designAnchor = await crossStep.tool.run({
      block: {
        kind: "anchor",
        target: { kind: "board", elementId: "box-gw" },
        label: "API Gateway",
      },
    });
    expect(designAnchor.isError).toBeUndefined();

    const hintOnCountStep = makeHarness({
      meta: { kind: "request", request: "hint" },
      phase: "requirements",
      countOnlyPhases: ["requirements"],
    });
    const h3Options = await hintOnCountStep.tool.run({
      block: { kind: "options", items: [{ label: "Option A" }, { label: "Option B" }] },
    });
    expect(h3Options.isError).toBeUndefined();

    const clockOnCountStep = makeHarness({
      meta: { kind: "clock", checkpoint: "phase_over" },
      phase: "requirements",
      countOnlyPhases: ["requirements"],
    });
    const moveOn = await clockOnCountStep.tool.run({
      block: { kind: "options", items: [{ label: "Move on" }, { label: "Keep going here" }] },
    });
    expect(moveOn.isError).toBeUndefined();
  });

  it("validates board anchor elementId against pinTargets and stepFrames", async () => {
    const { tool, blocks } = makeHarness({ channel: "coach" });

    const missing = await tool.run({
      block: {
        kind: "anchor",
        target: { kind: "board", elementId: "does-not-exist" },
        label: "Missing box",
      },
    });
    expect(missing.isError).toBe(true);
    expect(firstText(missing)).toContain("view_whiteboard");

    const onShape = await tool.run({
      block: {
        kind: "anchor",
        target: { kind: "board", elementId: "box-gw" },
        label: "API Gateway",
      },
    });
    expect(onShape.isError).toBeUndefined();

    const onFrame = await tool.run({
      block: {
        kind: "anchor",
        target: { kind: "board", elementId: "f-design" },
        label: "High-level design frame",
      },
    });
    expect(onFrame.isError).toBeUndefined();
    expect(blocks).toHaveLength(2);
  });

  it("validates code anchor track, non-empty code, and line bounds", async () => {
    const hld = makeHarness({ channel: "coach", track: "hld", code: "int main() {}\n" });
    const hldCode = await hld.tool.run({
      block: { kind: "anchor", target: { kind: "code", line: 1 }, label: "main" },
    });
    expect(hldCode.isError).toBe(true);
    expect(firstText(hldCode)).toContain("LLD");

    const emptyLld = makeHarness({ channel: "coach", track: "lld", code: "   \n  " });
    const emptyRes = await emptyLld.tool.run({
      block: { kind: "anchor", target: { kind: "code", line: 1 }, label: "main" },
    });
    expect(emptyRes.isError).toBe(true);
    expect(firstText(emptyRes)).toContain("empty");

    const lld = makeHarness({
      channel: "coach",
      track: "lld",
      code: "#include <mutex>\nstruct Pool {\n  std::mutex mu;\n};",
    });
    const outOfRange = await lld.tool.run({
      block: { kind: "anchor", target: { kind: "code", line: 2, endLine: 5 }, label: "Pool" },
    });
    expect(outOfRange.isError).toBe(true);
    expect(firstText(outOfRange)).toContain("4 lines");

    const valid = await lld.tool.run({
      block: { kind: "anchor", target: { kind: "code", line: 2, endLine: 4 }, label: "Pool::mu" },
    });
    expect(valid.isError).toBeUndefined();
    expect(lld.blocks).toHaveLength(1);
  });

  it("detects silent-only replies without matching prose or empty replies", () => {
    expect(isSilentReply("<silent/>")).toBe(true);
    expect(isSilentReply("  <silent /> \n")).toBe(true);
    expect(isSilentReply("<SILENT/><silent/>")).toBe(true);
    expect(isSilentReply("")).toBe(false);
    expect(isSilentReply("   ")).toBe(false);
    expect(isSilentReply("Carry on. <silent/>")).toBe(false);
  });
});
