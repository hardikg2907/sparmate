import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BoardGraph } from "../types";
import { graphToText, sceneToGraph } from "./sceneToGraph";
import { type Element, arrow, boundText, deleted, flat, frame, freeText, freedraw, image, inGroup, polyline, rect, shape, withKind } from "./__fixtures__/scene";

const here = dirname(fileURLToPath(import.meta.url));

function labels(graph: BoardGraph): string[] {
  return graph.nodes.map((n) => n.label);
}

describe("rule 1: deleted elements", () => {
  it("drops deleted shapes, texts and arrows", () => {
    const scene = flat(
      rect("a", 100, 100, 160, 60, "Kept"),
      deleted(rect("gone", 400, 100, 160, 60, "Gone")),
      deleted(arrow("old", [260, 130], [400, 130])),
      deleted([freeText("t-gone", "deleted note", 100, 300)]),
      deleted([freedraw("d-gone", 0, 0)]),
    );
    const graph = sceneToGraph(scene);
    expect(labels(graph)).toEqual(["Kept"]);
    expect(graph.edges).toEqual([]);
    expect(graph.freeText).toEqual([]);
    expect(graph.opaque).toEqual([]);
  });

  it("treats a binding to a deleted shape as a missing binding", () => {
    const gone = rect("gone", 400, 100, 160, 60, "Gone");
    const a = rect("a", 100, 100, 160, 60, "A");
    const scene = flat(a, deleted(gone), arrow("e", [260, 130], [1000, 500], { from: a[0]!, to: gone[0]! }));
    const [edge] = sceneToGraph(scene).edges;
    expect(edge).toMatchObject({ from: "a", to: null, quality: "dangling" });
  });
});

describe("rule 2: groups collapse to one node", () => {
  it("makes a group with container shapes one node labelled with the joined text inside it", () => {
    const top = rect("r1", 100, 100, 160, 60, "Auth");
    const bottom = rect("r2", 100, 200, 160, 60, "Service");
    const scene = flat(inGroup([...top, ...bottom], "g1"));
    const graph = sceneToGraph(scene);
    expect(graph.nodes).toEqual([{ key: "g1", label: "Auth Service", kind: null, shape: "group", frame: null }]);
  });

  it("uses the outermost group as the node key", () => {
    const inner = inGroup(rect("r1", 100, 100, 160, 60, "One"), "inner", "outer");
    const sibling = inGroup(rect("r2", 300, 100, 160, 60, "Two"), "outer");
    const graph = sceneToGraph(flat(inner, sibling));
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]).toMatchObject({ key: "outer", label: "One Two", shape: "group" });
  });

  it("keeps two separate groups as two nodes and ungrouped shapes as their own nodes", () => {
    const graph = sceneToGraph(flat(inGroup(rect("a", 0, 0, 100, 50, "A"), "g1"), inGroup(rect("b", 300, 0, 100, 50, "B"), "g2"), rect("c", 600, 0, 100, 50, "C")));
    expect(graph.nodes.map((n) => [n.key, n.label])).toEqual([
      ["g1", "A"],
      ["g2", "B"],
      ["c", "C"],
    ]);
  });

  it("does not collapse a group that has no container shape; its texts stay free", () => {
    const scene = flat(inGroup([freeText("t1", "first note", 100, 100), freeText("t2", "second note", 100, 200)], "notes"));
    const graph = sceneToGraph(scene);
    expect(graph.nodes).toEqual([]);
    expect(graph.freeText.map((t) => t.text)).toEqual(["first note", "second note"]);
  });

  it("takes the node kind from a member of the group", () => {
    const parts = inGroup([...rect("r1", 100, 100, 160, 60, "Queue"), ...withKind(rect("r2", 100, 200, 160, 60), "queue")], "g1");
    expect(sceneToGraph(parts).nodes[0]).toMatchObject({ key: "g1", kind: "queue" });
  });

  it("collapses a library-style group whose label text is free and ignores the strokes inside it", () => {
    const scene = JSON.parse(readFileSync(join(here, "__fixtures__", "library-group.json"), "utf8")) as Element[];
    const graph = sceneToGraph(scene);
    expect(graph.nodes.map((n) => [n.key, n.label, n.shape])).toEqual([
      ["api", "API service", "rectangle"],
      ["grp-db", "Orders DB", "group"],
    ]);
    expect(graph.edges).toEqual([{ from: "api", to: "grp-db", label: "SQL", style: "solid", arrow: "forward", quality: "bound" }]);
    expect(graph.freeText).toEqual([]);
    expect(graph.opaque).toEqual([]);
    expect(graph.warnings).toEqual([]);
  });

  it("maps an arrow bound to a primitive inside a group onto the group's node", () => {
    const parts = inGroup([...shape("ellipse", "p1", 400, 100, 80, 40), ...shape("rectangle", "p2", 400, 140, 80, 60), freeText("lbl", "Store", 410, 210)], "icon");
    const client = rect("client", 100, 120, 120, 60, "Client");
    const scene = flat(client, parts, arrow("e", [220, 150], [400, 170], { from: client[0]!, to: parts[1] }));
    const graph = sceneToGraph(scene);
    expect(graph.edges).toEqual([{ from: "client", to: "icon", label: "", style: "solid", arrow: "forward", quality: "bound" }]);
    expect(labels(graph)).toEqual(["Client", "Store"]);
  });

  it("maps an arrow bound to the free label text of a group onto the group's node", () => {
    const parts = inGroup([...rect("p1", 400, 100, 80, 60), freeText("lbl", "Store", 410, 170)], "icon");
    const client = rect("client", 100, 100, 120, 60, "Client");
    const scene = flat(client, parts, arrow("e", [220, 130], [410, 180], { from: client[0]!, to: parts[1] }));
    expect(sceneToGraph(scene).edges).toEqual([{ from: "client", to: "icon", label: "", style: "solid", arrow: "forward", quality: "bound" }]);
  });

  it("drops an arrow that is part of a group's own artwork", () => {
    const artwork = inGroup([...rect("body", 100, 100, 120, 80, "Widget"), ...arrow("stub", [110, 140], [210, 140], { from: undefined })], "icon");
    const graph = sceneToGraph(flat(artwork));
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toEqual([]);
    expect(graph.warnings).toEqual([]);
  });
});

