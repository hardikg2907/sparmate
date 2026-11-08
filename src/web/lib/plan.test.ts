import { describe, expect, it } from "vitest";
import { MIN_RAIL_SHARE, behindPlanMs, planWindows, plannedPhaseAt, railPosition, railWeights } from "./plan";

const MIN = 60_000;
const PLAN = [
  { id: "requirements", label: "Requirements", minutes: 5 },
  { id: "entities", label: "Core entities", minutes: 3 },
  { id: "api", label: "API", minutes: 4 },
];

describe("planWindows", () => {
  it("lays the phases end to end", () => {
    expect(planWindows(PLAN)).toEqual([
      { id: "requirements", startMs: 0, endMs: 5 * MIN },
      { id: "entities", startMs: 5 * MIN, endMs: 8 * MIN },
      { id: "api", startMs: 8 * MIN, endMs: 12 * MIN },
    ]);
  });
});

describe("behindPlanMs", () => {
  it("is zero inside the current phase's window", () => {
    expect(behindPlanMs(PLAN, "entities", 7 * MIN)).toBe(0);
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
    expect(plannedPhaseAt(PLAN, 5 * MIN)).toBe("entities");
  });

  it("stays on the last phase after the plan runs out", () => {
    expect(plannedPhaseAt(PLAN, 50 * MIN)).toBe("api");
  });

  it("is null for an empty plan", () => {
    expect(plannedPhaseAt([], 1000)).toBeNull();
  });
});

describe("rail layout", () => {
  const HLD = [
    { id: "requirements", label: "Requirements", minutes: 5 },
    { id: "entities", label: "Core entities", minutes: 2 },
    { id: "api", label: "API", minutes: 5 },
    { id: "design", label: "High-level design", minutes: 13 },
    { id: "deep_dives", label: "Deep dives", minutes: 20 },
  ];

  it("gives a short step at least the floor share and leaves long steps to scale", () => {
    const weights = railWeights(HLD);
    expect(weights[1]).toBeCloseTo(45 * MIN_RAIL_SHARE);
    expect(weights[3]).toBe(13);
    expect(weights[4]).toBe(20);
  });

  it("keeps the needle inside the phase the plan expects", () => {
    const weights = railWeights(HLD);
    const sum = weights.reduce((a, b) => a + b, 0);
    const startOf = (i: number) => weights.slice(0, i).reduce((a, b) => a + b, 0) / sum;
    expect(railPosition(HLD, 0)).toBe(0);
    // Halfway through core entities (minute 6) is halfway through its widened segment.
    expect(railPosition(HLD, 6 * MIN)).toBeCloseTo((startOf(1) + startOf(2)) / 2);
    expect(railPosition(HLD, 12 * MIN)).toBeCloseTo(startOf(3));
    expect(railPosition(HLD, 45 * MIN)).toBe(1);
    expect(railPosition(HLD, 60 * MIN)).toBe(1);
  });

  it("is plain to scale when every step is above the floor", () => {
    const even = [
      { id: "a", label: "A", minutes: 10 },
      { id: "b", label: "B", minutes: 10 },
    ];
    expect(railWeights(even)).toEqual([10, 10]);
    expect(railPosition(even, 5 * MIN)).toBeCloseTo(0.25);
  });
});
