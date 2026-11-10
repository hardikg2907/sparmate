import { describe, expect, it } from "vitest";
import { scoreFill } from "./scoreTone";

describe("scoreFill", () => {
  it("shows 3 and 4 as success", () => {
    expect(scoreFill(4)).toBe("bg-success-fill");
    expect(scoreFill(3)).toBe("bg-success-fill");
  });

  it("shows 2 as warning", () => {
    expect(scoreFill(2)).toBe("bg-warning-fill");
    expect(scoreFill(2.9)).toBe("bg-warning-fill");
  });

  it("shows 1 as destructive", () => {
    expect(scoreFill(1)).toBe("bg-destructive-fill");
    expect(scoreFill(1.9)).toBe("bg-destructive-fill");
  });
});