describe("rule 3: labels", () => {
  it("uses the text bound to the shape", () => {
    expect(labels(sceneToGraph(flat(rect("a", 0, 0, 100, 50, "API service"))))).toEqual(["API service"]);
  });

  it("prefers originalText over the wrapped text and collapses whitespace", () => {
    const a = rect("a", 0, 0, 160, 80);
    const text = boundText("a-text", "a", "Load\nbalancer\nfor APIs", 10, 20, 140, 60, {
      originalText: "  Load   balancer\n for  APIs ",
    });
    a![0]!.boundElements = [{ type: "text", id: "a-text" }];
    expect(labels(sceneToGraph([a[0]!, text]))).toEqual(["Load balancer for APIs"]);
  });

  it("keeps the name, fields and methods of a class box apart without the dashed separator lines", () => {
    const rule = "-".repeat(22);
    const classBox = rect("c", 0, 0, 250, 124, ["ClassName", rule, "field: Type", rule, "method()"].join("\n"), { customData: { kind: "class" } });
    const interfaceBox = rect("i", 400, 0, 250, 148, ["\u00ABinterface\u00BB", "InterfaceName", rule, "", rule, "method()"].join("\n"), { customData: { kind: "interface" } });
    const graph = sceneToGraph(flat(classBox, interfaceBox));
    expect(labels(graph)).toEqual(["ClassName | field: Type | method()", "\u00ABinterface\u00BB InterfaceName | | method()"]);
    expect(graphToText(graph)).toContain("- [ClassName | field: Type | method()] (kind: class)");
  });

  it("leaves a short run of hyphens and a hyphen inside a word alone", () => {
    expect(labels(sceneToGraph(flat(rect("a", 0, 0, 100, 50, "read--write\nfail-over\n--"))))).toEqual(["read--write fail-over --"]);
  });

  it("falls back to text when originalText is missing or empty", () => {
    const a = rect("a", 0, 0, 160, 80);
    const text = boundText("t", "a", "Fallback text", 10, 20, 140, 60);
    delete text.originalText;
    expect(labels(sceneToGraph([a[0]!, text]))).toEqual(["Fallback text"]);
    text.originalText = "";
    expect(labels(sceneToGraph([a[0]!, text]))).toEqual(["Fallback text"]);
  });

  it("uses a free text whose centre lies inside an unlabeled shape", () => {
    const scene = flat(rect("box", 100, 100, 200, 100), freeText("t", "Redis", 150, 130));
    const graph = sceneToGraph(scene);
    expect(labels(graph)).toEqual(["Redis"]);
    expect(graph.freeText).toEqual([]);
  });

  it("gives the free text to the smallest containing shape", () => {
    const scene = flat(rect("outer", 0, 0, 600, 400), rect("inner", 100, 100, 200, 100), freeText("t", "Cache", 150, 130));
    const graph = sceneToGraph(scene);
    const byKey = Object.fromEntries(graph.nodes.map((n) => [n.key, n.label]));
    expect(byKey).toEqual({ outer: "", inner: "Cache" });
    expect(graph.warnings).toContain("unlabeled rectangle near (0, 0)");
  });

  it("does not let a free text re-label a shape that already has a label", () => {
    const scene = flat(rect("box", 100, 100, 300, 200, "Web tier"), freeText("note", "stateless", 150, 200));
    const graph = sceneToGraph(scene);
    expect(labels(graph)).toEqual(["Web tier"]);
    expect(graph.freeText.map((t) => t.text)).toEqual(["stateless"]);
  });

  it("leaves a free text outside every shape as free text", () => {
    const graph = sceneToGraph(flat(rect("box", 100, 100, 100, 50, "Box"), freeText("note", "outside", 500, 500)));
    expect(graph.freeText).toEqual([{ text: "outside", frame: null }]);
  });

  it("joins several free texts inside one unlabeled shape in reading order", () => {
    const scene = flat(rect("box", 0, 0, 400, 300), freeText("b", "second", 100, 200), freeText("a", "first", 100, 50));
    expect(labels(sceneToGraph(scene))).toEqual(["first second"]);
  });

  it("leaves a shape with no text unlabeled and warns", () => {
    const graph = sceneToGraph(flat(rect("box", 40, 60, 100, 50)));
    expect(labels(graph)).toEqual([""]);
    expect(graph.warnings).toEqual(["unlabeled rectangle near (40, 60)"]);
  });

  it("names the kind in the unlabeled warning", () => {
    const graph = sceneToGraph(flat(withKind(rect("box", 40, 60, 100, 50), "database")));
    expect(graph.warnings).toEqual(["unlabeled database near (40, 60)"]);
  });

  it("does not use text bound to an arrow as a node label", () => {
    const a = rect("a", 0, 0, 100, 50);
    const b = rect("b", 300, 0, 100, 50);
    const scene = flat(a, b, arrow("e", [100, 25], [300, 25], { from: a[0]!, to: b[0]!, label: "calls" }));
    expect(labels(sceneToGraph(scene))).toEqual(["", ""]);
  });

  it("caps very long labels", () => {
    const graph = sceneToGraph(flat(rect("a", 0, 0, 100, 50, "x".repeat(1000))));
    expect([...graph.nodes[0]!.label]).toHaveLength(200);
    expect(graph.nodes[0]!.label.endsWith("…")).toBe(true);
  });
});

