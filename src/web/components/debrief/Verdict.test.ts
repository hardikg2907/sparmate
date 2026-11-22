import { describe, expect, it } from "vitest";
import type { Scorecard } from "../../../shared/types";
import { highestLevelPassed } from "./Verdict";

type V = Scorecard["verdict"];
const verdict = (over: Partial<V>): V => ({ sde2: "lean_no_hire", senior: "no_hire", confidence: "medium", summary: "s", ...over });

describe("highestLevelPassed", () => {
  it("names the highest level with a passing call", () => {
    expect(highestLevelPassed(verdict({ below: "strong_hire", sde2: "hire", senior: "hire", stretchLevel: "staff" }))).toBe("staff");
    expect(highestLevelPassed(verdict({ below: "strong_hire", sde2: "hire" }))).toBe("SDE-2");
    expect(highestLevelPassed(verdict({ below: "hire", belowLevel: "SDE-1" }))).toBe("SDE-1");
    expect(highestLevelPassed(verdict({ below: "lean_no_hire" }))).toBe("none at SDE-1 or above");
  });

  it("stays silent for a card saved without a lower-level call", () => {
    expect(highestLevelPassed(verdict({ sde2: "hire" }))).toBeNull();
  });

  it("stays silent when the lower level is the target, however it is written", () => {
    expect(highestLevelPassed(verdict({ below: "hire", belowLevel: "sde 2", targetLevel: "SDE-2" }))).toBeNull();
  });
});
