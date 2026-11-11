import { describe, expect, it } from "vitest";
import { isFactualCorrection, lookupNote, preparedSummary, prepProgress } from "./customPrep";

describe("isFactualCorrection", () => {
  it("counts a changed fact or number", () => {
    expect(isFactualCorrection({ fix: "A queue of 12,000 jobs", source: "https://example.com/queues" })).toBe(true);
    expect(isFactualCorrection({ fix: "The lease is 30 seconds", source: "Logic of the brief's own timing" })).toBe(true);
  });
  it("does not count a fix of wording", () => {
    expect(isFactualCorrection({ fix: "'An answer' (grammar only)", source: "Editorial" })).toBe(false);
    expect(isFactualCorrection({ fix: "Fixed the spelling of the title", source: "Spelling" })).toBe(false);
    expect(isFactualCorrection({ fix: "Moved the note to a 'For the interviewer:' line", source: "Brief format rules" })).toBe(false);
  });
  it("keeps a fact that only mentions a word like style or typo", () => {
    expect(isFactualCorrection({ fix: "Instagram-style fan-out on write for 500M DAU", source: "https://example.com/feeds" })).toBe(true);
    expect(isFactualCorrection({ fix: "Search needs typo tolerance, so use an n-gram index", source: "Search engine docs" })).toBe(true);
    expect(isFactualCorrection({ fix: "Path-style URLs are deprecated", source: "https://example.com/date-formatting/guide" })).toBe(true);
    expect(isFactualCorrection({ fix: "Use 429", source: "Google API style guide" })).toBe(true);
    expect(isFactualCorrection({ fix: "Search needs typo tolerance (typo-tolerant index)", source: "Search engine docs" })).toBe(true);
    expect(isFactualCorrection({ fix: "Use 429", source: "Style guide: Google API design" })).toBe(true);
  });
});

describe("preparedSummary", () => {
  it("says no search was needed when nothing was looked up", () => {
    expect(preparedSummary({ sourcesCount: 0, searches: 0, pages: 0 }, 0)).toBe("No web search was needed");
    expect(preparedSummary({ searches: 0, pages: 0 }, 2)).toBe("No web search was needed, 2 facts checked");
  });
  it("does not say that when the model searched but cited nothing", () => {
    expect(preparedSummary({ sourcesCount: 0, searches: 3, pages: 0 }, 0)).toBe("Searched the web, no source cited");
  });
  it("counts sources, and a fact once for each source and each factual correction", () => {
    expect(preparedSummary({ sourcesCount: 1, searches: 1, pages: 1 }, 0)).toBe("1 source, 1 fact checked");
    expect(preparedSummary({ sourcesCount: 3, searches: 2, pages: 3 }, 2)).toBe("3 sources, 5 facts checked");
  });
});

describe("prepProgress", () => {
  it("always lists the writing and checking steps, and marks the one that runs", () => {
    expect(prepProgress(null)).toEqual({ steps: ["writing", "checking"], active: "writing" });
    expect(prepProgress({ stage: "researching" }).active).toBe("writing");
    expect(prepProgress({ stage: "writing" }).active).toBe("writing");
    expect(prepProgress({ stage: "checking" }).active).toBe("checking");
  });
});

describe("lookupNote", () => {
  it("is empty while nothing was looked up", () => {
    expect(lookupNote(null)).toBeNull();
    expect(lookupNote({ searches: 0, pages: 0 })).toBeNull();
  });
  it("counts searches and pages", () => {
    expect(lookupNote({ searches: 1, pages: 2 })).toBe("1 search, 2 pages read so far.");
  });
});