describe("rule 4: edges", () => {
  const a = () => rect("a", 100, 100, 100, 60, "A");
  const b = () => rect("b", 500, 100, 100, 60, "B");

  it("reads bound arrows with label, style and direction", () => {
    const [ra, rb] = [a(), b()];
    const scene = flat(ra, rb, arrow("e", [200, 130], [500, 130], { from: ra[0]!, to: rb[0]!, label: "SQL", strokeStyle: "dashed" }));
    expect(sceneToGraph(scene).edges).toEqual([{ from: "a", to: "b", label: "SQL", style: "dashed", arrow: "forward", quality: "bound" }]);
  });

  it("maps an arrow bound to a text that is bound to a shape onto that shape", () => {
    const [ra, rb] = [a(), b()];
    const scene = flat(ra, rb, arrow("e", [200, 130], [500, 130], { from: { id: "a-label" }, to: { id: "b-label" } }));
    expect(sceneToGraph(scene).edges[0]).toMatchObject({ from: "a", to: "b", quality: "bound" });
  });

  it.each([
    ["forward", { endArrowhead: "arrow" }],
    ["backward", { startArrowhead: "arrow", endArrowhead: null }],
    ["both", { startArrowhead: "arrow", endArrowhead: "arrow" }],
    ["none", { endArrowhead: null }],
  ] as const)("reads direction %s from the arrowheads", (expected, heads) => {
    const [ra, rb] = [a(), b()];
    const scene = flat(ra, rb, arrow("e", [200, 130], [500, 130], { from: ra[0]!, to: rb[0]!, ...heads }));
    expect(sceneToGraph(scene).edges[0]!.arrow).toBe(expected);
  });

  it.each([
    ["dashed", "dashed"],
    ["dotted", "dotted"],
    ["solid", "solid"],
    ["wavy", "solid"],
  ] as const)("reads strokeStyle %s as %s", (strokeStyle, expected) => {
    const [ra, rb] = [a(), b()];
    const edge = arrow("e", [200, 130], [500, 130], { from: ra[0]!, to: rb[0]!, strokeStyle: strokeStyle as "solid" });
    edge[0]!.strokeStyle = strokeStyle;
    expect(sceneToGraph(flat(ra, rb, edge)).edges[0]!.style).toBe(expected);
  });

  it("treats a line element as an edge without arrowheads", () => {
    const [ra, rb] = [a(), b()];
    const edge = arrow("l", [200, 130], [500, 130], { from: ra[0]!, to: rb[0]!, type: "line" });
    expect(sceneToGraph(flat(ra, rb, edge)).edges).toEqual([{ from: "a", to: "b", label: "", style: "solid", arrow: "none", quality: "bound" }]);
  });

  it("keeps the label of an arrow out of the free text", () => {
    const [ra, rb] = [a(), b()];
    const scene = flat(ra, rb, arrow("e", [200, 130], [500, 130], { from: ra[0]!, to: rb[0]!, label: "HTTPS" }));
    const graph = sceneToGraph(scene);
    expect(graph.edges[0]!.label).toBe("HTTPS");
    expect(graph.freeText).toEqual([]);
  });

  describe("guessed ends", () => {
    it("attaches an unbound end to a box within 40 px and marks the edge guessed", () => {
      const scene = flat(a(), b(), arrow("e", [230, 130], [460, 130]));
      expect(sceneToGraph(scene).edges).toEqual([{ from: "a", to: "b", label: "", style: "solid", arrow: "forward", quality: "guessed" }]);
    });

    it("accepts exactly 40 px and rejects 41 px", () => {
      const at40 = sceneToGraph(flat(a(), b(), arrow("e", [240, 130], [460, 130])));
      expect(at40.edges[0]).toMatchObject({ from: "a", to: "b", quality: "guessed" });
      const at41 = sceneToGraph(flat(a(), b(), arrow("e", [241, 130], [459, 130])));
      expect(at41.edges[0]).toMatchObject({ from: null, to: null, quality: "dangling" });
    });

    it("measures the distance to the box edge, not its centre", () => {
      const scene = flat(a(), arrow("e", [150, 100], [150, 10]));
      expect(sceneToGraph(scene).edges[0]).toMatchObject({ from: "a", to: null, quality: "dangling" });
    });

    it("picks the nearest box when several are in range", () => {
      const scene = flat(rect("near", 300, 100, 100, 60, "Near"), rect("far", 300, 200, 100, 60, "Far"), arrow("e", [380, 175], [900, 130]));
      expect(sceneToGraph(scene).edges[0]).toMatchObject({ from: "near", quality: "dangling" });
    });

    it("prefers the smaller box when an end lies inside nested boxes", () => {
      const scene = flat(rect("outer", 0, 0, 600, 400, "Outer"), rect("inner", 100, 100, 100, 100, "Inner"), arrow("e", [150, 150], [700, 700]));
      expect(sceneToGraph(scene).edges[0]).toMatchObject({ from: "inner" });
    });

    it("keeps a bound end as bound when the other end is guessed", () => {
      const [ra] = [a()];
      const scene = flat(ra, b(), arrow("e", [200, 130], [460, 130], { from: ra[0]! }));
      expect(sceneToGraph(scene).edges[0]).toMatchObject({ from: "a", to: "b", quality: "guessed" });
    });
  });

  describe("dangling ends", () => {
    it("marks an arrow with an unconnected end as dangling and keeps the connected end", () => {
      const ra = a();
      const scene = flat(ra, arrow("e", [200, 130], [900, 600], { from: ra[0]! }));
      expect(sceneToGraph(scene).edges).toEqual([{ from: "a", to: null, label: "", style: "solid", arrow: "forward", quality: "dangling" }]);
    });

    it("reports an arrow that touches nothing", () => {
      const graph = sceneToGraph(flat(arrow("e", [900, 600], [1200, 600])));
      expect(graph.edges[0]).toMatchObject({ from: null, to: null, quality: "dangling" });
      expect(graph.warnings).toEqual(["an arrow near (900, 600) touches no box"]);
    });
  });

  it("keeps an ungrouped self-loop", () => {
    const ra = a();
    const scene = flat(ra, arrow("e", [150, 100], [250, 130], { from: ra[0]!, to: ra[0]! }));
    expect(sceneToGraph(scene).edges).toEqual([{ from: "a", to: "a", label: "", style: "solid", arrow: "forward", quality: "bound" }]);
  });

  it("makes a free text that an arrow is bound to a node", () => {
    const ra = a();
    const note = freeText("t", "Kafka", 520, 110);
    const scene = flat(ra, note, arrow("e", [200, 130], [520, 122], { from: ra[0]!, to: note }));
    const graph = sceneToGraph(scene);
    expect(graph.nodes.map((n) => [n.key, n.label, n.shape])).toEqual([
      ["a", "A", "rectangle"],
      ["t", "Kafka", "text"],
    ]);
    expect(graph.edges[0]).toMatchObject({ from: "a", to: "t", quality: "bound" });
    expect(graph.freeText).toEqual([]);
  });

  it("drops a binding to an element that is not a node and guesses instead", () => {
    const ra = a();
    const stray = frame("fr", 400, 0, 300, 300, "Zone");
    const scene = flat(ra, stray, arrow("e", [200, 130], [800, 130], { from: ra[0]!, to: stray }));
    expect(sceneToGraph(scene).edges[0]).toMatchObject({ from: "a", to: null, quality: "dangling" });
  });
});

