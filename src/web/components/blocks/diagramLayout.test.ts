import { describe, expect, it } from "vitest";
import type { FlowDiagramBlock, SequenceDiagramBlock } from "../../../shared/blocks";
import { lldDebrief } from "../../fixtures/rooms";
import { layoutFlowDiagram, layoutSequenceDiagram } from "./diagramLayout";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function actorSpacing(layout: ReturnType<typeof layoutSequenceDiagram>): number {
  if (layout.actors.length < 2) return 0;
  return layout.actors[1]!.cx - layout.actors[0]!.cx;
}

describe("layoutSequenceDiagram", () => {
  it("keeps 2-, 3-, and 4-actor sequence diagrams (including lldDebrief) within the 360px chat column", () => {
    const twoActor: SequenceDiagramBlock = {
      kind: "diagram",
      layout: "sequence",
      actors: [
        { id: "client", label: "Client" },
        { id: "api", label: "Redirect API" },
      ],
      steps: [
        { from: "client", to: "api", label: "GET /r/abc123" },
        { from: "api", to: "api", label: "validate code format" },
        { from: "api", to: "client", label: "302 Found + Location header", style: "dashed" },
      ],
    };

    const threeActor: SequenceDiagramBlock = {
      kind: "diagram",
      layout: "sequence",
      actors: [
        { id: "api", label: "API Server" },
        { id: "cache", label: "Redis Cache" },
        { id: "db", label: "Postgres DB" },
      ],
      steps: [
        { from: "api", to: "cache", label: "GET link:abc123" },
        { from: "cache", to: "api", label: "cache miss", style: "dashed" },
        { from: "api", to: "db", label: "SELECT long_url FROM links" },
        { from: "db", to: "db", label: "index lookup on pk" },
      ],
    };

    const fourActor: SequenceDiagramBlock = {
      kind: "diagram",
      layout: "sequence",
      actors: [
        { id: "c", label: "Caller" },
        { id: "g", label: "Gate" },
        { id: "l", label: "ParkingLot" },
        { id: "s", label: "SpotIndex" },
      ],
      steps: [
        { from: "c", to: "g", label: "enter(Car, 0)" },
        { from: "g", to: "l", label: "acquire lock & allocate" },
        { from: "l", to: "s", label: "lowestFreeSpot(Car)" },
        { from: "s", to: "s", label: "mark occupied" },
      ],
    };

    const lldCoachSeq = lldDebrief("debriefed")
      .transcript.flatMap((entry) => entry.blocks ?? [])
      .find((b): b is SequenceDiagramBlock => b.kind === "diagram" && b.layout === "sequence");
    expect(lldCoachSeq).toBeDefined();

    for (const block of [twoActor, threeActor, fourActor, lldCoachSeq!]) {
      const layout = layoutSequenceDiagram(block);
      expect(layout.width).toBeLessThanOrEqual(360);
      for (const actor of layout.actors) {
        expect(actor.x).toBeGreaterThanOrEqual(0);
        expect(actor.x + actor.width).toBeLessThanOrEqual(layout.width);
      }
      for (const step of layout.steps) {
        expect(step.label.x).toBeGreaterThanOrEqual(0);
        expect(step.label.x + step.label.width).toBeLessThanOrEqual(layout.width);
      }
    }
  });

  it("shrinks actor center-to-center spacing strictly monotonically from 2 through 6 actors", () => {
    const counts = [2, 3, 4, 5, 6] as const;
    const layouts = counts.map((n) => {
      const actors = Array.from({ length: n }, (_, i) => ({ id: `a${i}`, label: `Actor ${i + 1}` }));
      return layoutSequenceDiagram({
        kind: "diagram",
        layout: "sequence",
        actors,
        steps: [{ from: "a0", to: "a1", label: "request(id)" }],
      });
    });

    for (let i = 0; i < layouts.length - 1; i++) {
      const wider = layouts[i]!;
      const narrower = layouts[i + 1]!;
      expect(actorSpacing(wider)).toBeGreaterThan(actorSpacing(narrower));
      expect(wider.actors[0]!.width).toBeGreaterThan(narrower.actors[0]!.width);
    }
  });

  it("never shrinks 2-actor spacing below its 156px baseSpacing when step labels are long", () => {
    const shortLabels = layoutSequenceDiagram({
      kind: "diagram",
      layout: "sequence",
      actors: [
        { id: "a", label: "Service A" },
        { id: "b", label: "Service B" },
      ],
      steps: [{ from: "a", to: "b", label: "ping" }],
    });

    const longLabels = layoutSequenceDiagram({
      kind: "diagram",
      layout: "sequence",
      actors: [
        { id: "a", label: "Service A" },
        { id: "b", label: "Service B" },
      ],
      steps: [
        {
          from: "a",
          to: "b",
          label: "SELECT code, long_url, owner_id, expires_at FROM links WHERE code = $1",
        },
      ],
    });

    expect(actorSpacing(shortLabels)).toBe(156);
    expect(actorSpacing(longLabels)).toBeGreaterThanOrEqual(156);
    expect(actorSpacing(longLabels)).toBeGreaterThanOrEqual(actorSpacing(shortLabels));
    expect(longLabels.width).toBeLessThanOrEqual(360);

    const longStepLabel = "SELECT code, long_url, owner_id, expires_at FROM links WHERE code = $1";
    const stepPill = longLabels.steps[0]!.label;
    expect(stepPill.lines.join(" ")).toContain("…");
    expect(stepPill.fullText).toBe(longStepLabel);
  });
});

