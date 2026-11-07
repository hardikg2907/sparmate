import { describe, expect, it } from "vitest";
import type { BoardPin } from "../../shared/types";
import { MAX_PINS, validatePin, withPin } from "./pins";

const board = [
  { id: "f-design", type: "frame", x: 0, y: 500, width: 1560, height: 820, name: "High-level design", customData: { step: "design" } },
  { id: "lb", type: "rectangle", x: 100, y: 700, width: 160, height: 60 },
  { id: "lb-t", type: "text", x: 110, y: 720, width: 140, height: 20, text: "Load balancer", containerId: "lb" },
  {
    id: "a1",
    type: "arrow",
    x: 260,
    y: 730,
    width: 300,
    height: 0,
    points: [
      [0, 0],
      [300, 0],
    ],
    startBinding: { elementId: "lb" },
    endBinding: null,
  },
  { id: "note", type: "text", x: 900, y: 900, width: 100, height: 20, text: "a free note" },
  { id: "fd", type: "freedraw", x: 900, y: 1000, width: 60, height: 30 },
];

let n = 0;
const ids = () => `pin${++n}`;
const req = (over: Partial<Parameters<typeof validatePin>[2]> = {}) => ({
  elementId: "lb",
  note: "Say how it fails over.",
  tone: "note" as const,
  by: "guide" as const,
  at: 5,
  ...over,
});

describe("validatePin", () => {
  it("pins a box or an arrow and records the step of its frame", () => {
    const result = validatePin(board, [], req(), ids);
    expect(result).toMatchObject({ pin: { elementId: "lb", phase: "design", note: "Say how it fails over.", tone: "note", by: "guide", at: 5 }, replaces: null });
    expect(validatePin(board, [], req({ elementId: "a1" }), ids)).toHaveProperty("pin");
  });

  it("refuses ids that are malformed, absent, or name text, a frame or a freehand stroke", () => {
    for (const elementId of ["../etc", "nope", "note", "fd", "f-design", "x".repeat(65)]) {
      expect(validatePin(board, [], req({ elementId }), ids)).toHaveProperty("error");
    }
  });

  it("flattens the note to one plain line and refuses an empty or over-long one", () => {
    const result = validatePin(board, [], req({ note: "  line one\n <b>line</b>\ttwo  " }), ids);
    expect("pin" in result && result.pin.note).toBe("line one <b>line</b> two");
    expect(validatePin(board, [], req({ note: "\n\t " }), ids)).toEqual({ error: "The note is empty." });
    expect(validatePin(board, [], req({ note: "x".repeat(201) }), ids)).toHaveProperty("error");
  });

  it("replaces an author's earlier pin on the same element and caps the number of pins", () => {
    const first = validatePin(board, [], req(), ids);
    if (!("pin" in first)) throw new Error("expected a pin");
    const second = validatePin(board, [first.pin], req({ note: "Newer remark." }), ids);
    expect(second).toMatchObject({ replaces: first.pin.id, pin: { id: first.pin.id, note: "Newer remark." } });
    if (!("pin" in second)) throw new Error("expected a pin");
    expect(withPin([first.pin], second.pin, second.replaces)).toEqual([second.pin]);
    // The judge's pin on the same box is its own, not a replacement.
    expect(validatePin(board, [first.pin], req({ by: "judge", tone: "gap" }), ids)).toMatchObject({ replaces: null });

    const full: BoardPin[] = Array.from({ length: MAX_PINS.guide }, (_, i) => ({ id: `p${i}`, elementId: `e${i}`, phase: null, note: "x", tone: "note", by: "guide", at: 0 }));
    expect(validatePin(board, full, req(), ids)).toEqual({ error: "No more pins are allowed in this round." });
  });
});