describe("rule 5: frames", () => {
  it("names frames and assigns members by frameId", () => {
    const scene = flat(
      frame("f1", 0, 0, 500, 400, "High-level design"),
      rect("in", 50, 50, 100, 50, "Inside", { frameId: "f1" }),
      rect("out", 700, 50, 100, 50, "Outside"),
      freeText("note", "a note", 60, 300, { frameId: "f1" }),
    );
    const graph = sceneToGraph(scene);
    expect(graph.frames).toEqual(["High-level design"]);
    expect(graph.nodes.map((n) => [n.label, n.frame])).toEqual([
      ["Outside", null],
      ["Inside", "High-level design"],
    ]);
    expect(graph.freeText).toEqual([{ text: "a note", frame: "High-level design" }]);
  });

  it("calls unnamed frames Frame n in element order", () => {
    const scene = flat(frame("f1", 0, 0, 300, 300, null), frame("f2", 400, 0, 300, 300, "Named"), frame("f3", 800, 0, 300, 300, "  "));
    expect(sceneToGraph(scene).frames).toEqual(["Frame 1", "Named", "Frame 3"]);
  });

  it("lists frames top to bottom, left to right and treats a magic frame like a frame", () => {
    const magic = frame("m", 0, 600, 300, 300, "Lower");
    magic.type = "magicframe";
    const scene = flat(magic, frame("right", 600, 0, 300, 300, "Upper right"), frame("left", 0, 0, 300, 300, "Upper left"));
    expect(sceneToGraph(scene).frames).toEqual(["Upper left", "Upper right", "Lower"]);
  });

  it("ignores a frameId whose frame is missing", () => {
    const graph = sceneToGraph(flat(rect("a", 0, 0, 100, 50, "A", { frameId: "nope" })));
    expect(graph.nodes[0]!.frame).toBeNull();
  });

  it("does not turn a frame into a node", () => {
    expect(sceneToGraph(flat(frame("f1", 0, 0, 300, 300, "Zone"))).nodes).toEqual([]);
  });
});

