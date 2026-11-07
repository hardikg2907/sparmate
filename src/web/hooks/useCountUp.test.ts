import { describe, expect, it } from "vitest";
import { countUpValue } from "./useCountUp";

describe("countUpValue", () => {
  it("starts at zero and ends on the target", () => {
    expect(countUpValue(6, 0)).toBe(0);
    expect(countUpValue(6, 1)).toBe(6);
    expect(countUpValue(12.34, 1)).toBe(12.34);
  });

  it("clamps progress outside the run", () => {
    expect(countUpValue(4, -0.5)).toBe(0);
    expect(countUpValue(4, 3)).toBe(4);
  });

  it("shows whole steps for a whole-number target and eases out", () => {
    const halfway = countUpValue(100, 0.5);
    expect(Number.isInteger(halfway)).toBe(true);
    expect(halfway).toBeGreaterThan(50);
    expect(countUpValue(0.5, 0.5)).toBeCloseTo(0.4375);
  });
});
