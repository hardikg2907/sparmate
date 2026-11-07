import type { BoardGraph, GraphEdge, GraphNode } from "../types";

type Raw = Record<string, unknown>;

interface Point {
  x: number;
  y: number;
}
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Class = "shape" | "text" | "edge" | "frame" | "opaque";

interface Element {
  id: string;
  type: string;
  cls: Class;
  box: Box;
  groupIds: string[];
  frameId: string | null;
  containerId: string | null;
  /** Text content (originalText preferred), whitespace collapsed. Empty for non-text elements. */
  text: string;
  frameName: string | null;
  kind: string | null;
  style: GraphEdge["style"];
  startBinding: string | null;
  endBinding: string | null;
  startHead: boolean;
  endHead: boolean;
  start: Point;
  end: Point;
  /** A line whose last point returns to its first: a drawn shape, not a connection. */
  closed: boolean;
  seq: number;
}

interface NodeInfo {
  key: string;
  shape: string;
  kind: string | null;
  frameId: string | null;
  rects: Box[];
  extent: Box;
  label: string;
  seq: number;
}

/** Arrow ends bound to nothing attach to a box whose edge is at most this far away. */
const GUESS_DISTANCE = 40;
/** Boxes whose vertical centres differ by less than this read as one row. */
const ROW_TOLERANCE = 40;
const MIN_NODES_FOR_ISOLATION_WARNING = 3;
const MAX_LABEL_CHARS = 200;
const MAX_FREE_TEXT_CHARS = 400;
const MAX_LINES_PER_SECTION = 400;

const SHAPE_TYPES = new Set(["rectangle", "ellipse", "diamond"]);
const FRAME_TYPES = new Set(["frame", "magicframe"]);
const EDGE_TYPES = new Set(["arrow", "line"]);
const OPAQUE_KINDS: Record<string, string> = { freedraw: "freedraw", image: "image", embeddable: "embed", iframe: "embed" };
const KIND_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

