import { describe, expect, it } from "vitest";
import { splitSentences } from "./speechSentences";

describe("splitSentences", () => {
  it("splits text on complete sentence boundaries when followed by space", () => {
    const input = "First sentence. Second sentence! Third sentence? Partial";
    const result = splitSentences(input, false);
    expect(result.sentences).toEqual(["First sentence.", "Second sentence!", "Third sentence?"]);
    expect(result.remainder).toBe("Partial");
  });

  it("emits remainder as final sentence when isFinal is true", () => {
    const input = "First sentence. Partial sentence without punctuation";
    const result = splitSentences(input, true);
    expect(result.sentences).toEqual(["First sentence.", "Partial sentence without punctuation"]);
    expect(result.remainder).toBe("");
  });

  it("does not split on abbreviations such as e.g. or Dr.", () => {
    const input = "Dr. Smith presented e.g. three examples. Next sentence.";
    const result = splitSentences(input, true);
    expect(result.sentences).toEqual(["Dr. Smith presented e.g. three examples.", "Next sentence."]);
  });

  it("does not split on decimal numbers", () => {
    const input = "We observed 99.9% uptime and 3.14 latency. It is within budget.";
    const result = splitSentences(input, true);
    expect(result.sentences).toEqual(["We observed 99.9% uptime and 3.14 latency.", "It is within budget."]);
  });

  it("handles sentences ending with quotes or parentheses", () => {
    const input = 'He said, "Let us begin!" (Or at least tried.) We agreed.';
    const result = splitSentences(input, true);
    expect(result.sentences).toEqual(['He said, "Let us begin!"', "(Or at least tried.)", "We agreed."]);
  });

  it("splits on blank line paragraph breaks", () => {
    const input = "First paragraph\n\nSecond paragraph";
    const result = splitSentences(input, true);
    expect(result.sentences).toEqual(["First paragraph", "Second paragraph"]);
  });

  it("returns empty sentences for empty input", () => {
    const result = splitSentences("", false);
    expect(result.sentences).toEqual([]);
    expect(result.remainder).toBe("");
  });
});