describe("layoutFlowDiagram", () => {
  it("places a skip-rank edge label ('direct' on a -> c across a -> b -> c) with zero overlap against every node", () => {
    const block: FlowDiagramBlock = {
      kind: "diagram",
      layout: "flow",
      title: "Cache bypass",
      nodes: [
        { id: "a", label: "Client" },
        { id: "b", label: "Redis Cache", detail: "Hot set" },
        { id: "c", label: "Postgres", detail: "Primary" },
      ],
      edges: [
        { from: "a", to: "b", label: "lookup" },
        { from: "b", to: "c", label: "miss" },
        { from: "a", to: "c", label: "direct" },
      ],
    };

    const layout = layoutFlowDiagram(block);
    const directEdge = layout.edges.find((edge) => edge.from === "a" && edge.to === "c");
    expect(directEdge?.label).not.toBeNull();

    for (const node of layout.nodes) {
      expect(rectsOverlap(directEdge!.label!, node)).toBe(false);
    }

    const labels = layout.edges.map((e) => e.label).filter((l): l is NonNullable<typeof l> => l !== null);
    for (const label of labels) {
      expect(label.x).toBeGreaterThanOrEqual(0);
      expect(label.y).toBeGreaterThanOrEqual(0);
      expect(label.x + label.width).toBeLessThanOrEqual(layout.width);
      expect(label.y + label.height).toBeLessThanOrEqual(layout.height);
      for (const node of layout.nodes) {
        expect(rectsOverlap(label, node)).toBe(false);
      }
    }
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        expect(rectsOverlap(labels[i]!, labels[j]!)).toBe(false);
      }
    }
  });

  it("keeps multi-skip and cycle-closing back-edge labels clear of all nodes and inside viewBox bounds", () => {
    const block: FlowDiagramBlock = {
      kind: "diagram",
      layout: "flow",
      nodes: [
        { id: "a", label: "Ingress" },
        { id: "b", label: "Limiter" },
        { id: "c", label: "Worker" },
        { id: "d", label: "Store" },
      ],
      edges: [
        { from: "a", to: "d", label: "fast path" },
        { from: "a", to: "b", label: "check" },
        { from: "b", to: "c", label: "enqueue" },
        { from: "c", to: "d", label: "persist" },
        { from: "d", to: "b", label: "retry", style: "dashed" },
      ],
    };

    const layout = layoutFlowDiagram(block);
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x + node.width).toBeLessThanOrEqual(layout.width);
    }
    for (const edge of layout.edges) {
      if (!edge.label) continue;
      expect(edge.label.x).toBeGreaterThanOrEqual(0);
      expect(edge.label.x + edge.label.width).toBeLessThanOrEqual(layout.width);
      for (const node of layout.nodes) {
        expect(rectsOverlap(edge.label, node)).toBe(false);
      }
    }

    const longFlowLabel = "INSERT INTO urls (code, long_url, created_at) ON CONFLICT DO NOTHING";
    const truncatedFlow = layoutFlowDiagram({
      kind: "diagram",
      layout: "flow",
      nodes: [
        { id: "api", label: "Write API" },
        { id: "db", label: "Postgres" },
      ],
      edges: [{ from: "api", to: "db", label: longFlowLabel }],
    });
    const flowPill = truncatedFlow.edges[0]!.label!;
    expect(flowPill.lines.join(" ")).toContain("…");
    expect(flowPill.fullText).toBe(longFlowLabel);
  });

  it("wraps long details instead of cutting them, and widens boxes when the pane has room", () => {
    const detail = "Msgs DB, keyed (conversationId, seq) so reads stay ordered";
    const block: FlowDiagramBlock = {
      kind: "diagram",
      layout: "flow",
      nodes: [
        { id: "a", label: "Message stored", detail },
        { id: "b", label: "Fan-out worker" },
      ],
      edges: [{ from: "a", to: "b" }],
    };

    const narrow = layoutFlowDiagram(block);
    const narrowNode = narrow.nodes[0]!;
    expect(narrowNode.detailLines.length).toBeGreaterThan(1);
    expect(narrowNode.detailLines.join(" ")).toBe(detail);
    expect(narrowNode.fullText).toContain(detail);

    const wide = layoutFlowDiagram(block, 900);
    const wideNode = wide.nodes[0]!;
    expect(wideNode.width).toBeGreaterThan(narrowNode.width);
    expect(wideNode.detailLines.length).toBeLessThan(narrowNode.detailLines.length);
    expect(wide.width).toBeLessThanOrEqual(900);

    const withBackEdge = layoutFlowDiagram(
      {
        ...block,
        nodes: [...block.nodes, { id: "c", label: "Deliver" }],
        edges: [...block.edges, { from: "b", to: "c" }, { from: "c", to: "a", label: "retry on failure" }],
      },
      400,
    );
    expect(withBackEdge.width).toBeLessThanOrEqual(400);
  });
});
