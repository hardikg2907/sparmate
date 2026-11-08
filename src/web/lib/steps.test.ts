import { describe, expect, it } from "vitest";
import type { PublicStepCheck } from "../../shared/types";
import { isUnchecked, ringView } from "./steps";

const step = (over: Partial<PublicStepCheck>): PublicStepCheck => ({
  status: "done",
  checkedAt: 0,
  usedImage: false,
  items: [],
  covered: 0,
  partial: 0,
  total: 5,
  ...over,
});

describe("ringView", () => {
  it("shows an empty ring for a step with no check", () => {
    expect(ringView(undefined)).toMatchObject({ fill: 0, tone: "none", spoken: "Not checked yet" });
  });

  it("says a step is not checked yet, never 0 of N, while its list is held back", () => {
    const held = step({ status: "idle", checkedAt: null, items: [], total: 7 });
    expect(ringView(held)).toMatchObject({ fill: 0, tone: "none", spoken: "Not checked yet" });
    expect(ringView({ ...held, status: "checking" }).spoken).toBe("Checking now");
    expect(isUnchecked(held)).toBe(true);
  });

  it("reads a checked step with nothing covered as 0 of N", () => {
    const none = step({ checkedAt: 5_000, items: [{ id: "a", label: "x", question: true, state: "missing", source: null, at: null, detail: null }], total: 1 });
    expect(isUnchecked(none)).toBe(false);
    expect(ringView(none).spoken).toBe("0 of 1 checklist items covered");
  });

  it("shows the covered share with the whole list known, a partial item counting half", () => {
    expect(ringView(step({ covered: 2, partial: 1, total: 5 }))).toMatchObject({ fill: 0.5, label: "50%", tone: "progress" });
    expect(ringView(step({ covered: 4, total: 5 })).tone).toBe("done");
    expect(ringView(step({ covered: 2, partial: 1, total: 5 })).spoken).toBe("2 of 5 checklist items covered, 1 partly");
  });
});
