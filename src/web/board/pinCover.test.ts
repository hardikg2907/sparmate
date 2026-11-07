import { describe, expect, it } from "vitest";
import { coveredBy, sameRects, topControlsBottom, type Rect } from "./pinCover";

// The board's controls as measured at 1440 × 900 in the pin layer's coordinates.
const toolbar: Rect = { x: 186, y: 16, w: 512, h: 46 };
const menu: Rect = { x: 16, y: 16, w: 36, h: 36 };
const zoom: Rect = { x: 16, y: 683, w: 132, h: 36 };
const help: Rect = { x: 832, y: 683, w: 36, h: 36 };
const controls = [toolbar, menu, zoom, help];
const R = 14;

describe("coveredBy", () => {
  it("hides a pin whose anchor sits under the top toolbar", () => {
    expect(coveredBy(430, 40, R, controls)).toBe(true);
  });

  it("hides a pin that only straddles the toolbar's bottom edge", () => {
    expect(coveredBy(430, 62 + R - 1, R, controls)).toBe(true);
  });

  it("shows the same pin once it is scrolled clear of the toolbar", () => {
    expect(coveredBy(430, 62 + R + 1, R, controls)).toBe(false);
  });

  it("shows a pin in the gap between the menu button and the toolbar", () => {
    expect(coveredBy(119, 40, R, controls)).toBe(false);
  });

  it("hides pins under the menu, zoom and help controls", () => {
    expect(coveredBy(34, 34, R, controls)).toBe(true);
    expect(coveredBy(80, 700, R, controls)).toBe(true);
    expect(coveredBy(850, 700, R, controls)).toBe(true);
  });

  it("shows every pin when no control is measured", () => {
    expect(coveredBy(430, 40, R, [])).toBe(false);
  });
});

describe("topControlsBottom", () => {
  it("is the lowest edge of the controls in the top half", () => {
    expect(topControlsBottom(controls, 735)).toBe(62);
  });

  it("is zero when nothing sits along the top", () => {
    expect(topControlsBottom([zoom, help], 735)).toBe(0);
  });
});

describe("sameRects", () => {
  it("compares boxes by value", () => {
    expect(sameRects([toolbar], [{ ...toolbar }])).toBe(true);
    expect(sameRects([toolbar], [{ ...toolbar, y: 17 }])).toBe(false);
    expect(sameRects([toolbar], [])).toBe(false);
  });
});
