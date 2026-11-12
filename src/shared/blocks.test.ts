import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ChatBlockSchema, blocksToPlainText, blocksToSpeechText, candidateOwnText, matchUnsettledOptionText, sanitizeChatBlock, stripOptionText, type ChatBlock } from "./blocks";

describe("ChatBlockSchema", () => {
  it("generates a clean JSON Schema for MCP tool registration", () => {
    const schema = z.toJSONSchema(z.strictObject({ block: ChatBlockSchema }));
    expect(schema.type).toBe("object");
  });

  it("validates options, flow diagrams, sequence diagrams, anchors, callouts and kv blocks", () => {
    const samples: ChatBlock[] = [
      {
        kind: "options",
        action: "send",
        items: [
          { label: "Consistent hashing", note: "Minimal key movement on resize" },
          { label: "Range shards", note: "Fast range scans, risk of hot spots", reply: "Let's use range shards." },
        ],
      },
      {
        kind: "diagram",
        layout: "flow",
        title: "Read path",
        nodes: [
          { id: "client", label: "Client" },
          { id: "cache", label: "Redis", detail: "p99 < 2ms" },
          { id: "db", label: "Postgres" },
        ],
        edges: [
          { from: "client", to: "cache", label: "GET /slug" },
          { from: "cache", to: "db", label: "miss", style: "dashed" },
        ],
      },
      {
        kind: "diagram",
        layout: "sequence",
        title: "Lease renewal",
        actors: [
          { id: "w", label: "Worker" },
          { id: "s", label: "Store" },
        ],
        steps: [
          { from: "w", to: "s", label: "CAS(owner, ttl)" },
          { from: "s", to: "w", label: "200 OK", style: "dashed" },
        ],
      },
      {
        kind: "anchor",
        target: { kind: "board", elementId: "redis" },
        label: "Redis cache node",
        note: "Missing TTL and stampede guard",
      },
      {
        kind: "anchor",
        target: { kind: "code", line: 42, endLine: 48 },
        label: "Ticket::close()",
        note: "Race when two exits close the same ticket",
      },
      {
        kind: "callout",
        label: "Scenario",
        text: "Traffic spikes 10x right as a hot key expires.",
      },
      {
        kind: "kv",
        rows: [
          { key: "Peak reads", value: "50k RPS" },
          { key: "Peak writes", value: "500 RPS" },
        ],
      },
    ];

    for (const sample of samples) {
      const parsed = ChatBlockSchema.safeParse(sample);
      expect(parsed.success).toBe(true);
    }
  });

  it("rejects duplicate node IDs, dangling edges, self-edges and invalid code line ranges", () => {
    expect(
      ChatBlockSchema.safeParse({
        kind: "diagram",
        layout: "flow",
        nodes: [
          { id: "a", label: "A" },
          { id: "a", label: "A2" },
        ],
        edges: [{ from: "a", to: "a" }],
      }).success,
    ).toBe(false);

    expect(
      ChatBlockSchema.safeParse({
        kind: "diagram",
        layout: "flow",
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [{ from: "a", to: "missing" }],
      }).success,
    ).toBe(false);

    expect(
      ChatBlockSchema.safeParse({
        kind: "diagram",
        layout: "sequence",
        actors: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        steps: [{ from: "a", to: "ghost", label: "ping" }],
      }).success,
    ).toBe(false);

    expect(
      ChatBlockSchema.safeParse({
        kind: "anchor",
        target: { kind: "code", line: 20, endLine: 10 },
        label: "Backwards range",
      }).success,
    ).toBe(false);
  });

  it("sanitizes control characters and collapses single-line whitespace", () => {
    const cleaned = sanitizeChatBlock({
      kind: "callout",
      label: "  Constraint\x07\n ",
      text: "  Line one\x00\r\nLine two  ",
    });
    expect(cleaned).toEqual({
      kind: "callout",
      label: "Constraint",
      text: "Line one\nLine two",
    });
  });

  it("renders deterministic plain text and concise speech text", () => {
    const blocks: ChatBlock[] = [
      {
        kind: "callout",
        label: "Constraint",
        text: "Redirect latency must stay under 20 ms at p99",
      },
      {
        kind: "kv",
        rows: [
          { key: "Read : write", value: "100 : 1" },
          { key: "Storage (5 yr)", value: "1.8 TB" },
        ],
      },
      {
        kind: "options",
        items: [
          { label: "Base62 counter", note: "Short, predictable unless obfuscated" },
          { label: "Random 7-char slug", note: "Needs collision retry" },
        ],
      },
    ];

    const plain = blocksToPlainText(blocks);
    expect(plain).toContain("Constraint: Redirect latency must stay under 20 ms at p99");
    expect(plain).toContain("- Read : write: 100 : 1");
    expect(plain).toContain("Options:\n- Base62 counter — Short, predictable unless obfuscated");

    const speech = blocksToSpeechText(blocks);
    expect(speech).toBe("Constraint. Redirect latency must stay under 20 ms at p99. Read : write: 100 : 1. Storage (5 yr): 1.8 TB. Options: Base62 counter, Random 7-char slug.");
  });

  it("matches unsettled option reply/label text and strips guide words while keeping candidate extensions", () => {
    const optionsBlock: ChatBlock = {
      kind: "options",
      action: "prefill",
      items: [{ label: "Yes" }, { label: "Cache hot lookups", reply: "I'd cache hot lookups in Redis because" }],
    };

    const unsettled = [
      { channel: "interview", role: "interviewer", blocks: [optionsBlock] },
      { channel: "interview", role: "system" },
    ];
    expect(matchUnsettledOptionText(unsettled, "interview", "Yes")).toBe("Yes");
    expect(matchUnsettledOptionText(unsettled, "interview", "Yesterday we saw spikes")).toBeUndefined();

    const extended = "I'd cache hot lookups in Redis because p99 redirects must stay under 20 ms.";
    const matched = matchUnsettledOptionText(unsettled, "interview", extended);
    expect(matched).toBe("I'd cache hot lookups in Redis because");
    expect(candidateOwnText({ text: extended, optionText: matched })).toBe("p99 redirects must stay under 20 ms.");
    expect(stripOptionText("I'd cache hot lookups in Redis because", matched)).toBe("");

    const settledByAssistant = [...unsettled, { channel: "interview", role: "interviewer" }];
    expect(matchUnsettledOptionText(settledByAssistant, "interview", "Yes")).toBeUndefined();

    const settledByCandidate = [...unsettled, { channel: "interview", role: "candidate" }];
    expect(matchUnsettledOptionText(settledByCandidate, "interview", "Yes")).toBeUndefined();
  });
});
