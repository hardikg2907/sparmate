import { describe, expect, it } from "vitest";
import { gapStep } from "./gaps";

describe("gapStep", () => {
  it("takes the judge's tag when it names a step of the track", () => {
    expect(gapStep("hld", { step: "api", drill: "capacity" })).toBe("api");
    expect(gapStep("lld", { step: "behaviour" })).toBe("behaviour");
  });

  it("falls back to the step the gap's drill trains when the tag is missing or names no step of the track", () => {
    expect(gapStep("hld", { drill: "requirements" })).toBe("requirements");
    expect(gapStep("hld", { step: "skeleton", drill: "walk" })).toBe("design");
    expect(gapStep("hld", { drill: "tradeoff" })).toBe("deep_dives");
    expect(gapStep("lld", { drill: "lld_skeleton" })).toBe("skeleton");
  });

  it("gives no step when neither the tag nor the drill names one", () => {
    expect(gapStep("hld", {})).toBeNull();
    expect(gapStep("lld", { drill: "tradeoff" })).toBeNull();
    expect(gapStep("hld", { step: "nowhere" })).toBeNull();
  });
});
