import { describe, expect, it } from "vitest";
import { daysSince, formatClock, formatDate, formatMinutes, marksInWords, summaryInWords } from "./format";

describe("formatClock", () => {
  it("pads minutes and seconds", () => {
    expect(formatClock(65_000)).toBe("01:05");
  });

  it("lets minutes pass 59 for long rounds", () => {
    expect(formatClock(119 * 60_000 + 59_000)).toBe("119:59");
  });

  it("shows zero for negative time", () => {
    expect(formatClock(-5000)).toBe("00:00");
  });

  it("drops partial seconds", () => {
    expect(formatClock(59_999)).toBe("00:59");
  });
});

describe("formatMinutes", () => {
  it("keeps whole numbers short and shows one decimal otherwise", () => {
    expect(formatMinutes(5)).toBe("5");
    expect(formatMinutes(6.7)).toBe("6.7");
    expect(formatMinutes(13.333)).toBe("13.3");
  });
});

describe("dates", () => {
  it("formats an ISO date", () => {
    expect(formatDate("2026-10-30T10:15:00.000Z")).toMatch(/30 Oct 2026/);
  });

  it("returns unreadable input as it came", () => {
    expect(formatDate("soon")).toBe("soon");
  });

  it("counts whole days", () => {
    const now = Date.parse("2026-10-30T12:00:00.000Z");
    expect(daysSince("2026-10-18T12:00:00.000Z", now)).toBe(12);
    expect(daysSince("2026-10-30T11:00:00.000Z", now)).toBe(0);
    expect(daysSince("nope", now)).toBeNull();
  });
});

describe("marksInWords", () => {
  it("writes each tracker mark out as words", () => {
    expect(marksInWords("Guided rounds earn at most [~]. A [x] needs every dimension at 3, and [ ] means not tried.")).toBe(
      "Guided rounds earn at most partly done. A done needs every dimension at 3, and not done means not tried.",
    );
    expect(marksInWords("No marks here [y].")).toBe("No marks here [y].");
    expect(marksInWords("Indexed grid[x] without a bounds check, and int arr[ ] then [x]2.")).toBe("Indexed grid[x] without a bounds check, and int arr[ ] then [x]2.");
    expect(marksInWords("(mark [~], add notes)")).toBe("(mark partly done, add notes)");
    expect(marksInWords("Calls foo()[x] and quotes `[x]` as code.")).toBe("Calls foo()[x] and quotes `[x]` as code.");
  });
});

describe("summaryInWords", () => {
  it("rewrites only the mark of an older summary, never the text it quotes", () => {
    expect(summaryInWords('Update "URL Shortener" (mark [~], add "notes/x.md")')).toBe('Update "URL Shortener" (mark it partly done, add "notes/x.md")');
    expect(summaryInWords('Add a sub-bullet under "Cache": "Checklist: [x] TTL"')).toBe('Add a sub-bullet under "Cache": "Checklist: [x] TTL"');
  });
});