describe("rule 6: freehand strokes and images", () => {
  it("records freedraw and image elements as opaque entries", () => {
    const scene = flat(freedraw("s1", 0, 0), freedraw("s2", 100, 0), image("i1", 300, 300));
    const graph = sceneToGraph(scene);
    expect(graph.opaque).toEqual([
      { kind: "freedraw", frame: null },
      { kind: "freedraw", frame: null },
      { kind: "image", frame: null },
    ]);
    expect(graph.nodes).toEqual([]);
  });

  it("notes the frame of an opaque entry", () => {
    const scene = flat(frame("f1", 0, 0, 400, 400, "Sketch"), freedraw("s1", 10, 10, { frameId: "f1" }));
    expect(sceneToGraph(scene).opaque).toEqual([{ kind: "freedraw", frame: "Sketch" }]);
  });

  it("treats a closed line as a drawn shape, not a connection", () => {
    const triangle = polyline("tri", 100, 100, [
      [0, 0],
      [80, 0],
      [40, 60],
      [0, 0],
    ]);
    const graph = sceneToGraph([triangle]);
    expect(graph.edges).toEqual([]);
    expect(graph.opaque).toEqual([{ kind: "polygon", frame: null }]);
  });

  it("does not list a stroke inside a group node as opaque", () => {
    const parts = inGroup([...rect("r", 0, 0, 100, 50, "Icon"), freedraw("s", 10, 10)], "g");
    expect(sceneToGraph(flat(parts)).opaque).toEqual([]);
  });

  it("records embeddable elements as embedded items", () => {
    const embed: Element = { ...image("e", 0, 0), type: "embeddable" };
    expect(sceneToGraph([embed]).opaque).toEqual([{ kind: "embed", frame: null }]);
  });
});

