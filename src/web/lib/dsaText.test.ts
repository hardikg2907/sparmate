import { describe, expect, it } from "vitest";
import { emptyDsa } from "../../shared/dsa";
import { failureText, mediumsTip, waitText } from "./dsaText";

describe("mediumsTip", () => {
  it("asks for a username when none is saved", () => {
    expect(mediumsTip(undefined, null)).toBe("Add your LeetCode username in Settings to count mediums.");
    expect(mediumsTip("example_user", emptyDsa(null, "no_username", 3))).toBe("Add your LeetCode username in Settings to count mediums.");
  });

  it("names the profile that was not found", () => {
    expect(mediumsTip("example_user", emptyDsa("example_user", "not_found", 3))).toBe("No public LeetCode profile named example_user.");
  });

  it("says LeetCode could not be read for an error or stale status", () => {
    expect(mediumsTip("example_user", emptyDsa("example_user", "error", 3))).toBe("LeetCode could not be read.");
    expect(mediumsTip("example_user", emptyDsa("example_user", "stale", 3))).toBe("LeetCode could not be read.");
  });

  it("says nothing while loading or when the numbers are fine", () => {
    expect(mediumsTip("example_user", null)).toBe("");
    expect(mediumsTip("example_user", emptyDsa("example_user", "ok", 3))).toBe("");
  });
});

describe("text helpers", () => {
  it("gives a sentence for each failure", () => {
    expect(failureText("timeout")).toContain("in time");
    expect(failureText("unexpected_reply")).toContain("did not expect");
    expect(failureText(undefined)).toBe("LeetCode could not be read.");
  });

  it("writes a wait in seconds, then minutes", () => {
    expect(waitText(8)).toBe("8 s");
    expect(waitText(59)).toBe("59 s");
    expect(waitText(61)).toBe("2 min");
  });
});
