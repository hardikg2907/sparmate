import { describe, expect, it } from "vitest";
import type { Session } from "../../shared/types";
import { applyGapPractice } from "./gap-practice";

const source = (): Session => ({ scorecard: { gaps: [{ title: "Hot keys" }] }, gapProgress: {} }) as unknown as Session;
const mark = (sessionId: string) => ({ sessionId, at: "2026-11-11T10:00:00.000Z" });

describe("applyGapPractice", () => {
  it("marks a gap the scorecard holds and ignores one it does not", () => {
    const s = source();
    expect(applyGapPractice(s, "Unknown", mark("r1"), "r1")).toBe(false);
    expect(s.gapPractice).toBeUndefined();
    expect(applyGapPractice(s, "Hot keys", mark("r1"), "r1")).toBe(true);
    expect(s.gapPractice).toEqual({ "Hot keys": mark("r1") });
    expect(applyGapPractice(s, "Hot keys", mark("r1"), "r1")).toBe(false);
  });

  it("lets only the gap round that set the mark clear it, so a newer round's mark stays", () => {
    const s = source();
    applyGapPractice(s, "Hot keys", mark("r1"), "r1");
    applyGapPractice(s, "Hot keys", mark("r2"), "r2");
    expect(applyGapPractice(s, "Hot keys", null, "r1")).toBe(false);
    expect(s.gapPractice?.["Hot keys"]?.sessionId).toBe("r2");
    expect(applyGapPractice(s, "Hot keys", null, "r2")).toBe(true);
    expect(s.gapPractice).toEqual({});
  });

  it("leaves the coach's records alone", () => {
    const s = source();
    s.gapProgress = { "Hot keys": { by: "coach", state: "started", at: "2026-11-10T10:00:00.000Z" } };
    applyGapPractice(s, "Hot keys", mark("r1"), "r1");
    expect(s.gapProgress).toEqual({ "Hot keys": { by: "coach", state: "started", at: "2026-11-10T10:00:00.000Z" } });
  });
});
