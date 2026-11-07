// One table drives both the palette swatches and the elements that land on the board,
// so a swatch always shows what an insert will draw.

export type ShapeKind =
  | "client"
  | "load_balancer"
  | "api_gateway"
  | "service"
  | "worker"
  | "database"
  | "cache"
  | "queue"
  | "object_storage"
  | "cdn"
  | "search_index"
  | "external"
  | "class"
  | "interface"
  | "enum";

export type ArrowPreset = "inherits" | "implements" | "owns" | "uses";

export type StrokeStyle = "solid" | "dashed" | "dotted";
export type FillStyle = "solid" | "hachure" | "cross-hatch";
export type ArrowheadName = "arrow" | "triangle_outline" | "diamond";

export interface ShapeSpec {
  kind: ShapeKind;
  /** Short name in the palette. */
  title: string;
  /** Text the shape carries when inserted. Class-like kinds use several lines. */
  defaultLabel: string;
  shape: "rectangle" | "ellipse" | "diamond";
  width: number;
  height: number;
  /** Mid-tone stroke and a light tint: Excalidraw's dark theme inverts both and keeps them readable. */
  stroke: string;
  fill: string;
  fillStyle: FillStyle;
  strokeStyle: StrokeStyle;
  strokeWidth: number;
  rounded: boolean;
  /** 0 draws clean lines (class boxes); 1 keeps Excalidraw's hand-drawn look. */
  roughness: 0 | 1;
  fontSize: number;
  /** Class-like boxes hold code, so they use a monospace face and top-left text. */
  codeLabel: boolean;
}

export interface ArrowSpec {
  preset: ArrowPreset;
  title: string;
  label: string;
  strokeStyle: StrokeStyle;
  startArrowhead: ArrowheadName | null;
  endArrowhead: ArrowheadName | null;
}

const RULE = "-".repeat(22);

function box(partial: Partial<ShapeSpec> & Pick<ShapeSpec, "kind" | "title" | "defaultLabel" | "stroke" | "fill">): ShapeSpec {
  return {
    shape: "rectangle",
    width: 170,
    height: 64,
    fillStyle: "solid",
    strokeStyle: "solid",
    strokeWidth: 2,
    rounded: true,
    roughness: 1,
    fontSize: 20,
    codeLabel: false,
    ...partial,
  };
}

export const HLD_SHAPES: readonly ShapeSpec[] = [
  box({ kind: "client", title: "Client", defaultLabel: "Client", stroke: "#495057", fill: "#e9ecef", width: 150 }),
  box({
    kind: "load_balancer",
    title: "Load balancer",
    defaultLabel: "Load balancer",
    stroke: "#e8590c",
    fill: "#ffd8a8",
    shape: "diamond",
    width: 210,
    height: 112,
    rounded: false,
    fontSize: 16,
  }),
  box({ kind: "api_gateway", title: "API gateway", defaultLabel: "API gateway", stroke: "#6741d9", fill: "#d0bfff", rounded: false, strokeWidth: 4 }),
  box({ kind: "service", title: "Service", defaultLabel: "Service", stroke: "#1971c2", fill: "#a5d8ff" }),
  box({ kind: "worker", title: "Worker", defaultLabel: "Worker", stroke: "#0c8599", fill: "#99e9f2", strokeStyle: "dotted", width: 150 }),
  box({ kind: "database", title: "Database", defaultLabel: "Database", stroke: "#2f9e44", fill: "#b2f2bb", shape: "ellipse", width: 160, height: 96, rounded: false }),
  box({ kind: "cache", title: "Cache", defaultLabel: "Cache", stroke: "#e03131", fill: "#ffc9c9", shape: "ellipse", width: 130, height: 72, rounded: false }),
  box({ kind: "queue", title: "Queue", defaultLabel: "Queue", stroke: "#f08c00", fill: "#ffec99", strokeStyle: "dashed", width: 240, height: 56, rounded: false }),
  box({ kind: "object_storage", title: "Object storage", defaultLabel: "Object storage", stroke: "#099268", fill: "#96f2d7", fillStyle: "hachure" }),
  box({ kind: "cdn", title: "CDN", defaultLabel: "CDN", stroke: "#3b5bdb", fill: "#bac8ff", shape: "ellipse", strokeStyle: "dashed", width: 160, height: 72, rounded: false }),
  box({ kind: "search_index", title: "Search index", defaultLabel: "Search index", stroke: "#c2255c", fill: "#fcc2d7", fillStyle: "cross-hatch", rounded: false }),
  box({ kind: "external", title: "External system", defaultLabel: "External system", stroke: "#868e96", fill: "transparent", strokeStyle: "dashed", rounded: false }),
];

function codeBox(kind: ShapeKind, title: string, stroke: string, fill: string, defaultLabel: string, height: number): ShapeSpec {
  return box({
    kind,
    title,
    defaultLabel,
    stroke,
    fill,
    width: 250,
    height,
    rounded: false,
    roughness: 0,
    fontSize: 16,
    codeLabel: true,
  });
}

export const LLD_SHAPES: readonly ShapeSpec[] = [
  codeBox("class", "Class", "#1971c2", "#a5d8ff", ["ClassName", RULE, "field: Type", RULE, "method()"].join("\n"), 124),
  codeBox("interface", "Interface", "#6741d9", "#d0bfff", ["«interface»", "InterfaceName", RULE, "", RULE, "method()"].join("\n"), 148),
  codeBox("enum", "Enum", "#f08c00", "#ffec99", ["«enum»", "EnumName", RULE, "VALUE_A", "VALUE_B"].join("\n"), 124),
];

export const ARROW_SPECS: readonly ArrowSpec[] = [
  { preset: "inherits", title: "Inherits", label: "inherits", strokeStyle: "solid", startArrowhead: null, endArrowhead: "triangle_outline" },
  { preset: "implements", title: "Implements", label: "implements", strokeStyle: "dashed", startArrowhead: null, endArrowhead: "triangle_outline" },
  { preset: "owns", title: "Owns", label: "owns", strokeStyle: "solid", startArrowhead: "diamond", endArrowhead: "arrow" },
  { preset: "uses", title: "Uses", label: "uses", strokeStyle: "dashed", startArrowhead: null, endArrowhead: "arrow" },
];

const ALL_SHAPES: readonly ShapeSpec[] = [...HLD_SHAPES, ...LLD_SHAPES];

export function shapeSpecFor(kind: string): ShapeSpec | undefined {
  return ALL_SHAPES.find((s) => s.kind === kind);
}

export function arrowSpecFor(preset: string): ArrowSpec | undefined {
  return ARROW_SPECS.find((a) => a.preset === preset);
}

export const SHAPE_KINDS: readonly ShapeKind[] = ALL_SHAPES.map((s) => s.kind);