describe("rule 7: warnings", () => {
  it("warns about an unlabeled node, a dangling edge and an isolated node", () => {
    const a = rect("a", 100, 100, 100, 60, "A");
    const scene = flat(a, rect("lonely", 800, 100, 100, 60, "Lonely"), rect("blank", 100, 400, 100, 60), arrow("e", [200, 130], [600, 400], { from: a[0]! }));
    expect(sceneToGraph(scene).warnings).toEqual([
      "unlabeled rectangle near (100, 400)",
      "arrow from [A] does not end at a box",
      "node [Lonely] has no connections",
      "node near (100, 400) has no connections",
    ]);
  });

  it("describes an arrow that does not start at a box", () => {
    const b = rect("b", 500, 100, 100, 60, "B");
    const scene = flat(b, arrow("e", [100, 600], [500, 130], { to: b[0]! }));
    expect(sceneToGraph(scene).warnings).toEqual(["arrow to [B] does not start at a box"]);
  });

  it("warns about isolated nodes only when there are three or more nodes", () => {
    expect(sceneToGraph(flat(rect("a", 0, 0, 100, 50, "A"), rect("b", 300, 0, 100, 50, "B"))).warnings).toEqual([]);
    const three = sceneToGraph(flat(rect("a", 0, 0, 100, 50, "A"), rect("b", 300, 0, 100, 50, "B"), rect("c", 600, 0, 100, 50, "C")));
    expect(three.warnings).toEqual(["node [A] has no connections", "node [B] has no connections", "node [C] has no connections"]);
  });

  it("counts a node with only a dangling edge as connected", () => {
    const a = rect("a", 0, 0, 100, 50, "A");
    const scene = flat(a, rect("b", 300, 0, 100, 50, "B"), rect("c", 600, 0, 100, 50, "C"), arrow("e", [100, 25], [200, 600], { from: a[0]! }));
    expect(sceneToGraph(scene).warnings).toEqual(["arrow from [A] does not end at a box", "node [B] has no connections", "node [C] has no connections"]);
  });

  it("gives no warnings for a clean diagram", () => {
    const a = rect("a", 0, 0, 100, 50, "A");
    const b = rect("b", 300, 0, 100, 50, "B");
    const scene = flat(a, b, arrow("e", [100, 25], [300, 25], { from: a[0]!, to: b[0]! }));
    expect(sceneToGraph(scene).warnings).toEqual([]);
  });
});

