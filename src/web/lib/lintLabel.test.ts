import { describe, expect, it } from "vitest";
import { lintText } from "./lintLabel";

describe("lintText", () => {
  it("names the known fields in plain words", () => {
    expect(lintText({ field: "verdict.summary", issue: "Long sentence" })).toBe("Summary: Long sentence");
    expect(lintText({ field: "gaps[2].whatGoodLooksLike", issue: "Passive voice" })).toBe("A gap, what good looks like: Passive voice");
    expect(lintText({ field: "steps[1].took[0].point", issue: "Jargon" })).toBe("A step, what held: Jargon");
  });

  it("shows only the issue for a field it does not know", () => {
    expect(lintText({ field: "mystery.field[3]", issue: "Too long" })).toBe("Too long");
  });
});
