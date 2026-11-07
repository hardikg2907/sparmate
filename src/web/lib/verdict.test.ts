import { describe, expect, it } from "vitest";
import { VERDICTS } from "../../shared/types";
import { VERDICT_EXPLANATION, VERDICT_LABEL, verdictSentence } from "./verdict";

describe("verdict wording", () => {
  it("names every verdict in plain words", () => {
    expect(VERDICT_LABEL).toEqual({
      strong_hire: "Strong pass",
      hire: "Pass",
      lean_no_hire: "Close, not yet",
      no_hire: "Not yet",
    });
  });

  it("has a label and an explanation for each stored value, and no extra keys", () => {
    for (const verdict of VERDICTS) {
      expect(VERDICT_LABEL[verdict]).toBeTruthy();
      expect(VERDICT_EXPLANATION[verdict]).toBeTruthy();
    }
    expect(Object.keys(VERDICT_LABEL).sort()).toEqual([...VERDICTS].sort());
    expect(Object.keys(VERDICT_EXPLANATION).sort()).toEqual([...VERDICTS].sort());
  });

  it("keeps each explanation to one short sentence pair without the old jargon", () => {
    for (const verdict of VERDICTS) {
      const text = VERDICT_EXPLANATION[verdict];
      expect(text.length).toBeLessThan(110);
      expect(text).not.toMatch(/hire/i);
      expect(text).toMatch(/\.$/);
    }
    expect(new Set(Object.values(VERDICT_LABEL)).size).toBe(VERDICTS.length);
  });

  it("joins the label and the explanation with a colon", () => {
    expect(verdictSentence("lean_no_hire")).toBe("Close, not yet: An interviewer would likely not pass this round, but one or two fixes would change that.");
  });
});