describe("graphToText", () => {
  function exampleScene(): Element[] {
    const lb = withKind(rect("lb", 100, 100, 160, 60, "Load balancer"), "load_balancer");
    const api = withKind(rect("api", 340, 100, 160, 60, "API service"), "service");
    const pg = withKind(shape("ellipse", "pg", 340, 400, 160, 80, "Postgres", { frameId: "f1" }), "database");
    const worker = withKind(rect("worker", 100, 260, 160, 60, "Worker"), "worker");
    const cache = withKind(rect("cache", 600, 100, 160, 60, "Cache"), "cache");
    return flat(
      frame("f1", 300, 360, 400, 200, "High-level design"),
      frame("f2", 800, 0, 400, 200, "Capacity"),
      lb,
      api,
      pg,
      worker,
      cache,
      arrow("e1", [260, 130], [340, 130], { from: lb[0]!, to: api[0]!, label: "HTTPS" }),
      arrow("e2", [420, 160], [420, 400], { from: api[0]!, to: pg[0]!, label: "SQL", strokeStyle: "dashed" }),
      arrow("e3", [180, 320], [180, 500], { from: worker[0]! }),
      freeText("cap", "100M URLs/month → 40 writes/s", 820, 60, { frameId: "f2" }),
      freedraw("s1", 900, 600),
      freedraw("s2", 960, 640),
    );
  }

  it("renders the documented text form", () => {
    expect(graphToText(sceneToGraph(exampleScene()))).toBe(
      [
        "Nodes:",
        "- [Load balancer] (kind: load_balancer)",
        "- [API service] (kind: service)",
        "- [Cache] (kind: cache)",
        "- [Worker] (kind: worker)",
        '- [Postgres] (kind: database) in frame "High-level design"',
        "Edges:",
        '- [Load balancer] -> [API service] "HTTPS"',
        '- [API service] -> [Postgres] "SQL" (dashed)',
        "- [Worker] -> ? (dangling)",
        "Text on the board:",
        '- "100M URLs/month → 40 writes/s" in frame "Capacity"',
        "Not readable as text: 2 freehand strokes",
        "Warnings: arrow from [Worker] does not end at a box; node [Cache] has no connections",
      ].join("\n"),
    );
  });

  it("gives the same text whatever order the elements arrive in", () => {
    const scene = exampleScene();
    const expected = graphToText(sceneToGraph(scene));
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let round = 0; round < 8; round++) {
      const shuffled = [...scene];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      expect(graphToText(sceneToGraph(shuffled))).toBe(expected);
    }
  });

  it("orders boxes in the same row left to right even when their tops differ a little", () => {
    const scene = flat(rect("right", 400, 108, 100, 50, "Right"), rect("left", 100, 100, 100, 50, "Left"), rect("below", 100, 300, 100, 50, "Below"));
    expect(labels(sceneToGraph(scene))).toEqual(["Left", "Right", "Below"]);
  });

  it("orders nodes without a frame first, then frames top to bottom", () => {
    const scene = flat(
      frame("low", 0, 500, 300, 300, "Lower"),
      frame("high", 0, 0, 300, 300, "Upper"),
      rect("c", 50, 600, 100, 50, "C", { frameId: "low" }),
      rect("b", 50, 100, 100, 50, "B", { frameId: "high" }),
      rect("a", 900, 900, 100, 50, "A"),
    );
    expect(labels(sceneToGraph(scene))).toEqual(["A", "B", "C"]);
  });

  it("describes a board with nothing on it", () => {
    expect(graphToText(sceneToGraph([]))).toBe("The board is empty.");
    expect(graphToText(sceneToGraph(deleted(rect("a", 0, 0, 10, 10, "A"))))).toBe("The board is empty.");
  });

  it("says none for an empty section when the board has other content", () => {
    expect(graphToText(sceneToGraph(flat(rect("a", 0, 0, 100, 50, "A"))))).toBe("Nodes:\n- [A]\nEdges: none");
    expect(graphToText(sceneToGraph(flat(freeText("t", "just a note", 0, 0))))).toBe('Nodes: none\nEdges: none\nText on the board:\n- "just a note"');
  });

  it("shows the shape when a node has no kind and is not a rectangle", () => {
    const scene = flat(
      shape("ellipse", "e", 0, 0, 100, 50, "Round"),
      shape("diamond", "d", 200, 0, 100, 50, "Decision"),
      inGroup(rect("g", 400, 0, 100, 50, "Bundle"), "grp"),
      rect("r", 600, 0, 100, 50, "Plain"),
    );
    const text = graphToText(sceneToGraph(scene));
    expect(text).toContain("- [Round] (ellipse)");
    expect(text).toContain("- [Decision] (diamond)");
    expect(text).toContain("- [Bundle] (group)");
    expect(text).toContain("- [Plain]\n");
  });

  it("marks guessed and dotted edges and uses the right arrow for each direction", () => {
    const a = rect("a", 100, 100, 100, 60, "A");
    const b = rect("b", 500, 100, 100, 60, "B");
    const scene = flat(
      a,
      b,
      arrow("e1", [230, 120], [470, 120], { startArrowhead: "arrow", endArrowhead: null, strokeStyle: "dotted" }),
      arrow("e2", [200, 130], [500, 130], { from: a[0]!, to: b[0]!, startArrowhead: "arrow" }),
      arrow("e3", [200, 140], [500, 140], { from: a[0]!, to: b[0]!, endArrowhead: null }),
    );
    expect(graphToText(sceneToGraph(scene))).toBe(["Nodes:", "- [A]", "- [B]", "Edges:", "- [A] <- [B] (dotted, guessed)", "- [A] <-> [B]", "- [A] -- [B]"].join("\n"));
  });

  it("quotes edge labels and free text safely", () => {
    const a = rect("a", 100, 100, 100, 60, "A");
    const b = rect("b", 500, 100, 100, 60, "B");
    const scene = flat(a, b, arrow("e", [200, 130], [500, 130], { from: a[0]!, to: b[0]!, label: 'says "hi"' }), freeText("t", 'a "quoted" note', 100, 400));
    const text = graphToText(sceneToGraph(scene));
    expect(text).toContain('- [A] -> [B] "says \\"hi\\""');
    expect(text).toContain('- "a \\"quoted\\" note"');
  });

  it("labels an unlabeled node and says what the unresolved ends are", () => {
    const text = graphToText({
      nodes: [{ key: "n", label: "", kind: null, shape: "rectangle", frame: null }],
      edges: [
        { from: null, to: "n", label: "", style: "solid", arrow: "forward", quality: "dangling" },
        { from: "missing", to: null, label: "", style: "solid", arrow: "forward", quality: "dangling" },
      ],
      freeText: [],
      frames: [],
      opaque: [],
      warnings: [],
    });
    expect(text).toBe(["Nodes:", "- [(no label)]", "Edges:", "- ? -> [(no label)] (dangling)", "- [?] -> ? (dangling)"].join("\n"));
  });

  it("describes every kind of opaque item", () => {
    const text = graphToText({
      nodes: [],
      edges: [],
      freeText: [],
      frames: [],
      opaque: [
        { kind: "image", frame: null },
        { kind: "freedraw", frame: null },
        { kind: "polygon", frame: null },
        { kind: "polygon", frame: null },
        { kind: "embed", frame: null },
        { kind: "mystery", frame: null },
      ],
      warnings: [],
    });
    expect(text).toContain("Not readable as text: 1 freehand stroke, 1 image, 2 closed line shapes, 1 embedded item, 1 mystery");
  });

  it("caps a very long section", () => {
    const scene = Array.from({ length: 500 }, (_, i) => rect(`n${i}`, (i % 25) * 150, Math.floor(i / 25) * 100, 100, 50, `N${i}`)).flat();
    const lines = graphToText(sceneToGraph(scene)).split("\n");
    expect(lines.filter((l) => l.startsWith("- [N"))).toHaveLength(400);
    expect(lines).toContain("- ... and 100 more");
  });
});