/** Builds the text-friendly graph of a whiteboard from non-deleted Excalidraw elements. Pure. */
export function sceneToGraph(elements: readonly Record<string, unknown>[]): BoardGraph {
  const parsed: Element[] = [];
  elements.forEach((raw, seq) => {
    const element = parseElement(raw, seq);
    if (element) parsed.push(element);
  });
  const byId = new Map(parsed.map((e) => [e.id, e]));

  // Frames
  const frameElements = parsed.filter((e) => e.cls === "frame");
  const frameNames = new Map<string, string>();
  frameElements.forEach((frame, index) => frameNames.set(frame.id, frame.frameName ?? `Frame ${index + 1}`));
  const frameNameOf = (frameId: string | null): string | null => (frameId === null ? null : (frameNames.get(frameId) ?? null));
  const orderedFrames = readingSort(
    frameElements,
    () => 0,
    (f) => center(f.box),
  );
  const frameRank = new Map(orderedFrames.map((f, index) => [f.id, index]));
  const rankOfFrame = (frameId: string | null): number => (frameId === null ? -1 : (frameRank.get(frameId) ?? -1));

  // Groups: the outermost group is the unit. A group holding any container shape is one node.
  const outerGroup = (e: Element): string | null => e.groupIds.at(-1) ?? null;
  const groupMembers = new Map<string, Element[]>();
  for (const e of parsed) {
    const group = e.cls === "frame" ? null : outerGroup(e);
    if (group !== null) pushTo(groupMembers, group, e);
  }
  const nodeGroups = new Set([...groupMembers].filter(([, members]) => members.some((m) => m.cls === "shape")).map(([group]) => group));
  const keyOfShape = (shape: Element): string => outerGroup(shape) ?? shape.id;

  // Nodes from container shapes
  const nodes = new Map<string, NodeInfo>();
  for (const shape of parsed) {
    if (shape.cls !== "shape") continue;
    const key = keyOfShape(shape);
    const existing = nodes.get(key);
    if (existing) {
      existing.rects.push(shape.box);
      existing.extent = union(existing.extent, shape.box);
      existing.frameId ??= shape.frameId;
      continue;
    }
    const grouped = nodeGroups.has(key);
    const kind = grouped ? (groupMembers.get(key)?.find((m) => m.kind !== null)?.kind ?? null) : shape.kind;
    nodes.set(key, {
      key,
      shape: grouped ? "group" : shape.type,
      kind,
      frameId: shape.frameId,
      rects: [shape.box],
      extent: shape.box,
      label: "",
      seq: shape.seq,
    });
  }

  // Text: bound to a shape or an arrow, inside a group node, or free
  const nodeTexts = new Map<string, Element[]>();
  const edgeTexts = new Map<string, Element[]>();
  const freeTexts: Element[] = [];
  for (const text of parsed) {
    if (text.cls !== "text" || text.text === "") continue;
    const container = text.containerId === null ? undefined : byId.get(text.containerId);
    if (container?.cls === "shape") {
      pushTo(nodeTexts, keyOfShape(container), text);
      continue;
    }
    if (container?.cls === "edge") {
      pushTo(edgeTexts, container.id, text);
      continue;
    }
    const group = outerGroup(text);
    if (group !== null && nodeGroups.has(group)) {
      pushTo(nodeTexts, group, text);
      continue;
    }
    freeTexts.push(text);
  }

  // Free text that an arrow is attached to is itself a node.
  const edgeElements = parsed.filter((e) => e.cls === "edge" && !e.closed);
  const attachedIds = new Set<string>();
  for (const edge of edgeElements) {
    if (edge.startBinding !== null) attachedIds.add(edge.startBinding);
    if (edge.endBinding !== null) attachedIds.add(edge.endBinding);
  }
  const remainingFree: Element[] = [];
  for (const text of freeTexts) {
    if (!attachedIds.has(text.id)) {
      remainingFree.push(text);
      continue;
    }
    nodes.set(text.id, {
      key: text.id,
      shape: "text",
      kind: null,
      frameId: text.frameId,
      rects: [text.box],
      extent: text.box,
      label: clip(text.text, MAX_LABEL_CHARS),
      seq: text.seq,
    });
  }

  // Free text inside an unlabeled shape labels it; the smallest containing box wins.
  const containedTexts = new Map<string, Element[]>();
  const stillFree: Element[] = [];
  const candidates = [...nodes.values()].filter((n) => n.shape !== "text").flatMap((node) => node.rects.map((rect) => ({ node, rect, area: rect.w * rect.h })));
  for (const text of remainingFree) {
    const middle = center(text.box);
    let best: (typeof candidates)[number] | null = null;
    for (const candidate of candidates) {
      if (!contains(candidate.rect, middle)) continue;
      if (best === null || candidate.area < best.area) best = candidate;
    }
    if (best !== null && !nodeTexts.has(best.node.key)) pushTo(containedTexts, best.node.key, text);
    else stillFree.push(text);
  }

  for (const node of nodes.values()) {
    if (node.shape === "text") continue;
    const parts = nodeTexts.get(node.key) ?? containedTexts.get(node.key) ?? [];
    node.label = clip(joinTexts(parts), MAX_LABEL_CHARS);
  }

  // Edges
  const nodeList = [...nodes.values()];
  /** The node an element belongs to: its shape, the shape its text is bound to, its group, or itself for a text node. */
  const nodeKeyOf = (element: Element): string | null => {
    if (element.cls === "shape") return keyOfShape(element);
    if (element.cls === "frame") return null;
    if (element.cls === "text") {
      const container = element.containerId === null ? undefined : byId.get(element.containerId);
      if (container?.cls === "shape") return keyOfShape(container);
    }
    const group = outerGroup(element);
    if (group !== null && nodeGroups.has(group)) return group;
    return element.cls === "text" ? element.id : null;
  };
  const resolveEnd = (binding: string | null, point: Point): { key: string | null; guessed: boolean } => {
    const bound = binding === null ? undefined : byId.get(binding);
    if (bound) {
      const key = nodeKeyOf(bound);
      if (key !== null && nodes.has(key)) return { key, guessed: false };
    }
    let nearest: { key: string; distance: number; area: number } | null = null;
    for (const node of nodeList) {
      for (const rect of node.rects) {
        const distance = distanceToBox(point, rect);
        if (distance > GUESS_DISTANCE) continue;
        const area = rect.w * rect.h;
        if (nearest === null || distance < nearest.distance || (distance === nearest.distance && area < nearest.area)) {
          nearest = { key: node.key, distance, area };
        }
      }
    }
    return nearest === null ? { key: null, guessed: false } : { key: nearest.key, guessed: true };
  };

  interface EdgeInfo {
    edge: GraphEdge;
    start: Point;
    seq: number;
  }
  const edges: EdgeInfo[] = [];
  for (const element of edgeElements) {
    const from = resolveEnd(element.startBinding, element.start);
    const to = resolveEnd(element.endBinding, element.end);
    const group = outerGroup(element);
    // An arrow drawn as part of a grouped shape's own artwork is not a connection to anything else.
    if (group !== null && nodeGroups.has(group) && from.key === group && to.key === group) continue;
    const quality: GraphEdge["quality"] = from.key === null || to.key === null ? "dangling" : from.guessed || to.guessed ? "guessed" : "bound";
    edges.push({
      edge: {
        from: from.key,
        to: to.key,
        label: clip(joinTexts(edgeTexts.get(element.id) ?? []), MAX_LABEL_CHARS),
        style: element.style,
        arrow: element.startHead && element.endHead ? "both" : element.endHead ? "forward" : element.startHead ? "backward" : "none",
        quality,
      },
      start: element.start,
      seq: element.seq,
    });
  }

  // Order everything: by frame, then top to bottom, left to right.
  const sortedNodes = readingSort(
    nodeList,
    (n) => rankOfFrame(n.frameId),
    (n) => center(n.extent),
  );
  const nodeRank = new Map(sortedNodes.map((n, index) => [n.key, index]));
  const rankOfNode = (key: string | null): number => (key === null ? Number.MAX_SAFE_INTEGER : (nodeRank.get(key) ?? Number.MAX_SAFE_INTEGER));
  edges.sort((a, b) => rankOfNode(a.edge.from) - rankOfNode(b.edge.from) || rankOfNode(a.edge.to) - rankOfNode(b.edge.to) || a.seq - b.seq);

  const sortedFree = readingSort(
    stillFree,
    (t) => rankOfFrame(t.frameId),
    (t) => center(t.box),
  );

  const opaqueItems = parsed.filter((e) => {
    const group = outerGroup(e);
    if (group !== null && nodeGroups.has(group)) return false;
    return e.cls === "opaque" || (e.cls === "edge" && e.closed);
  });
  const sortedOpaque = readingSort(
    opaqueItems,
    (e) => rankOfFrame(e.frameId),
    (e) => center(e.box),
  );

  // Warnings
  const warnings: string[] = [];
  const describeNode = (key: string): string => {
    const label = nodes.get(key)?.label ?? "";
    return label === "" ? "(no label)" : label;
  };
  for (const node of sortedNodes) {
    if (node.label === "" && node.shape !== "text") {
      warnings.push(`unlabeled ${node.kind ?? node.shape} near (${Math.round(node.extent.x)}, ${Math.round(node.extent.y)})`);
    }
  }
  for (const { edge, start } of edges) {
    if (edge.quality !== "dangling") continue;
    if (edge.from !== null) warnings.push(`arrow from [${describeNode(edge.from)}] does not end at a box`);
    else if (edge.to !== null) warnings.push(`arrow to [${describeNode(edge.to)}] does not start at a box`);
    else warnings.push(`an arrow near (${Math.round(start.x)}, ${Math.round(start.y)}) touches no box`);
  }
  if (sortedNodes.length >= MIN_NODES_FOR_ISOLATION_WARNING) {
    const connected = new Set<string>();
    for (const { edge } of edges) {
      if (edge.from !== null) connected.add(edge.from);
      if (edge.to !== null) connected.add(edge.to);
    }
    for (const node of sortedNodes) {
      if (connected.has(node.key)) continue;
      warnings.push(node.label === "" ? `node near (${Math.round(node.extent.x)}, ${Math.round(node.extent.y)}) has no connections` : `node [${node.label}] has no connections`);
    }
  }

  return {
    nodes: sortedNodes.map((n): GraphNode => ({ key: n.key, label: n.label, kind: n.kind, shape: n.shape, frame: frameNameOf(n.frameId) })),
    edges: edges.map((e) => e.edge),
    freeText: sortedFree.map((t) => ({ text: clip(t.text, MAX_FREE_TEXT_CHARS), frame: frameNameOf(t.frameId) })),
    frames: orderedFrames.map((f) => frameNames.get(f.id) ?? ""),
    opaque: sortedOpaque.map((e) => ({ kind: e.cls === "edge" ? "polygon" : (OPAQUE_KINDS[e.type] ?? e.type), frame: frameNameOf(e.frameId) })),
    warnings,
  };
}

