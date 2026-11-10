import { describe, expect, it } from "vitest";
import { BASE_MINUTES, phasePlan, phasesFor, type Track } from "./phases";

const total = (track: Track, minutes: number) => phasePlan(track, minutes).reduce((sum, p) => sum + p.minutes, 0);

describe("phasePlan", () => {
  it.each([
    ["hld", 20],
    ["hld", 45],
    ["hld", 60],
    ["lld", 20],
    ["lld", 90],
    ["lld", 120],
  ] as const)("adds up to the round length for %s at %i minutes", (track, minutes) => {
    expect(total(track, minutes)).toBe(minutes);
  });

  it("adds up for every whole length a round can have", () => {
    for (const track of ["hld", "lld"] as const) for (let m = 10; m <= 180; m += 1) expect(total(track, m)).toBe(m);
  });

  it("keeps the base plan at its base length", () => {
    for (const track of ["hld", "lld"] as const) {
      expect(phasePlan(track, BASE_MINUTES[track]).map((p) => p.minutes)).toEqual(phasesFor(track).map((p) => p.baseMinutes));
    }
  });

  it("lists the steps in order, each with at least a minute and within a minute of its exact share", () => {
    for (const [track, minutes] of [
      ["hld", 60],
      ["lld", 120],
      ["hld", 20],
      ["lld", 20],
    ] as const) {
      const plan = phasePlan(track, minutes);
      expect(plan.map((p) => p.id)).toEqual(phasesFor(track).map((p) => p.id));
      plan.forEach((p, i) => {
        const exact = ((phasesFor(track)[i]?.baseMinutes ?? 0) * minutes) / BASE_MINUTES[track];
        expect(p.minutes).toBeGreaterThanOrEqual(1);
        expect(Math.abs(p.minutes - exact)).toBeLessThan(1);
      });
    }
  });

  it("gives the 60-minute system design round the minutes 7, 2, 7, 17 and 27", () => {
    expect(phasePlan("hld", 60).map((p) => p.minutes)).toEqual([7, 2, 7, 17, 27]);
  });
});
