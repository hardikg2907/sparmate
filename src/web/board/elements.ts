import { FONT_FAMILY, ROUNDNESS, convertToExcalidrawElements, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type {
  ExcalidrawArrowElement,
  ExcalidrawDiamondElement,
  ExcalidrawElement,
  ExcalidrawEllipseElement,
  ExcalidrawLinearElement,
  ExcalidrawRectangleElement,
  ExcalidrawTextElement,
  FixedPointBinding,
  OrderedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import type { ArrowheadName, ShapeSpec, StrokeStyle } from "./palette";

export interface Point {
  x: number;
  y: number;
}

export type BindableShape = ExcalidrawRectangleElement | ExcalidrawEllipseElement | ExcalidrawDiamondElement;

type LocalPoint = ExcalidrawLinearElement["points"][number];

// Excalidraw never stores a gap below 1, so an arrow that starts on the outline binds with this gap.
const BINDING_GAP = 1;
const FREE_ARROW_LENGTH = 180;
const ARROW_LABEL_SIZE = 16;
// Near-black on every tint: a label in its border colour (orange on pale orange) is hard to read.
const INK = "#1e1e1e";

export function isBindableShape(el: ExcalidrawElement): el is BindableShape {
  return !el.isDeleted && (el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond");
}

function centreOf(el: { x: number; y: number; width: number; height: number }): Point {
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
}

/** Point where a ray from the shape's centre toward `toward` leaves its outline. Ignores rotation. */
function outlinePoint(shape: BindableShape, toward: Point): Point {
  const c = centreOf(shape);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const hw = shape.width / 2;
  const hh = shape.height / 2;
  if (dx === 0 && dy === 0) return { x: c.x + hw, y: c.y };
  let t: number;
  if (shape.type === "ellipse") {
    t = 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2);
  } else if (shape.type === "diamond") {
    t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  } else {
    t = Math.min(dx === 0 ? Infinity : hw / Math.abs(dx), dy === 0 ? Infinity : hh / Math.abs(dy));
  }
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/** Elements for one palette shape (the shape plus its bound label), centred on `centre`. */
export function planShape(spec: ShapeSpec, label: string, centre: Point): OrderedExcalidrawElement[] {
  const skeleton: ExcalidrawElementSkeleton = {
    type: spec.shape,
    x: Math.round(centre.x - spec.width / 2),
    y: Math.round(centre.y - spec.height / 2),
    width: spec.width,
    height: spec.height,
    strokeColor: spec.stroke,
    backgroundColor: spec.fill,
    fillStyle: spec.fillStyle,
    strokeStyle: spec.strokeStyle,
    strokeWidth: spec.strokeWidth,
    roughness: spec.roughness,
    roundness: spec.rounded ? { type: ROUNDNESS.ADAPTIVE_RADIUS } : null,
    customData: { kind: spec.kind },
    label: spec.codeLabel
      ? { text: label, fontSize: spec.fontSize, fontFamily: FONT_FAMILY.Cascadia, textAlign: "left", verticalAlign: "top", strokeColor: INK }
      : { text: label, fontSize: spec.fontSize, strokeColor: INK },
  };
  return convertToExcalidrawElements([skeleton]);
}

export interface ArrowRequest {
  from: BindableShape | null;
  to: BindableShape | null;
  /** Where an arrow with no shapes to join sits, in scene coordinates. */
  at: Point;
  label: string;
  strokeStyle: StrokeStyle;
  startArrowhead: ArrowheadName | null;
  endArrowhead: ArrowheadName | null;
  /** Stored in `customData.kind` so the relation type survives even if the label is edited. */
  kind?: string;
  /** Straight, non-sketchy lines to match class boxes. */
  clean: boolean;
}

export interface ArrowPlan {
  arrowId: string;
  /** New elements: the arrow and its bound label. */
  created: OrderedExcalidrawElement[];
  /** Updated copies of the shapes the arrow binds to (they list the arrow in `boundElements`). */
  replaced: ExcalidrawElement[];
}

/**
 * Where `point` sits inside `shape`, as 0..1 ratios of its box. Excalidraw 0.18 stores this on every binding
 * and its flip and resize paths read it without a fallback, so a binding that lacks it breaks those edits.
 */
function fixedPointIn(shape: BindableShape, point: Point): [number, number] {
  const ratio = (value: number, origin: number, size: number) => (size === 0 ? 0.5 : Math.min(1, Math.max(0, (value - origin) / size)));
  return [ratio(point.x, shape.x, shape.width), ratio(point.y, shape.y, shape.height)];
}

function withBoundArrow(shape: BindableShape, arrowId: string): BindableShape {
  return newElementWith(shape, { boundElements: [...(shape.boundElements ?? []), { id: arrowId, type: "arrow" }] });
}

/**
 * Builds an arrow, with its label, that is bound to the given shapes. `convertToExcalidrawElements` can
 * only bind to shapes created in the same call, so the bindings are written here. The arrow runs along the
 * centre line, which is exactly what focus 0 means; Excalidraw recomputes the end points on the next move.
 */
export function planArrow(req: ArrowRequest): ArrowPlan {
  let start: Point;
  let end: Point;
  if (req.from && req.to) {
    const cf = centreOf(req.from);
    const ct = centreOf(req.to);
    const len = Math.hypot(ct.x - cf.x, ct.y - cf.y);
    const ux = len === 0 ? 1 : (ct.x - cf.x) / len;
    const uy = len === 0 ? 0 : (ct.y - cf.y) / len;
    const s = outlinePoint(req.from, ct);
    const e = outlinePoint(req.to, cf);
    start = { x: s.x + ux * BINDING_GAP, y: s.y + uy * BINDING_GAP };
    end = { x: e.x - ux * BINDING_GAP, y: e.y - uy * BINDING_GAP };
  } else if (req.from) {
    start = { x: req.from.x + req.from.width + BINDING_GAP, y: centreOf(req.from).y };
    end = { x: start.x + FREE_ARROW_LENGTH, y: start.y };
  } else {
    start = { x: req.at.x - FREE_ARROW_LENGTH / 2, y: req.at.y };
    end = { x: req.at.x + FREE_ARROW_LENGTH / 2, y: req.at.y };
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const point = (x: number, y: number) => [x, y] as unknown as LocalPoint;
  const skeleton: ExcalidrawElementSkeleton = {
    type: "arrow",
    x: start.x,
    y: start.y,
    width: Math.abs(dx),
    height: Math.abs(dy),
    points: [point(0, 0), point(dx, dy)],
    strokeColor: INK,
    strokeWidth: 2,
    strokeStyle: req.strokeStyle,
    roughness: req.clean ? 0 : 1,
    startArrowhead: req.startArrowhead,
    endArrowhead: req.endArrowhead,
    ...(req.kind ? { customData: { kind: req.kind } } : {}),
    ...(req.label ? { label: { text: req.label, fontSize: ARROW_LABEL_SIZE } } : {}),
  };

  const created = convertToExcalidrawElements([skeleton]);
  const at = created.findIndex((el) => el.type === "arrow");
  const converted = created[at] as OrderedExcalidrawElement & ExcalidrawArrowElement;
  const bindingTo = (shape: BindableShape | null, where: Point): FixedPointBinding | null =>
    shape ? { elementId: shape.id, focus: 0, gap: BINDING_GAP, fixedPoint: fixedPointIn(shape, where) } : null;
  // The converter shifts a labelled arrow's points by half a unit. Excalidraw expects the first point at (0, 0), and
  // an arrow that breaks that rule is sent far off the board the next time one of its ends is dragged onto a shape.
  const arrow: OrderedExcalidrawElement = {
    ...converted,
    x: start.x,
    y: start.y,
    width: Math.abs(dx),
    height: Math.abs(dy),
    points: [point(0, 0), point(dx, dy)],
    startBinding: bindingTo(req.from, start),
    endBinding: bindingTo(req.to, end),
  };
  created[at] = arrow;

  const replaced: ExcalidrawElement[] = [];
  if (req.from) replaced.push(withBoundArrow(req.from, arrow.id));
  if (req.to && req.to !== req.from) replaced.push(withBoundArrow(req.to, arrow.id));
  return { arrowId: arrow.id, created, replaced };
}

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** The first shape whose label, or any line of it, equals `label` (case and spacing ignored). */
export function findShapeByLabel(elements: readonly ExcalidrawElement[], label: string): BindableShape | null {
  const wanted = normalise(label);
  if (!wanted) return null;
  const textByContainer = new Map<string, string>();
  for (const el of elements) {
    if (el.type === "text" && !el.isDeleted && (el as ExcalidrawTextElement).containerId) {
      const text = el as ExcalidrawTextElement;
      textByContainer.set(text.containerId as string, text.originalText || text.text);
    }
  }
  for (const el of elements) {
    if (!isBindableShape(el)) continue;
    const text = textByContainer.get(el.id);
    if (text === undefined) continue;
    if (normalise(text) === wanted || text.split("\n").some((line) => normalise(line) === wanted)) return el;
  }
  return null;
}
