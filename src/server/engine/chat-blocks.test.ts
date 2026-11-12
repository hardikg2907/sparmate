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
  hintLevel?: 1 | 2 | 3 | null;
  phase?: string;
  countOnlyPhases?: string[];
  countOnlyVerdictThisTurn?: boolean | (() => boolean);
  boardElements?: Record<string, unknown>[];
  code?: string;
  readCode?: () => Promise<string> | string;
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
    hintLevelThisTurn: () => opts.hintLevel ?? null,
    currentPhase: () => opts.phase ?? "requirements",
    isCountOnly: (phase) => countOnly.has(phase),
    countOnlyVerdictThisTurn: () => (typeof opts.countOnlyVerdictThisTurn === "function" ? opts.countOnlyVerdictThisTurn() : (opts.countOnlyVerdictThisTurn ?? false)),
    boardElements: () => opts.boardElements ?? SAMPLE_BOARD,
    readCode: opts.readCode ?? (() => opts.code ?? ""),
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

  it("enforces MAX_BLOCKS_PER_TURN across concurrent code-anchor calls awaiting readCode()", async () => {
    const { tool, blocks } = makeHarness({
      channel: "coach",
      track: "lld",
      readCode: async () => {
        await new Promise((r) => setTimeout(r, 5));
        return "int a = 1;\nint b = 2;\nint c = 3;\nint d = 4;\nint e = 5;\n";
      },
    });
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((line) =>
        tool.run({
          block: { kind: "anchor", target: { kind: "code", line }, label: `L${line}` },
        }),
      ),
    );
    expect(blocks).toHaveLength(4);
    expect(results.filter((r) => !r.isError)).toHaveLength(4);
    const rejected = results.filter((r) => r.isError);
    expect(rejected).toHaveLength(1);
    expect(firstText(rejected[0]!)).toContain("At most 4 blocks");
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

  it("refuses diagram and kv on hint turns, refuses options on H1 and H2, and allows options on H3", async () => {
    for (const hintLevel of [1, 2] as const) {
      const lower = makeHarness({
        meta: { kind: "request", request: "hint" },
        hintLevel,
      });
      const opts = await lower.tool.run({
        block: { kind: "options", items: [{ label: "Push on write" }, { label: "Pull on read" }] },
      });
      expect(opts.isError).toBe(true);
      expect(firstText(opts)).toContain(`H${hintLevel}`);

      const callout = await lower.tool.run({
        block: { kind: "callout", text: "Check read amplification." },
      });
      expect(callout.isError).toBeUndefined();
      expect(lower.blocks.map((b) => b.kind)).toEqual(["callout"]);
    }

    const { tool, blocks } = makeHarness({
      meta: { kind: "request", request: "hint" },
      hintLevel: 3,
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

  it("applies hint guardrails when note_hint was called on a candidate turn and strips disallowed blocks by rung", async () => {
    const h2 = makeHarness({
      meta: { kind: "candidate", candidateText: "Can I get a hint?" },
      hintLevel: 2,
    });
    const kv = await h2.tool.run({
      block: { kind: "kv", rows: [{ key: "Latency", value: "50 ms" }] },
    });
    expect(kv.isError).toBe(true);
    const optsOnH2 = await h2.tool.run({
      block: { kind: "options", items: [{ label: "One" }, { label: "Two" }] },
    });
    expect(optsOnH2.isError).toBe(true);

    const sample: ChatBlock[] = [
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
    ];
    expect(stripDisallowedHintBlocks(sample, 1).map((b) => b.kind)).toEqual(["callout"]);
    expect(stripDisallowedHintBlocks(sample, 2).map((b) => b.kind)).toEqual(["callout"]);
    expect(stripDisallowedHintBlocks(sample, 3).map((b) => b.kind)).toEqual(["callout", "options"]);
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

  it("allows only options on phase_over and overtime clock turns and refuses blocks on all other clock checkpoints", async () => {
    for (const checkpoint of ["phase_over", "overtime"] as const) {
      const offer = makeHarness({
        meta: { kind: "clock", checkpoint },
        phase: "requirements",
        countOnlyPhases: ["requirements"],
      });
      const okOpts = await offer.tool.run({
        block: { kind: "options", items: [{ label: "Move on" }, { label: "Stay here" }] },
      });
      expect(okOpts.isError).toBeUndefined();

      for (const disallowed of [
        { kind: "callout" as const, text: "Check latency" },
        { kind: "anchor" as const, target: { kind: "board" as const, elementId: "box-req" }, label: "Req" },
        { kind: "kv" as const, rows: [{ key: "k", value: "v" }] },
      ]) {
        const res = await offer.tool.run({ block: disallowed });
        expect(res.isError).toBe(true);
      }
      expect(offer.blocks.map((b) => b.kind)).toEqual(["options"]);
    }

    for (const checkpoint of ["silence", "phase_end", "extension", "time_up"] as const) {
      const otherClock = makeHarness({
        meta: { kind: "clock", checkpoint },
        phase: "design",
      });
      const opts = await otherClock.tool.run({
        block: { kind: "options", items: [{ label: "A" }, { label: "B" }] },
      });
      const anchor = await otherClock.tool.run({
        block: { kind: "anchor", target: { kind: "board", elementId: "box-gw" }, label: "API Gateway" },
      });
      expect(opts.isError).toBe(true);
      expect(anchor.isError).toBe(true);
      expect(otherClock.blocks).toHaveLength(0);
    }
  });

  it("refuses all blocks on count-only steps even if note_hint ran mid-turn, and always refuses when countOnlyVerdictThisTurn is set", async () => {
    const countCheck = makeHarness({
      meta: { kind: "request", request: "feedback" },
      phase: "requirements",
      countOnlyPhases: ["requirements"],
      hintLevel: 3,
    });
    const refusedOnMidTurnHint = await countCheck.tool.run({
      block: { kind: "callout", text: "Check your latency target." },
    });
    expect(refusedOnMidTurnHint.isError).toBe(true);
    expect(firstText(refusedOnMidTurnHint)).toContain("only a count");

    const crossStepWithNoteHint = makeHarness({
      meta: { kind: "candidate", candidateText: "nudge me" },
      phase: "design",
      countOnlyPhases: ["requirements"],
      hintLevel: 1,
    });
    const crossAnchor = await crossStepWithNoteHint.tool.run({
      block: {
        kind: "anchor",
        target: { kind: "board", elementId: "box-req" },
        label: "Requirements box",
      },
    });
    expect(crossAnchor.isError).toBe(true);

    const designAnchor = await crossStepWithNoteHint.tool.run({
      block: {
        kind: "anchor",
        target: { kind: "board", elementId: "box-gw" },
        label: "API Gateway",
      },
    });
    expect(designAnchor.isError).toBeUndefined();

    const explicitHintOnCountStep = makeHarness({
      meta: { kind: "request", request: "hint" },
      phase: "requirements",
      countOnlyPhases: ["requirements"],
      hintLevel: 3,
    });
    const h3Options = await explicitHintOnCountStep.tool.run({
      block: { kind: "options", items: [{ label: "Option A" }, { label: "Option B" }] },
    });
    const hintAnchor = await explicitHintOnCountStep.tool.run({
      block: { kind: "anchor", target: { kind: "board", elementId: "box-req" }, label: "Requirements box" },
    });
    expect(h3Options.isError).toBeUndefined();
    expect(hintAnchor.isError).toBeUndefined();

    const verdictTurn = makeHarness({
      meta: { kind: "request", request: "hint" },
      phase: "requirements",
      hintLevel: 3,
      countOnlyVerdictThisTurn: true,
    });
    const refusedByVerdict = await verdictTurn.tool.run({
      block: { kind: "callout", text: "Should never attach after a count-only verdict" },
    });
    expect(refusedByVerdict.isError).toBe(true);

    let flippedDuringAwait = false;
    const asyncVerdictRace = makeHarness({
      track: "lld",
      meta: { kind: "request", request: "hint" },
      hintLevel: 1,
      countOnlyVerdictThisTurn: () => flippedDuringAwait,
      readCode: async () => {
        flippedDuringAwait = true;
        return "int a = 1;\n";
      },
    });
    const racedCodeAnchor = await asyncVerdictRace.tool.run({
      block: { kind: "anchor", target: { kind: "code", line: 1 }, label: "L1" },
    });
    expect(racedCodeAnchor.isError).toBe(true);
    expect(asyncVerdictRace.blocks).toHaveLength(0);
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

  it("validates code anchor track, non-empty code, and trailing-newline line bounds", async () => {
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

    const trailingNewline = makeHarness({
      channel: "coach",
      track: "lld",
      code: "int a = 1;\nint b = 2;\n",
    });
    const lineTwo = await trailingNewline.tool.run({
      block: { kind: "anchor", target: { kind: "code", line: 2 }, label: "int b" },
    });
    expect(lineTwo.isError).toBeUndefined();

    const lineThree = await trailingNewline.tool.run({
      block: { kind: "anchor", target: { kind: "code", line: 3 }, label: "past EOF" },
    });
    expect(lineThree.isError).toBe(true);
    expect(firstText(lineThree)).toContain("the file has 2 lines");
    expect(trailingNewline.blocks).toHaveLength(1);
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
