import { describe, expect, it } from "vitest";
import { clockStart, earlyNote } from "./drillStart";

describe("earlyNote", () => {
  it("names tomorrow in words", () => {
    expect(earlyNote("2026-03-11", "2026-03-10")).toBe("Due tomorrow. An early try is practice only.");
  });

  it("names a later day as a date", () => {
    expect(earlyNote("2026-03-13", "2026-03-10")).toMatch(/^Due .*13.*\. An early try is practice only\.$/);
  });
});

describe("clockStart", () => {
  it("waits until the first keystroke", () => {
    expect(clockStart(null, "", 5)).toBeNull();
    expect(clockStart(null, "   ", 5)).toBeNull();
    expect(clockStart(null, "R", 5)).toBe(5);
  });

  it("keeps a clock that already runs", () => {
    expect(clockStart(3, "Reads", 9)).toBe(3);
    expect(clockStart(3, "", 9)).toBe(3);
  });
});