/** Renders a graph in the stable text form the models read (see docs/SPEC.md section 7.2). Pure. */
export function graphToText(graph: BoardGraph): string {
  if (graph.nodes.length === 0 && graph.edges.length === 0 && graph.freeText.length === 0 && graph.opaque.length === 0 && graph.warnings.length === 0) {
    return "The board is empty.";
  }

  const labelOf = new Map(graph.nodes.map((n) => [n.key, n.label === "" ? "(no label)" : n.label]));
  const endName = (key: string | null): string => (key === null ? "?" : `[${labelOf.get(key) ?? "?"}]`);
  const lines: string[] = [];

  lines.push(
    ...section(
      "Nodes",
      graph.nodes.map((n) => `- [${n.label === "" ? "(no label)" : n.label}]${nodeSuffix(n)}${frameSuffix(n.frame)}`),
    ),
  );
  lines.push(
    ...section(
      "Edges",
      graph.edges.map((e) => {
        const flags = [e.style === "solid" ? null : e.style, e.quality === "bound" ? null : e.quality].filter((f) => f !== null);
        const label = e.label === "" ? "" : ` ${JSON.stringify(e.label)}`;
        const flagText = flags.length === 0 ? "" : ` (${flags.join(", ")})`;
        return `- ${endName(e.from)} ${ARROWS[e.arrow]} ${endName(e.to)}${label}${flagText}`;
      }),
    ),
  );

  if (graph.freeText.length > 0) {
    lines.push("Text on the board:", ...capped(graph.freeText.map((t) => `- ${JSON.stringify(t.text)}${frameSuffix(t.frame)}`)));
  }
  if (graph.opaque.length > 0) lines.push(`Not readable as text: ${describeOpaque(graph.opaque)}`);
  if (graph.warnings.length > 0) lines.push(`Warnings: ${graph.warnings.join("; ")}`);
  return lines.join("\n");
}

