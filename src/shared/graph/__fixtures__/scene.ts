// Builders for Excalidraw scene elements. Every element carries the full field set that
// convertToExcalidrawElements produces in @excalidraw/excalidraw 0.18.1, so the graph builder is exercised on
// realistic JSON. Bound text, bound arrows and groups are wired the way the editor wires them.

export type Element = Record<string, unknown>;

interface Base {
  groupIds?: string[];
  frameId?: string | null;
  strokeStyle?: "solid" | "dashed" | "dotted";
  customData?: Record<string, unknown>;
  isDeleted?: boolean;
}

function base(id: string, type: string, x: number, y: number, width: number, height: number, extra: Element = {}): Element {
  return {
    id,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: "a0",
    roundness: null,
    seed: 1234,
    version: 3,
    versionNonce: 5678,
    isDeleted: false,
    boundElements: null,
    updated: 1760000000000,
    link: null,
    locked: false,
    ...extra,
  };
}

function bind(shape: Element, type: "text" | "arrow", id: string): void {
  const existing = (shape.boundElements as { type: string; id: string }[] | null) ?? [];
  shape.boundElements = [...existing, { type, id }];
}

/** A rectangle, ellipse or diamond with an optional label bound to it, the way the palette inserts one. */
export function shape(
  type: "rectangle" | "ellipse" | "diamond",
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  label?: string,
  extra: Base & Element = {},
): Element[] {
  const container = base(id, type, x, y, width, height, { roundness: type === "diamond" ? null : { type: 3 }, ...extra });
  if (label === undefined) return [container];
  const text = boundText(`${id}-label`, id, label, x + 10, y + height / 2 - 12, width - 20, 25, {
    groupIds: extra.groupIds ?? [],
    frameId: extra.frameId ?? null,
  });
  bind(container, "text", text.id as string);
  return [container, text];
}

export const rect = (id: string, x: number, y: number, w: number, h: number, label?: string, extra: Base & Element = {}): Element[] =>
  shape("rectangle", id, x, y, w, h, label, extra);

export function boundText(id: string, containerId: string, text: string, x: number, y: number, w: number, h: number, extra: Element = {}): Element {
  return textElement(id, text, x, y, w, h, { containerId, textAlign: "center", verticalAlign: "middle", ...extra });
}

export function freeText(id: string, text: string, x: number, y: number, extra: Base & Element = {}): Element {
  const longest = Math.max(...text.split("\n").map((line) => line.length), 1);
  return textElement(id, text, x, y, longest * 10, 25 * text.split("\n").length, { containerId: null, textAlign: "left", verticalAlign: "top", ...extra });
}

function textElement(id: string, text: string, x: number, y: number, w: number, h: number, extra: Element): Element {
  return base(id, "text", x, y, w, h, {
    fontSize: 20,
    fontFamily: 5,
    text,
    originalText: text,
    autoResize: true,
    lineHeight: 1.25,
    ...extra,
  });
}

interface ArrowOptions extends Base {
  label?: string;
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  type?: "arrow" | "line";
}

/** An arrow drawn between two absolute points. Pass `from` and `to` shapes to bind the ends like the editor does. */
export function arrow(id: string, start: [number, number], end: [number, number], options: ArrowOptions & { from?: Element; to?: Element } = {}): Element[] {
  const type = options.type ?? "arrow";
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const element = base(id, type, start[0], start[1], Math.abs(dx), Math.abs(dy), {
    roundness: { type: 2 },
    points: [
      [0, 0],
      [dx, dy],
    ],
    lastCommittedPoint: null,
    startBinding: options.from ? { elementId: options.from.id, focus: 0, gap: 1 } : null,
    endBinding: options.to ? { elementId: options.to.id, focus: 0, gap: 1 } : null,
    startArrowhead: options.startArrowhead ?? null,
    endArrowhead: options.endArrowhead === undefined ? (type === "arrow" ? "arrow" : null) : options.endArrowhead,
    ...(type === "arrow" ? { elbowed: false } : {}),
    ...(options.strokeStyle ? { strokeStyle: options.strokeStyle } : {}),
    ...(options.groupIds ? { groupIds: options.groupIds } : {}),
    ...(options.frameId !== undefined ? { frameId: options.frameId } : {}),
    ...(options.isDeleted ? { isDeleted: true } : {}),
  });
  if (options.from) bind(options.from, "arrow", id);
  if (options.to) bind(options.to, "arrow", id);
  if (options.label === undefined) return [element];
  const text = boundText(`${id}-label`, id, options.label, start[0] + dx / 2 - 20, start[1] + dy / 2 - 12, 40, 25);
  bind(element, "text", text.id as string);
  return [element, text];
}

/** A polyline with arbitrary relative points. */
export function polyline(id: string, x: number, y: number, points: [number, number][], extra: Element = {}): Element {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return base(id, "line", x, y, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), {
    points,
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: null,
    ...extra,
  });
}

export function freedraw(id: string, x: number, y: number, extra: Base & Element = {}): Element {
  return base(id, "freedraw", x, y, 60, 30, {
    points: [
      [0, 0],
      [20, 10],
      [60, 30],
    ],
    pressures: [],
    simulatePressure: true,
    lastCommittedPoint: [60, 30],
    ...extra,
  });
}

export function image(id: string, x: number, y: number, extra: Base & Element = {}): Element {
  return base(id, "image", x, y, 120, 80, { fileId: "file-1", status: "saved", scale: [1, 1], crop: null, ...extra });
}

export function frame(id: string, x: number, y: number, w: number, h: number, name: string | null, extra: Element = {}): Element {
  return base(id, "frame", x, y, w, h, { name, ...extra });
}

/** Marks elements as members of groups, innermost group first, as the editor stores `groupIds`. */
export function inGroup(elements: Element[], ...groupIds: string[]): Element[] {
  for (const element of elements) element.groupIds = [...groupIds];
  return elements;
}

export function withKind(elements: Element[], kind: string): Element[] {
  const [first] = elements;
  if (first) first.customData = { kind };
  return elements;
}

export function deleted(elements: Element[]): Element[] {
  for (const element of elements) element.isDeleted = true;
  return elements;
}

export const flat = (...parts: (Element | Element[])[]): Element[] => parts.flat();
