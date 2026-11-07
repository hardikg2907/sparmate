import { describe, expect, it } from "vitest";
import { freeInsertPoint, type PlacedElement, type View } from "./placement";

const size = { width: 120, height: 80 };
const frame: PlacedElement = { id: "f", type: "frame", x: 0, y: 0, width: 1000, height: 640 };
// Centre of this view in scene coordinates is (500, 320).
const view: View = { width: 1000, height: 640, scrollX: 0, scrollY: 0, zoom: 1 };

const inside = (p: { x: number; y: number }, f: PlacedElement) =>
  p.x - size.width / 2 >= f.x && p.x + size.width / 2 <= f.x + f.width && p.y - size.height / 2 >= f.y && p.y + size.height / 2 <= f.y + f.height;

const box = (id: string, x: number, y: number, w = size.width, h = size.height, extra: Partial<PlacedElement> = {}): PlacedElement => ({
  id,
  type: "rectangle",
  x,
  y,
  width: w,
  height: h,
  ...extra,
});

describe("freeInsertPoint", () => {
  it("puts the shape at the centre of an empty view inside a frame", () => {
    const p = freeInsertPoint(view, [frame], size);
    expect(p).toEqual({ x: 500, y: 320 });
    expect(inside(p, frame)).toBe(true);
  });

  it("puts the next shape beside the first, still inside the frame", () => {
    const first = box("a", 500 - 60, 320 - 40);
    const p = freeInsertPoint(view, [frame, first], size);
    expect(p).not.toEqual({ x: 500, y: 320 });
    expect(Math.abs(p.x - 500) + Math.abs(p.y - 320)).toBeGreaterThan(0);
    expect(inside(p, frame)).toBe(true);
    const overlaps = p.x - 60 < first.x + first.width && p.x + 60 > first.x && p.y - 40 < first.y + first.height && p.y + 40 > first.y;
    expect(overlaps).toBe(false);
  });

  it("falls back to the centre when the frame has no free spot", () => {
    const full = box("big", 10, 10, 980, 620);
    const p = freeInsertPoint(view, [frame, full], size);
    expect(p).toEqual({ x: 500, y: 320 });
  });

  it("does not count frames, deleted elements or bound text as obstacles", () => {
    const deleted = box("d", 440, 280, 120, 80, { isDeleted: true });
    const text = box("t", 440, 280, 120, 80, { type: "text", containerId: "c" });
    expect(freeInsertPoint(view, [frame, deleted, text], size)).toEqual({ x: 500, y: 320 });
    expect(freeInsertPoint(view, [frame], size)).toEqual({ x: 500, y: 320 });
  });

  it("keeps free text and arrows as obstacles", () => {
    const text = box("t", 440, 280, 120, 80, { type: "text" });
    const p = freeInsertPoint(view, [frame, text], size);
    expect(p).not.toEqual({ x: 500, y: 320 });
  });

  it("works as before when the centre is outside any frame", () => {
    const away: View = { ...view, scrollX: -5000, scrollY: -5000 };
    expect(freeInsertPoint(away, [frame], size)).toEqual({ x: 5500, y: 5320 });
    const first = box("a", 5500 - 60, 5320 - 40);
    const p = freeInsertPoint(away, [frame, first], size);
    expect(p).not.toEqual({ x: 5500, y: 5320 });
    expect(Math.abs(p.x - 5500)).toBeLessThanOrEqual(6 * (size.width + 48));
  });

  it("accounts for zoom and scroll when it finds the centre", () => {
    const zoomed: View = { width: 800, height: 400, scrollX: -100, scrollY: -50, zoom: 2 };
    expect(freeInsertPoint(zoomed, [], size)).toEqual({ x: 300, y: 150 });
  });
});