describe("robustness", () => {
  it("does not throw on malformed elements", () => {
    const junk = [
      null,
      undefined,
      42,
      "text",
      {},
      { id: 5, type: "rectangle" },
      { id: "x" },
      { id: "y", type: 7 },
      { id: "z", type: "rectangle", x: "far", y: NaN, width: Infinity, height: -10, groupIds: "nope", boundElements: 5, customData: "no" },
      { id: "w", type: "arrow", points: "none", startBinding: 5, endBinding: { elementId: 9 }, strokeStyle: {} },
      { id: "v", type: "text", text: 12, originalText: null, containerId: 4 },
      { id: "c", type: "constructor" },
      { id: "p", type: "__proto__" },
    ] as unknown as Record<string, unknown>[];
    expect(() => graphToText(sceneToGraph(junk))).not.toThrow();
    const graph = sceneToGraph(junk);
    expect(graph.nodes.map((n) => n.key)).toEqual(["z"]);
  });

  it("only accepts a plain identifier as a node kind", () => {
    const evil = rect("a", 0, 0, 100, 50, "A", { customData: { kind: "service)\nEdges: [x]" } });
    expect(sceneToGraph(flat(evil)).nodes[0]!.kind).toBeNull();
    const fine = rect("b", 0, 0, 100, 50, "B", { customData: { kind: "load_balancer" } });
    expect(sceneToGraph(flat(fine)).nodes[0]!.kind).toBe("load_balancer");
  });

  it("keeps label text on one line", () => {
    const text = graphToText(sceneToGraph(flat(rect("a", 0, 0, 100, 50, "line one\nline two\r\nline three"))));
    expect(text).toBe("Nodes:\n- [line one line two line three]\nEdges: none");
  });

  it("does not change its input", () => {
    const scene = JSON.parse(JSON.stringify(flat(rect("a", 0, 0, 100, 50, "A"), arrow("e", [100, 25], [300, 25])))) as Element[];
    const before = JSON.stringify(scene);
    sceneToGraph(scene);
    expect(JSON.stringify(scene)).toBe(before);
  });

  it("handles a few thousand elements quickly", () => {
    const scene = Array.from({ length: 1500 }, (_, i) => rect(`n${i}`, (i % 50) * 150, Math.floor(i / 50) * 100, 100, 50, `N${i}`)).flat();
    const started = performance.now();
    const graph = sceneToGraph(scene);
    expect(graph.nodes).toHaveLength(1500);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
