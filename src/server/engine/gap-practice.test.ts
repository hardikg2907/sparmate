import { describe, expect, it } from "vitest";
import type { Session } from "../../shared/types";
import { applyGapPractice, practisesGap } from "./gap-practice";

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

  it("keeps the first gap round's mark, and lets only the round that set a mark clear it", () => {
    const s = source();
    applyGapPractice(s, "Hot keys", mark("r1"), "r1");
    expect(applyGapPractice(s, "Hot keys", mark("r2"), "r2")).toBe(false);
    expect(applyGapPractice(s, "Hot keys", null, "r2")).toBe(false);
    expect(s.gapPractice?.["Hot keys"]?.sessionId).toBe("r1");
    expect(applyGapPractice(s, "Hot keys", null, "r1")).toBe(true);
    expect(s.gapPractice).toEqual({});
  });

  it("counts a gap round as practising its gap only when the gap's step passed with no model answer on it", () => {
    const focus = { title: "Hot keys", goodLooksLike: "x", source: { sessionId: "s", gapTitle: "Hot keys", step: "requirements" } };
    const passed = { requirements: { verdict: "pass" as const, at: 1 } };
    expect(practisesGap({ focus, stepVerdicts: passed, assists: [] })).toBe(true);
    expect(practisesGap({ focus, stepVerdicts: passed, assists: [{ at: 0, phase: "requirements" }] })).toBe(false);
    expect(practisesGap({ focus, stepVerdicts: passed, assists: [{ at: 0, phase: "api" }] })).toBe(true);
    expect(practisesGap({ focus, stepVerdicts: {}, assists: [] })).toBe(false);
    expect(practisesGap({ focus: { ...focus, source: { ...focus.source, step: null } }, stepVerdicts: passed, assists: [] })).toBe(false);
  });

  it("leaves the coach's records alone", () => {
    const s = source();
    s.gapProgress = { "Hot keys": { by: "coach", state: "started", at: "2026-11-10T10:00:00.000Z" } };
    applyGapPractice(s, "Hot keys", mark("r1"), "r1");
    expect(s.gapProgress).toEqual({ "Hot keys": { by: "coach", state: "started", at: "2026-11-10T10:00:00.000Z" } });
  });
});
