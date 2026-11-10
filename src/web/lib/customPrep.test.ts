import { describe, expect, it } from "vitest";
import { isFactualCorrection, preparedSummary, prepProgress } from "./customPrep";

describe("isFactualCorrection", () => {
  it("counts a changed fact or number", () => {
    expect(isFactualCorrection({ fix: "A queue of 12,000 jobs", source: "https://example.com/queues" })).toBe(true);
    expect(isFactualCorrection({ fix: "The lease is 30 seconds", source: "Logic of the brief's own timing" })).toBe(true);
  });
  it("does not count a fix of wording", () => {
    expect(isFactualCorrection({ fix: "'An answer' (grammar only)", source: "Editorial" })).toBe(false);
    expect(isFactualCorrection({ fix: "Fixed a typo in the title", source: "Own check" })).toBe(false);
  });
});

describe("preparedSummary", () => {
  it("says no search was needed when there are no sources", () => {
    expect(preparedSummary({ sourcesCount: 0, checksCount: 4 })).toBe("No web search was needed, 4 facts checked");
    expect(preparedSummary({ checksCount: 1 })).toBe("No web search was needed, 1 fact checked");
  });
  it("counts sources, and leaves out an empty count of checks", () => {
    expect(preparedSummary({ sourcesCount: 1, checksCount: 0 })).toBe("1 source");
    expect(preparedSummary({ sourcesCount: 3, checksCount: 5 })).toBe("3 sources, 5 facts checked");
  });
});

describe("prepProgress", () => {
  it("shows no research step while no search has run, and puts the writer first", () => {
    expect(prepProgress(null)).toEqual({ steps: ["writing", "checking"], active: "writing" });
    expect(prepProgress({ stage: "researching", searches: 0, pages: 0 })).toEqual({ steps: ["writing", "checking"], active: "writing" });
  });
  it("shows the research step once a search has run", () => {
    expect(prepProgress({ stage: "researching", searches: 2, pages: 0 })).toEqual({ steps: ["research", "writing", "checking"], active: "research" });
    expect(prepProgress({ stage: "writing", searches: 2, pages: 1 })).toEqual({ steps: ["research", "writing", "checking"], active: "writing" });
  });
  it("marks the checking step when the checker runs", () => {
    expect(prepProgress({ stage: "checking", searches: 0, pages: 0 }).active).toBe("checking");
  });
});
