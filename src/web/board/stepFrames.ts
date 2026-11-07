import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { stepFramesFor } from "../../shared/stepFrames";
import type { Track } from "../../shared/phases";

type Raw = Record<string, unknown>;

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Scene-space box of an element. Arrows and lines are measured from their points, which may run left or up. */
export function elementBounds(el: Raw): Bounds {
  const x = num(el.x);
  const y = num(el.y);
  if (Array.isArray(el.points) && el.points.length > 0) {
    const xs = (el.points as unknown[]).map((p) => x + num(Array.isArray(p) ? p[0] : 0));
    const ys = (el.points as unknown[]).map((p) => y + num(Array.isArray(p) ? p[1] : 0));
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return { x: left, y: top, w: Math.max(...xs) - left, h: Math.max(...ys) - top };
  }
  const w = num(el.width);
  const h = num(el.height);
  return { x: w < 0 ? x + w : x, y: h < 0 ? y + h : y, w: Math.abs(w), h: Math.abs(h) };
}

export function stepOfFrameElement(el: Raw): string | null {
  if (el.type !== "frame" && el.type !== "magicframe") return null;
  const data = el.customData;
  const step = typeof data === "object" && data !== null ? (data as Raw).step : null;
  return typeof step === "string" ? step : null;
}

export function findStepFrame(elements: readonly Raw[], step: string): Raw | null {
  return elements.find((el) => el.isDeleted !== true && stepOfFrameElement(el) === step) ?? null;
}

export function hasStepFrames(elements: readonly Raw[]): boolean {
  return elements.some((el) => el.isDeleted !== true && stepOfFrameElement(el) !== null);
}

/** The step frames of a fresh board, one per step that is answered on the board, named after the step. */
export function newStepFrames(track: Track): ExcalidrawElement[] {
  const frames = convertToExcalidrawElements(
    stepFramesFor(track).map((f) => ({ type: "frame" as const, children: [], name: f.name, x: f.x, y: f.y, width: f.width, height: f.height })),
  );
  // The skeleton converter drops custom data, so the step goes on afterwards; it is what ties a frame to its step.
  return frames.map((el, i) => ({ ...el, customData: { step: stepFramesFor(track)[i]?.step } }) as ExcalidrawElement);
}

/** The step frame whose box holds a scene point, or null. */
export function stepFrameAt(elements: readonly Raw[], x: number, y: number): Raw | null {
  let best: { el: Raw; area: number } | null = null;
  for (const el of elements) {
    if (el.isDeleted === true || stepOfFrameElement(el) === null) continue;
    const b = elementBounds(el);
    if (x < b.x || x > b.x + b.w || y < b.y || y > b.y + b.h) continue;
    const area = b.w * b.h;
    if (best === null || area < best.area) best = { el, area };
  }
  return best?.el ?? null;
}
