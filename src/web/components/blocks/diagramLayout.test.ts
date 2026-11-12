import { describe, expect, it } from "vitest";
import { layoutFlowDiagram, layoutSequenceDiagram, wrapDiagramText, type PositionedFlowNode } from "./diagramLayout";

function boxesOverlap(a: PositionedFlowNode, b: PositionedFlowNode): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

describe("wrapDiagramText", () => {
  it("wraps words across lines and truncates overflow on the final line", () => {
    expect(wrapDiagramText("Stateless redirect service tier", 18, 2)).toEqual(["Stateless redirect", "service tier"]);
    const clamped = wrapDiagramText("A very long single description that exceeds two short lines easily", 16, 2);
    expect(clamped).toHaveLength(2);
    expect(clamped[1]?.endsWith("…")).toBe(true);
  });

  it("splits unbroken tokens that exceed maxChars", () => {
    const lines = wrapDiagramText("supercalifragilisticexpialidocious", 12, 2);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveLength(12);
  });
});

describe("layoutFlowDiagram", () => {
  it("lays out a linear chain top-to-bottom with monotonic y positions", () => {
    const layout = layoutFlowDiagram({
      kind: "diagram",
      layout: "flow",
      title: "Read path",
      nodes: [
        { id: "client", label: "Client" },
        { id: "cdn", label: "CDN", detail: "edge PoP" },
        { id: "origin", label: "Redirect service" },
      ],
      edges: [
        { from: "client", to: "cdn", label: "GET /abc" },
        { from: "cdn", to: "origin", label: "miss", style: "dashed" },
      ],
    });

    expect(Number.isFinite(layout.width)).toBe(true);
    expect(Number.isFinite(layout.height)).toBe(true);
    expect(layout.nodes).toHaveLength(3);
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    const client = byId.get("client")!;
    const cdn = byId.get("cdn")!;
    const origin = byId.get("origin")!;
    expect(client.y).toBeLessThan(cdn.y);
    expect(cdn.y).toBeLessThan(origin.y);
    expect(layout.edges[1]?.dashed).toBe(true);
    expect(layout.edges[0]?.label?.lines).toEqual(["GET /abc"]);
    expect(layout.ariaLabel).toContain("Read path");
  });

  it("places branching and merging ranks without overlapping nodes or edge pills", () => {
    const layout = layoutFlowDiagram({
      kind: "diagram",
      layout: "flow",
      nodes: [
        { id: "gw", label: "API Gateway" },
        { id: "cache", label: "Redis" },
        { id: "db", label: "Postgres" },
        { id: "resp", label: "302 Response" },
      ],
      edges: [
        { from: "gw", to: "cache", label: "lookup" },
        { from: "gw", to: "db", label: "fallback", style: "dashed" },
        { from: "cache", to: "resp", label: "hit" },
        { from: "db", to: "resp", label: "row" },
      ],
    });

    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        expect(boxesOverlap(layout.nodes[i]!, layout.nodes[j]!)).toBe(false);
      }
    }
    const pills = layout.edges.map((e) => e.label).filter((l): l is NonNullable<typeof l> => l !== null);
    expect(pills).toHaveLength(4);
    for (let i = 0; i < pills.length; i++) {
      for (let j = i + 1; j < pills.length; j++) {
        const a = pills[i]!;
        const b = pills[j]!;
        const overlap = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
        expect(overlap).toBe(false);
      }
    }
  });

  it("wraps ranks wider than 3 nodes into compact rows fitting the chat column", () => {
    const layout = layoutFlowDiagram({
      kind: "diagram",
      layout: "flow",
      nodes: [
        { id: "router", label: "Shard router" },
        { id: "s1", label: "Shard 1" },
        { id: "s2", label: "Shard 2" },
        { id: "s3", label: "Shard 3" },
        { id: "s4", label: "Shard 4" },
        { id: "s5", label: "Shard 5" },
      ],
      edges: [
        { from: "router", to: "s1" },
        { from: "router", to: "s2" },
        { from: "router", to: "s3" },
        { from: "router", to: "s4" },
        { from: "router", to: "s5" },
      ],
    });

    expect(layout.width).toBeLessThanOrEqual(340);
    for (const node of layout.nodes) {
      expect(node.col).toBeLessThan(3);
    }
    const shardRows = new Set(layout.nodes.filter((n) => n.id !== "router").map((n) => n.row));
    expect(shardRows.size).toBe(2);
    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        expect(boxesOverlap(layout.nodes[i]!, layout.nodes[j]!)).toBe(false);
      }
    }
  });

  it("breaks 2-node and 3-node cycles cleanly with finite coordinates and back-edge arcs", () => {
    const twoCycle = layoutFlowDiagram({
      kind: "diagram",
      layout: "flow",
      nodes: [
        { id: "a", label: "Worker" },
        { id: "b", label: "Queue" },
      ],
      edges: [
        { from: "a", to: "b", label: "enqueue" },
        { from: "b", to: "a", label: "retry", style: "dashed" },
      ],
    });
    expect(Number.isFinite(twoCycle.width)).toBe(true);
    expect(Number.isFinite(twoCycle.height)).toBe(true);
    expect(twoCycle.edges.some((e) => e.backEdge)).toBe(true);

    const threeCycle = layoutFlowDiagram({
      kind: "diagram",
      layout: "flow",
      nodes: [
        { id: "n1", label: "Leader" },
        { id: "n2", label: "Follower" },
        { id: "n3", label: "Monitor" },
      ],
      edges: [
        { from: "n1", to: "n2" },
        { from: "n2", to: "n3" },
        { from: "n3", to: "n1" },
      ],
    });
    expect(Number.isFinite(threeCycle.width)).toBe(true);
    expect(Number.isFinite(threeCycle.height)).toBe(true);
    expect(threeCycle.edges.some((e) => e.backEdge)).toBe(true);
  });
});

describe("layoutSequenceDiagram", () => {
  it("positions actor lifelines left-to-right and supports dashed replies and self-steps", () => {
    const layout = layoutSequenceDiagram({
      kind: "diagram",
      layout: "sequence",
      title: "Ticket exit check",
      actors: [
        { id: "caller", label: "Caller" },
        { id: "lot", label: "ParkingLot" },
        { id: "store", label: "tickets_" },
      ],
      steps: [
        { from: "caller", to: "lot", label: "exit(99, 10)" },
        { from: "lot", to: "store", label: "find(99)" },
        { from: "lot", to: "lot", label: "guard missing ticket" },
        { from: "lot", to: "caller", label: "nullopt", style: "dashed" },
      ],
    });

    expect(layout.actors).toHaveLength(3);
    expect(layout.actors[0]!.cx).toBeLessThan(layout.actors[1]!.cx);
    expect(layout.actors[1]!.cx).toBeLessThan(layout.actors[2]!.cx);
    expect(layout.steps).toHaveLength(4);
    expect(layout.steps[2]?.self).toBe(true);
    expect(layout.steps[3]?.dashed).toBe(true);
    expect(layout.steps[0]!.label.y).toBeLessThan(layout.steps[3]!.label.y);
    for (const actor of layout.actors) {
      expect(actor.lifelineEndY).toBeGreaterThan(layout.steps[3]!.label.y);
    }
  });
});