const ARROWS: Record<GraphEdge["arrow"], string> = { forward: "->", backward: "<-", both: "<->", none: "--" };

function section(title: string, items: string[]): string[] {
  return items.length === 0 ? [`${title}: none`] : [`${title}:`, ...capped(items)];
}

function capped(items: string[]): string[] {
  if (items.length <= MAX_LINES_PER_SECTION) return items;
  return [...items.slice(0, MAX_LINES_PER_SECTION), `- ... and ${items.length - MAX_LINES_PER_SECTION} more`];
}

function nodeSuffix(node: GraphNode): string {
  if (node.kind !== null) return ` (kind: ${node.kind})`;
  return node.shape === "rectangle" ? "" : ` (${node.shape})`;
}

function frameSuffix(frame: string | null): string {
  return frame === null ? "" : ` in frame ${JSON.stringify(frame)}`;
}

const OPAQUE_NAMES: Record<string, [string, string]> = {
  freedraw: ["freehand stroke", "freehand strokes"],
  image: ["image", "images"],
  polygon: ["closed line shape", "closed line shapes"],
  embed: ["embedded item", "embedded items"],
};

function describeOpaque(items: BoardGraph["opaque"]): string {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  const known = Object.keys(OPAQUE_NAMES).filter((kind) => counts.has(kind));
  const other = [...counts.keys()].filter((kind) => !Object.hasOwn(OPAQUE_NAMES, kind)).sort();
  return [...known, ...other]
    .map((kind) => {
      const count = counts.get(kind) ?? 0;
      const names = (Object.hasOwn(OPAQUE_NAMES, kind) ? OPAQUE_NAMES[kind] : undefined) ?? [kind, `${kind} items`];
      return `${count} ${count === 1 ? names[0] : names[1]}`;
    })
    .join(", ");
}

// ---------------------------------------------------------------------------
// Parsing

