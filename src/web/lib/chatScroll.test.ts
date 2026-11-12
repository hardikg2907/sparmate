import { describe, expect, it } from "vitest";
import { JUMP_ZONE_PX, followAfterScroll, scrollsBack, showJumpToLatest, wheelReadsBack } from "./chatScroll";

const view = (prevTop: number, top: number, scrollHeight = 2000, clientHeight = 500) => ({ prevTop, top, scrollHeight, clientHeight });

describe("followAfterScroll", () => {
  it("stops following on a small upward scroll near the end", () => {
    expect(followAfterScroll(true, view(1500, 1470))).toBe(false);
  });

  it("stays stopped while new text grows the log below him", () => {
    expect(followAfterScroll(false, view(1200, 1200, 2600))).toBe(false);
  });

  it("follows again when he scrolls back down to the end", () => {
    expect(followAfterScroll(false, view(1400, 1490))).toBe(true);
    expect(followAfterScroll(false, view(1490, 1500))).toBe(true);
  });

  it("does not follow again on a downward scroll that stops short of the end", () => {
    expect(followAfterScroll(false, view(800, 1000))).toBe(false);
  });

  it("keeps following when a finished reply shrinks the log and nudges the scroll up at the end", () => {
    expect(followAfterScroll(true, view(1540, 1500))).toBe(true);
  });
});

describe("scrollsBack", () => {
  it("knows the keys that read back", () => {
    expect(scrollsBack("PageUp")).toBe(true);
    expect(scrollsBack("ArrowDown")).toBe(false);
  });
});

describe("showJumpToLatest", () => {
  it("stays hidden while the log follows", () => {
    expect(showJumpToLatest(true, 800)).toBe(false);
  });

  it("stays hidden for a small step back from the end", () => {
    expect(showJumpToLatest(false, 20)).toBe(false);
    expect(showJumpToLatest(false, JUMP_ZONE_PX)).toBe(false);
  });

  it("shows once he is well away from the end", () => {
    expect(showJumpToLatest(false, JUMP_ZONE_PX + 1)).toBe(true);
  });
});

describe("wheelReadsBack", () => {
  it("reads back on a clear upward turn", () => {
    expect(wheelReadsBack(0, -40)).toBe(true);
  });

  it("ignores a sideways swipe that drifts a little upward", () => {
    expect(wheelReadsBack(60, -3)).toBe(false);
  });

  it("ignores a downward turn", () => {
    expect(wheelReadsBack(0, 40)).toBe(false);
  });
});
