import type { BoardGraph } from "../types";
import { graphToText, sceneToGraph } from "./sceneToGraph";

type Raw = Record<string, unknown>;

const FRAME_TYPES = new Set(["frame", "magicframe"]);
const SHAPE_TYPES = new Set(["rectangle", "ellipse", "diamond"]);
const EDGE_TYPES = new Set(["arrow", "line"]);
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const STEP_PATTERN = /^[a-z_]{1,40}$/;
const MAX_TARGET_LABEL = 80;
const MAX_TARGETS = 300;
/** A line whose ends are this close is a drawn outline, not a connection. */
const CLOSED_TOLERANCE = 8;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function live(elements: readonly Raw[]): Raw[] {
  return elements.filter((el) => typeof el === "object" && el !== null && el.isDeleted !== true && typeof el.id === "string");
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function boxOf(el: Raw): Box {
  return { x: num(el.x), y: num(el.y), w: Math.abs(num(el.width)), h: Math.abs(num(el.height)) };
}

function contains(box: Box, x: number, y: number): boolean {
  return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
}

function stepOfFrame(el: Raw): string | null {
  const data = el.customData;
  if (typeof data !== "object" || data === null) return null;
  const step = (data as Raw).step;
  return typeof step === "string" && STEP_PATTERN.test(step) ? step : null;
}

/** Step id to frame element, for the frames the app laid out. The first frame of a step wins. */
export function stepFrames(elements: readonly Raw[]): Map<string, Raw> {
  const out = new Map<string, Raw>();
  for (const el of live(elements)) {
    if (!FRAME_TYPES.has(String(el.type))) continue;
    const step = stepOfFrame(el);
    if (step !== null && !out.has(step)) out.set(step, el);
  }
  return out;
}

/**
 * Elements that sit inside a frame but were never put in it (palette inserts, pasted shapes, a box moved by
 * keyboard) get that frame's id, by the centre of the element; bound text follows its container. Excalidraw
 * assigns membership only for pointer gestures, so without this pass most evidence would fall outside its step.
 */
export function withFrameMembership(elements: readonly Raw[]): Raw[] {
  const all = live(elements);
  const frames = all.filter((el) => FRAME_TYPES.has(String(el.type))).map((el) => ({ id: String(el.id), box: boxOf(el) }));
  if (frames.length === 0) return all;
  const assigned = new Map<string, string | null>();
  const frameAt = (el: Raw): string | null => {
    const own = str(el.frameId);
    if (own !== null) return own;
    const box = boxOf(el);
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    let best: { id: string; area: number } | null = null;
    for (const frame of frames) {
      if (!contains(frame.box, cx, cy)) continue;
      const area = frame.box.w * frame.box.h;
      if (best === null || area < best.area) best = { id: frame.id, area };
    }
    return best?.id ?? null;
  };
  const byId = new Map(all.map((el) => [String(el.id), el]));
  for (const el of all) {
    if (FRAME_TYPES.has(String(el.type))) continue;
    const container = str(el.containerId);
    const owner = container !== null ? byId.get(container) : undefined;
    assigned.set(String(el.id), frameAt(owner ?? el));
  }
  return all.map((el) => {
    const frameId = assigned.get(String(el.id));
    return frameId === undefined || frameId === (str(el.frameId) ?? null) ? el : { ...el, frameId };
  });
}

/** The step a board element belongs to, through the step frame that holds it. */
export function stepOfElement(elements: readonly Raw[], elementId: string): string | null {
  const members = withFrameMembership(elements);
  const el = members.find((e) => e.id === elementId);
  const frameId = el ? str(el.frameId) : null;
  if (frameId === null) return null;
  const frame = members.find((e) => e.id === frameId);
  return frame ? stepOfFrame(frame) : null;
}

export interface FrameEvidence {
  /** Null when the board has no frame for this step. */
  frameId: string | null;
  /** The frame's part of the board in the text form the models read. */
  text: string;
  /** Nothing is drawn or written in the frame. */
  empty: boolean;
  /** True when the text form cannot carry the whole frame, so a reader needs an image of it. */
  needsImage: boolean;
  reasons: string[];
}

function isClosedLine(el: Raw): boolean {
  if (el.type !== "line") return false;
  const points = Array.isArray(el.points) ? (el.points as unknown[]) : [];
  if (points.length < 3) return false;
  const first = points[0];
  const last = points[points.length - 1];
  if (!Array.isArray(first) || !Array.isArray(last)) return false;
  return Math.hypot(num(first[0]) - num(last[0]), num(first[1]) - num(last[1])) <= CLOSED_TOLERANCE;
}

function bindingOf(value: unknown): string | null {
  return typeof value === "object" && value !== null ? str((value as Raw).elementId) : null;
}

/**
 * One step's share of the board: what sits in its frame, as text, and whether an image is needed to read it.
 * The graph is built from the whole scene first, so an arrow to a box in another frame still counts as bound.
 */
export function frameEvidence(elements: readonly Raw[], step: string): FrameEvidence {
  const members = withFrameMembership(elements);
  const frame = stepFrames(members).get(step);
  if (!frame) return { frameId: null, text: "", empty: true, needsImage: false, reasons: [] };
  const frameId = String(frame.id);
  const graph = sceneToGraph(members);
  const name = graphFrameName(members, frameId);
  const inFrame = new Set(graph.nodes.filter((n) => n.frame === name).map((n) => n.key));
  const edges = graph.edges.filter((e) => (e.from !== null && inFrame.has(e.from)) || (e.to !== null && inFrame.has(e.to)));
  const ends = new Set(edges.flatMap((e) => [e.from, e.to]).filter((k): k is string => k !== null));
  const sub: BoardGraph = {
    nodes: graph.nodes.filter((n) => inFrame.has(n.key) || ends.has(n.key)),
    edges,
    freeText: graph.freeText.filter((t) => t.frame === name),
    frames: [name],
    opaque: graph.opaque.filter((o) => o.frame === name),
    warnings: [],
  };
  const empty = sub.nodes.length === 0 && sub.freeText.length === 0 && sub.opaque.length === 0;
  const reasons: string[] = [];
  if (sub.opaque.length > 0) reasons.push("freehand drawing");
  const looseArrow = members.some(
    (el) => EDGE_TYPES.has(String(el.type)) && str(el.frameId) === frameId && !isClosedLine(el) && (bindingOf(el.startBinding) === null || bindingOf(el.endBinding) === null),
  );
  if (looseArrow) reasons.push("an arrow not joined at both ends");
  if (graph.nodes.some((n) => inFrame.has(n.key) && n.label === "" && n.shape !== "text")) reasons.push("a shape with no label");
  return { frameId, text: empty ? "Nothing in this frame yet." : graphToText(sub), empty, needsImage: reasons.length > 0, reasons };
}

/** The frame name sceneToGraph gives a frame: its own name, or "Frame n" by position among the frames. */
function graphFrameName(elements: readonly Raw[], frameId: string): string {
  const frames = elements.filter((el) => FRAME_TYPES.has(String(el.type)));
  const index = frames.findIndex((el) => el.id === frameId);
  const own = frames[index]?.name;
  const name = typeof own === "string" ? own.replace(/\s+/g, " ").trim() : "";
  return name !== "" ? name : `Frame ${index + 1}`;
}

export interface PinTarget {
  id: string;
  kind: "box" | "arrow";
  label: string;
  step: string | null;
}

/** Boxes and arrows a model may attach a note to, with the ids it must use. */
export function pinTargets(elements: readonly Raw[]): PinTarget[] {
  const members = withFrameMembership(elements);
  const frames = new Map(members.filter((el) => FRAME_TYPES.has(String(el.type))).map((el) => [String(el.id), stepOfFrame(el)]));
  const labels = new Map<string, string>();
  for (const el of members) {
    const container = str(el.containerId);
    if (el.type !== "text" || container === null) continue;
    const text = String(el.originalText ?? el.text ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (text !== "") labels.set(container, text.length > MAX_TARGET_LABEL ? `${text.slice(0, MAX_TARGET_LABEL - 1)}…` : text);
  }
  const out: PinTarget[] = [];
  for (const el of members) {
    const type = String(el.type);
    const id = String(el.id);
    if (!ID_PATTERN.test(id)) continue;
    const kind = SHAPE_TYPES.has(type) ? "box" : EDGE_TYPES.has(type) && !isClosedLine(el) ? "arrow" : null;
    if (kind === null) continue;
    const frameId = str(el.frameId);
    out.push({ id, kind, label: labels.get(id) ?? "", step: frameId === null ? null : (frames.get(frameId) ?? null) });
    if (out.length >= MAX_TARGETS) break;
  }
  return out;
}

export function pinTargetsText(targets: readonly PinTarget[]): string {
  if (targets.length === 0) return "No boxes or arrows on the board yet.";
  return targets.map((t) => `- ${t.id}: ${t.kind}${t.label ? ` ${JSON.stringify(t.label)}` : " (no label)"}${t.step ? ` in step ${t.step}` : ""}`).join("\n");
}

export function isPinTargetId(id: string): boolean {
  return ID_PATTERN.test(id);
}