function parseElement(raw: Raw, seq: number): Element | null {
  if (typeof raw !== "object" || raw === null || raw.isDeleted === true) return null;
  const { id, type } = raw;
  if (typeof id !== "string" || id === "" || typeof type !== "string") return null;

  let cls: Class;
  if (SHAPE_TYPES.has(type)) cls = "shape";
  else if (type === "text") cls = "text";
  else if (EDGE_TYPES.has(type)) cls = "edge";
  else if (FRAME_TYPES.has(type)) cls = "frame";
  else if (Object.hasOwn(OPAQUE_KINDS, type)) cls = "opaque";
  else return null;

  const x = finite(raw.x);
  const y = finite(raw.y);
  const width = finite(raw.width);
  const height = finite(raw.height);
  const box: Box = {
    x: width < 0 ? x + width : x,
    y: height < 0 ? y + height : y,
    w: Math.abs(width),
    h: Math.abs(height),
  };

  const points = readPoints(raw.points);
  const first = points[0] ?? { x: 0, y: 0 };
  const last = points.at(-1) ?? { x: width, y: height };
  const start: Point = { x: x + first.x, y: y + first.y };
  const end: Point = { x: x + last.x, y: y + last.y };
  const closed = type === "line" && points.length >= 3 && Math.hypot(first.x - last.x, first.y - last.y) < 2;

  const customData = isRecord(raw.customData) ? raw.customData : null;
  const kindValue = customData?.kind;
  const strokeStyle = raw.strokeStyle;

  return {
    id,
    type,
    cls,
    box,
    groupIds: Array.isArray(raw.groupIds) ? raw.groupIds.filter((g): g is string => typeof g === "string" && g !== "") : [],
    frameId: typeof raw.frameId === "string" && raw.frameId !== "" ? raw.frameId : null,
    containerId: typeof raw.containerId === "string" && raw.containerId !== "" ? raw.containerId : null,
    text: cls === "text" ? readText(raw) : "",
    frameName: typeof raw.name === "string" && raw.name.trim() !== "" ? clip(collapse(raw.name), MAX_LABEL_CHARS) : null,
    kind: typeof kindValue === "string" && KIND_PATTERN.test(kindValue) ? kindValue : null,
    style: strokeStyle === "dashed" || strokeStyle === "dotted" ? strokeStyle : "solid",
    startBinding: bindingId(raw.startBinding),
    endBinding: bindingId(raw.endBinding),
    startHead: raw.startArrowhead !== null && raw.startArrowhead !== undefined && raw.startArrowhead !== false,
    endHead: raw.endArrowhead !== null && raw.endArrowhead !== undefined && raw.endArrowhead !== false,
    start,
    end,
    closed,
    seq,
  };
}

function readText(raw: Raw): string {
  const original = typeof raw.originalText === "string" ? flatten(raw.originalText) : "";
  if (original !== "") return original;
  return typeof raw.text === "string" ? flatten(raw.text) : "";
}

/**
 * Collapses text to one line. A class box separates its name, fields and methods with a line of dashes;
 * on one line that line becomes a bar, so the three parts stay apart without 20 dashes of noise.
 */
function flatten(text: string): string {
  return collapse(
    text
      .split(/\r\n|\r|\n/)
      .map((line) => (/^\s*[-\u2500\u2501]{3,}\s*$/.test(line) ? " | " : line))
      .join(" "),
  );
}

function readPoints(value: unknown): Point[] {
  if (!Array.isArray(value)) return [];
  const points: Point[] = [];
  for (const entry of value) {
    if (Array.isArray(entry) && typeof entry[0] === "number" && typeof entry[1] === "number" && Number.isFinite(entry[0]) && Number.isFinite(entry[1])) {
      points.push({ x: entry[0], y: entry[1] });
    }
  }
  return points;
}

function bindingId(value: unknown): string | null {
  return isRecord(value) && typeof value.elementId === "string" && value.elementId !== "" ? value.elementId : null;
}

// ---------------------------------------------------------------------------
// Geometry and ordering

function center(box: Box): Point {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

function contains(box: Box, point: Point): boolean {
  return point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;
}

function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

function distanceToBox(point: Point, box: Box): number {
  const dx = Math.max(box.x - point.x, 0, point.x - (box.x + box.w));
  const dy = Math.max(box.y - point.y, 0, point.y - (box.y + box.h));
  return Math.hypot(dx, dy);
}

/** Orders by rank, then rows from top to bottom, then left to right inside a row. Deterministic for equal positions. */
function readingSort<T>(items: readonly T[], rank: (item: T) => number, middle: (item: T) => Point): T[] {
  const byRank = new Map<number, { item: T; index: number; c: Point }[]>();
  items.forEach((item, index) => pushTo(byRank, rank(item), { item, index, c: middle(item) }));

  const sorted: T[] = [];
  for (const key of [...byRank.keys()].sort((a, b) => a - b)) {
    const entries = (byRank.get(key) ?? []).sort((a, b) => a.c.y - b.c.y || a.c.x - b.c.x || a.index - b.index);
    let row: typeof entries = [];
    let rowTop = 0;
    const flush = (): void => {
      row.sort((a, b) => a.c.x - b.c.x || a.index - b.index);
      for (const entry of row) sorted.push(entry.item);
      row = [];
    };
    for (const entry of entries) {
      if (row.length > 0 && entry.c.y - rowTop > ROW_TOLERANCE) flush();
      if (row.length === 0) rowTop = entry.c.y;
      row.push(entry);
    }
    flush();
  }
  return sorted;
}

function joinTexts(texts: readonly Element[]): string {
  const ordered = readingSort(
    texts,
    () => 0,
    (t) => center(t.box),
  );
  return collapse(ordered.map((t) => t.text).join(" "));
}

// ---------------------------------------------------------------------------
// Small helpers

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function clip(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
