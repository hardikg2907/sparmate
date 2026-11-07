import { describe, expect, it } from "vitest";
import { cleanMarkdownForSpeech } from "./speechCleaning";

describe("cleanMarkdownForSpeech", () => {
  it("replaces closed code blocks with code block omitted", () => {
    const input = "Here is the code:\n```cpp\nint main() {\n  return 0;\n}\n```\nWhat do you think?";
    expect(cleanMarkdownForSpeech(input)).toBe("Here is the code: code block omitted. What do you think?");
  });

  it("handles unclosed code block during streaming without leaking code", () => {
    const input = "Look at this:\n```cpp\nstd::vector<int> v;";
    expect(cleanMarkdownForSpeech(input, false)).toBe("Look at this:");
    expect(cleanMarkdownForSpeech(input, true)).toBe("Look at this: code block omitted.");
  });

  it("strips inline code backticks while keeping code identifiers", () => {
    const input = "We can use `std::vector` and `unordered_map` here.";
    expect(cleanMarkdownForSpeech(input)).toBe("We can use std::vector and unordered_map here.");
  });

  it("retains link text and drops URLs", () => {
    const input = "Check the [documentation](https://example.com/docs) for details.";
    expect(cleanMarkdownForSpeech(input)).toBe("Check the documentation for details.");
  });

  it("converts headings into punctuated sentences", () => {
    const input = "## Non-functional Requirements\nLatency should be low.";
    expect(cleanMarkdownForSpeech(input)).toBe("Non-functional Requirements. Latency should be low.");
  });

  it("strips bullet points, numbered lists and blockquotes", () => {
    const input = "> Note from interviewer:\n- item 1\n* item 2\n1. item 3";
    expect(cleanMarkdownForSpeech(input)).toBe("Note from interviewer: item 1 item 2 item 3");
  });

  it("removes bold, italic and strikethrough delimiters", () => {
    const input = "This is **very** important, *really* important, and ~~not~~ needed.";
    expect(cleanMarkdownForSpeech(input)).toBe("This is very important, really important, and not needed.");
  });

  it("cleans html tags and normalizes whitespace", () => {
    const input = "First line.<br/><span>Second line.</span>";
    expect(cleanMarkdownForSpeech(input)).toBe("First line. Second line.");
  });
});
