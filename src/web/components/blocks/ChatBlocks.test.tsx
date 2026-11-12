import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatBlockSchema, MAX_BLOCKS_PER_TURN, type ChatBlock } from "../../../shared/blocks";
import { hldDebrief, hldRoom, lldDebrief } from "../../fixtures/rooms";
import { ChatBlocks } from "./ChatBlocks";

const noopChoose = () => true;

describe("ChatBlocks", () => {
  it("renders nothing when blocks array is empty and adjusts top margin for prose", () => {
    expect(renderToStaticMarkup(<ChatBlocks blocks={[]} settled={false} disabled={false} onChoose={noopChoose} />)).toBe("");

    const kv: ChatBlock = { kind: "kv", rows: [{ key: "Read QPS", value: "4,000/s" }] };
    const withProse = renderToStaticMarkup(<ChatBlocks blocks={[kv]} hasProse settled={false} disabled={false} onChoose={noopChoose} />);
    const blocksOnly = renderToStaticMarkup(<ChatBlocks blocks={[kv]} hasProse={false} settled={false} disabled={false} onChoose={noopChoose} />);

    expect(withProse).toContain("mt-2.5");
    expect(blocksOnly).toContain("mt-0.5");
  });

  it("renders unsettled options as buttons with action affordances and collapses when settled", () => {
    const sendOptions: ChatBlock = {
      kind: "options",
      items: [
        { label: "302 Found", note: "Keep every redirect observable", reply: "I choose 302 Found so we count clicks." },
        { label: "301 Moved Permanently", note: "Browser caches forever" },
      ],
    };

    const unsettledSend = renderToStaticMarkup(<ChatBlocks blocks={[sendOptions]} settled={false} disabled={false} onChoose={noopChoose} />);
    expect(unsettledSend).toContain("<button");
    expect(unsettledSend).toContain("↵");
    expect(unsettledSend).not.toContain("CHOOSE ONE");

    const prefillOptions: ChatBlock = { ...sendOptions, action: "prefill" };
    const unsettledPrefill = renderToStaticMarkup(<ChatBlocks blocks={[prefillOptions]} settled={false} disabled onChoose={noopChoose} />);
    expect(unsettledPrefill).toContain("✎");
    expect(unsettledPrefill).toContain("disabled");

    const settledHtml = renderToStaticMarkup(
      <ChatBlocks blocks={[sendOptions]} settled disabled={false} answeredText="I choose 302 Found so we count clicks." onChoose={noopChoose} />,
    );
    expect(settledHtml).not.toContain("<button");
    expect(settledHtml).toContain("Selected: ");
    expect(settledHtml).toContain("opacity-60");
  });

  it("renders board and code anchors as buttons when onAnchor is provided and static cards otherwise", () => {
    const anchors: ChatBlock[] = [
      { kind: "anchor", target: { kind: "board", elementId: "redis" }, label: "Redis cache", note: "Hot set" },
      { kind: "anchor", target: { kind: "code", line: 60, endLine: 65 }, label: "ParkingLot::exit" },
      { kind: "anchor", target: { kind: "code", line: 12 }, label: "Spot struct" },
    ];

    const interactive = renderToStaticMarkup(<ChatBlocks blocks={anchors} settled={false} disabled={false} onChoose={noopChoose} onAnchor={() => {}} />);
    expect(interactive).toContain("<button");
    expect(interactive).toContain("L60–65");
    expect(interactive).toContain("L12");
    expect(interactive).toContain("→");

    const passive = renderToStaticMarkup(<ChatBlocks blocks={anchors} settled={false} disabled={false} onChoose={noopChoose} />);
    expect(passive).not.toContain("<button");
    expect(passive).not.toContain("→");
  });

  it("renders callout markdown, kv definition lists, and flow/sequence SVG diagrams cleanly", () => {
    const blocks: ChatBlock[] = [
      { kind: "callout", label: "Invariant", text: "Use `tickets_.find(id)` before mutating `spots_`." },
      { kind: "callout", text: "Unlabelled note still renders cleanly." },
      {
        kind: "diagram",
        layout: "flow",
        title: "Redirect path",
        nodes: [
          { id: "c", label: "Client" },
          { id: "r", label: "Redis", detail: "TTL 24h" },
        ],
        edges: [{ from: "c", to: "r", label: "GET" }],
      },
      {
        kind: "diagram",
        layout: "sequence",
        actors: [
          { id: "a", label: "API" },
          { id: "db", label: "Postgres" },
        ],
        steps: [{ from: "a", to: "db", label: "SELECT url", style: "dashed" }],
      },
    ];

    const html = renderToStaticMarkup(<ChatBlocks blocks={blocks} settled={false} disabled={false} onChoose={noopChoose} />);
    expect(html).toContain("Invariant");
    expect(html).toContain("<code");
    expect(html).toContain("tickets_.find(id)");
    expect(html).toContain("<figcaption");
    expect(html).toContain("Redirect path");
    expect(html).toContain('role="img"');
    expect(html).toContain("TTL 24h");
    expect(html).toContain("SELECT url");
  });

  it("keeps interview room fixtures free of blocks while validating guided and debrief fixture blocks", () => {
    const interviewRoom = hldRoom("interview");
    expect(interviewRoom.transcript.some((entry) => (entry.blocks?.length ?? 0) > 0)).toBe(false);

    for (const session of [hldRoom("guided"), hldDebrief("debriefed"), lldDebrief("debriefed")]) {
      const withBlocks = session.transcript.filter((entry) => (entry.blocks?.length ?? 0) > 0);
      expect(withBlocks.length).toBeGreaterThan(0);
      for (const entry of withBlocks) {
        expect(entry.blocks!.length).toBeLessThanOrEqual(MAX_BLOCKS_PER_TURN);
        for (const block of entry.blocks!) {
          expect(ChatBlockSchema.safeParse(block).success).toBe(true);
        }
      }
    }
  });
});
