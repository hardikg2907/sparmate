import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ChatBlockSchema, blocksToPlainText, blocksToSpeechText, candidateOwnText, matchUnsettledOptionTexts, sanitizeChatBlock, stripOptionTexts, type ChatBlock } from "./blocks";

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
    expect(matchUnsettledOptionTexts(unsettled, "interview", "Yes")).toEqual(["Yes"]);
    expect(matchUnsettledOptionTexts(unsettled, "interview", "Yesterday we saw spikes")).toBeUndefined();

    const extended = "I'd cache hot lookups in Redis because p99 redirects must stay under 20 ms.";
    const matched = matchUnsettledOptionTexts(unsettled, "interview", extended);
    expect(matched).toEqual(["I'd cache hot lookups in Redis because"]);
    expect(candidateOwnText({ text: extended, optionTexts: matched })).toBe("p99 redirects must stay under 20 ms.");
    expect(stripOptionTexts("I'd cache hot lookups in Redis because", matched)).toBe("");

    const settledByAssistant = [...unsettled, { channel: "interview", role: "interviewer" }];
    expect(matchUnsettledOptionTexts(settledByAssistant, "interview", "Yes")).toBeUndefined();

    const settledByCandidate = [...unsettled, { channel: "interview", role: "candidate" }];
    expect(matchUnsettledOptionTexts(settledByCandidate, "interview", "Yes")).toBeUndefined();
  });

  it("matches a send option only as the whole message, so typed words that contain a label stay the candidate's", () => {
    const send = (labels: string[]): { channel: string; role: string; blocks: ChatBlock[] }[] => [
      { channel: "interview", role: "interviewer", blocks: [{ kind: "options", items: labels.map((label) => ({ label })) }] },
    ];
    expect(matchUnsettledOptionTexts(send(["Redis", "Postgres"]), "interview", "I'd put Redis in front of Postgres for hot keys")).toBeUndefined();
    expect(matchUnsettledOptionTexts(send(["Yes", "No"]), "interview", "No, I'd shard by user id")).toBeUndefined();
    expect(matchUnsettledOptionTexts(send(["Consistent hashing", "Range"]), "interview", "consistent hashing with virtual nodes")).toBeUndefined();
    expect(matchUnsettledOptionTexts(send(["Redis", "Postgres"]), "interview", "  postgres ")).toEqual(["Postgres"]);
  });

  it("matches a lightly edited prefill and strips it from the original text", () => {
    const entries: { channel: string; role: string; blocks: ChatBlock[] }[] = [
      {
        channel: "coach",
        role: "coach",
        blocks: [{ kind: "options", action: "prefill", items: [{ label: "Cache", reply: "I'd cache hot lookups because" }, { label: "Queue" }] }],
      },
    ];
    const text = "i'd  cache hot\nlookups because reads dominate 100:1.";
    const matched = matchUnsettledOptionTexts(entries, "coach", text);
    expect(matched).toEqual(["I'd cache hot lookups because"]);
    expect(candidateOwnText({ text, optionTexts: matched })).toBe("reads dominate 100:1.");
  });

  it("treats a starter sent with only punctuation added as no words of the candidate's own", () => {
    expect(stripOptionTexts("I'd cache hot lookups because .", ["I'd cache hot lookups because"])).toBe("");
    expect(stripOptionTexts("I'd cache hot lookups because — !", ["I'd cache hot lookups because"])).toBe("");
  });

  it("finds and strips every prefill starter in one message", () => {
    const entries: { channel: string; role: string; blocks: ChatBlock[] }[] = [
      {
        channel: "interview",
        role: "interviewer",
        blocks: [
          {
            kind: "options",
            action: "prefill",
            items: [
              { label: "A", reply: "I'd shard by user id because" },
              { label: "B", reply: "I'd shard by region because" },
            ],
          },
        ],
      },
    ];
    const text = "Writes are hot. I'd shard by user id because I'd shard by region because";
    const matched = matchUnsettledOptionTexts(entries, "interview", text);
    expect(matched).toEqual(expect.arrayContaining(["I'd shard by user id because", "I'd shard by region because"]));
    expect(matched).toHaveLength(2);
    expect(candidateOwnText({ text, optionTexts: matched })).toBe("Writes are hot.");
  });

  it("matches a bare prefill label only as the whole message", () => {
    const entries: { channel: string; role: string; blocks: ChatBlock[] }[] = [
      { channel: "coach", role: "coach", blocks: [{ kind: "options", action: "prefill", items: [{ label: "Queue" }, { label: "Cache" }] }] },
    ];
    expect(matchUnsettledOptionTexts(entries, "coach", "Put a queue in front")).toBeUndefined();
    expect(matchUnsettledOptionTexts(entries, "coach", "queue")).toEqual(["Queue"]);
  });

  it("strips starters across whitespace runs and when two sit side by side", () => {
    expect(stripOptionTexts("I'd   shard\n\nby user id because hot rows", ["I'd shard by user id because"])).toBe("hot rows");
    expect(stripOptionTexts("Start: I'd shard by user id becauseI'd shard by region because end", ["I'd shard by user id because", "I'd shard by region because"])).toBe(
      "Start: I'd shard by user id becauseI'd shard by region because end",
    );
    expect(stripOptionTexts("Start: I'd shard by user id because I'd shard by region because end", ["I'd shard by user id because", "I'd shard by region because"])).toBe(
      "Start: end",
    );
  });

  it("leaves a message without option texts untouched", () => {
    expect(candidateOwnText({ text: "  . " })).toBe("  . ");
    expect(stripOptionTexts("Fan-out on read", ["Fan-out on write"])).toBe("Fan-out on read");
  });
});
