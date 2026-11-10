import { describe, expect, it } from "vitest";
import { targetScrollTop } from "./scrollInScroller";

const base = { targetHeight: 100, scrollerTop: 0, scrollTop: 0, clientHeight: 500, scrollHeight: 2000, block: "start" as const, offset: 0 };

describe("targetScrollTop", () => {
  it("puts the target at the top, below the sticky offset", () => {
    expect(targetScrollTop({ ...base, targetTop: 800, offset: 120 })).toBe(680);
  });

  it("counts the current scroll position and the scroller's own place in the window", () => {
    expect(targetScrollTop({ ...base, scrollerTop: 50, scrollTop: 300, targetTop: 450 })).toBe(700);
  });

  it("stops at the end when a short last section cannot reach the top", () => {
    expect(targetScrollTop({ ...base, targetTop: 1900 })).toBe(1500);
  });

  it("never goes below zero", () => {
    expect(targetScrollTop({ ...base, scrollTop: 40, targetTop: 10, offset: 200 })).toBe(0);
  });

  it("is zero when the content fits", () => {
    expect(targetScrollTop({ ...base, scrollHeight: 400, targetTop: 300 })).toBe(0);
  });

  it("centres the target", () => {
    expect(targetScrollTop({ ...base, targetTop: 1000, block: "center" })).toBe(800);
  });

  it("keeps a target that is already in view where it is", () => {
    expect(targetScrollTop({ ...base, scrollTop: 300, targetTop: 100, block: "nearest" })).toBe(300);
  });

  it("brings a target below the view to the bottom edge", () => {
    expect(targetScrollTop({ ...base, targetTop: 900, block: "nearest" })).toBe(500);
  });

  it("brings a target above the view to the top edge", () => {
    expect(targetScrollTop({ ...base, scrollTop: 800, targetTop: -300, block: "nearest" })).toBe(500);
  });
});
