import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { planArrow, planShape, type BindableShape } from "../board/elements";
import { HLD_SHAPES, arrowSpecFor, shapeSpecFor, type ArrowPreset, type StrokeStyle } from "../board/palette";

export type SampleName = "flow" | "kinds" | "classes";

/** Builds scenes with the same functions the palette uses, so a sample shows exactly what an insert draws. */
class SceneBuilder {
  readonly elements: ExcalidrawElement[] = [];
  private readonly shapes = new Map<string, BindableShape>();

  shape(key: string, kind: string, x: number, y: number, label?: string): this {
    const spec = shapeSpecFor(kind);
    if (!spec) throw new Error(`Unknown kind ${kind}`);
    const created = planShape(spec, label ?? spec.defaultLabel, { x, y });
    const container = created.find((el) => el.customData?.kind === kind);
    if (!container) throw new Error(`No container for ${kind}`);
    this.elements.push(...created);
    this.shapes.set(key, container as BindableShape);
    return this;
  }

  link(from: string, to: string, options: { label?: string; strokeStyle?: StrokeStyle; preset?: ArrowPreset } = {}): this {
    const start = this.shapes.get(from);
    const end = this.shapes.get(to);
    if (!start || !end) throw new Error(`Cannot link ${from} to ${to}`);
    const preset = options.preset ? arrowSpecFor(options.preset) : undefined;
    const plan = planArrow({
      from: start,
      to: end,
      at: { x: 0, y: 0 },
      label: options.label ?? preset?.label ?? "",
      strokeStyle: options.strokeStyle ?? preset?.strokeStyle ?? "solid",
      startArrowhead: preset ? preset.startArrowhead : null,
      endArrowhead: preset ? preset.endArrowhead : "arrow",
      kind: preset?.preset,
      clean: Boolean(preset),
    });
    const replaced = new Map(plan.replaced.map((el) => [el.id, el]));
    const next = this.elements.map((el) => replaced.get(el.id) ?? el);
    this.elements.splice(0, this.elements.length, ...next, ...plan.created);
    // A later arrow must extend the updated bound list, not the one captured at creation.
    for (const [key, shape] of this.shapes) {
      const updated = replaced.get(shape.id);
      if (updated) this.shapes.set(key, updated as BindableShape);
    }
    return this;
  }
}

function flow(): SceneBuilder {
  return new SceneBuilder()
    .shape("client", "client", 90, 300)
    .shape("lb", "load_balancer", 340, 300)
    .shape("gw", "api_gateway", 610, 300)
    .shape("orders", "service", 880, 160, "Order service")
    .shape("search", "service", 880, 460, "Search service")
    .shape("db", "database", 1150, 70, "Postgres")
    .shape("cache", "cache", 1150, 190, "Redis")
    .shape("pay", "external", 1150, 310, "Payment provider")
    .shape("index", "search_index", 1150, 460, "Search index")
    .shape("queue", "queue", 610, 590, "Order events")
    .shape("worker", "worker", 880, 600, "Email worker")
    .shape("cdn", "cdn", 340, 110)
    .link("client", "lb", { label: "HTTPS" })
    .link("lb", "gw")
    .link("gw", "orders", { label: "REST" })
    .link("gw", "search")
    .link("orders", "db", { label: "SQL" })
    .link("orders", "cache")
    .link("orders", "pay", { strokeStyle: "dashed", label: "HTTPS" })
    .link("search", "index")
    .link("orders", "queue", { label: "publish" })
    .link("queue", "worker", { label: "consume" })
    .link("client", "cdn", { strokeStyle: "dashed" });
}

function kinds(): SceneBuilder {
  const builder = new SceneBuilder();
  HLD_SHAPES.forEach((spec, i) => {
    builder.shape(spec.kind, spec.kind, 150 + (i % 4) * 300, 110 + Math.floor(i / 4) * 190);
  });
  return builder;
}

function classes(): SceneBuilder {
  return new SceneBuilder()
    .shape("shape", "interface", 330, 110, ["«interface»", "Shape", "----------------------", "", "----------------------", "area(): double"].join("\n"))
    .shape("circle", "class", 150, 380, ["Circle", "----------------------", "radius: double", "----------------------", "area(): double"].join("\n"))
    .shape("rect", "class", 490, 380, ["Rectangle", "----------------------", "w: double", "h: double", "----------------------", "area(): double"].join("\n"))
    .shape("square", "class", 830, 380, ["Square", "----------------------", "side: double", "----------------------", "Square(side)"].join("\n"))
    .shape("canvas", "class", 830, 110, ["Canvas", "----------------------", "shapes: vector<Shape>", "----------------------", "add(Shape)", "render()"].join("\n"))
    .shape("color", "enum", 330, 640, ["«enum»", "Color", "----------------------", "RED", "GREEN", "BLUE"].join("\n"))
    .link("circle", "shape", { preset: "implements" })
    .link("rect", "shape", { preset: "implements" })
    .link("square", "rect", { preset: "inherits" })
    .link("canvas", "shape", { preset: "owns" })
    .link("circle", "color", { preset: "uses" })
    .link("rect", "color", { preset: "uses" });
}

export function buildSample(name: SampleName): Record<string, unknown>[] {
  const builder = name === "flow" ? flow() : name === "kinds" ? kinds() : classes();
  return builder.elements as unknown as Record<string, unknown>[];
}
