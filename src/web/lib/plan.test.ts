import { describe, expect, it } from "vitest";
import { behindPlanMs, planWindows, plannedPhaseAt } from "./plan";

const MIN = 60_000;
const PLAN = [
  { id: "requirements", label: "Requirements", minutes: 5 },
  { id: "capacity", label: "Capacity math", minutes: 3 },
  { id: "api", label: "API", minutes: 4 },
];

describe("planWindows", () => {
  it("lays the phases end to end", () => {
    expect(planWindows(PLAN)).toEqual([
      { id: "requirements", startMs: 0, endMs: 5 * MIN },
      { id: "capacity", startMs: 5 * MIN, endMs: 8 * MIN },
      { id: "api", startMs: 8 * MIN, endMs: 12 * MIN },
    ]);
  });
});

describe("behindPlanMs", () => {
  it("is zero inside the current phase's window", () => {
    expect(behindPlanMs(PLAN, "capacity", 7 * MIN)).toBe(0);
  });

  it("counts the time past the current phase's planned end", () => {
    expect(behindPlanMs(PLAN, "requirements", 9 * MIN + 30_000)).toBe(4 * MIN + 30_000);
  });

  it("does not call a candidate who moved ahead late", () => {
    expect(behindPlanMs(PLAN, "api", 3 * MIN)).toBe(0);
  });

  it("is zero for a phase that is not in the plan", () => {
    expect(behindPlanMs(PLAN, "unknown", 30 * MIN)).toBe(0);
  });
});

describe("plannedPhaseAt", () => {
  it("finds the phase whose window holds the time", () => {
    expect(plannedPhaseAt(PLAN, 0)).toBe("requirements");
    expect(plannedPhaseAt(PLAN, 5 * MIN)).toBe("capacity");
  });

  it("stays on the last phase after the plan runs out", () => {
    expect(plannedPhaseAt(PLAN, 50 * MIN)).toBe("api");
  });

  it("is null for an empty plan", () => {
    expect(plannedPhaseAt([], 1000)).toBeNull();
  });
});
