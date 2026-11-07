import { describe, expect, it } from "vitest";
import { lintProse } from "./lint";

const words = (n: number): string => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

describe("lintProse", () => {
  it("returns no issues for plain prose", () => {
    const text = [
      "The candidate asked about scale before drawing anything.",
      "Each deep dive named a number and a reason.",
      "",
      "The extension was handled well, because the design already had a queue.",
    ].join("\n");
    expect(lintProse(text)).toEqual([]);
  });

  it("returns no issues for the empty string", () => {
    expect(lintProse("")).toEqual([]);
    expect(lintProse("   \n\n  ")).toEqual([]);
  });

  describe("em-dashes", () => {
    it("allows one em-dash in a paragraph", () => {
      expect(lintProse("The design held up — the numbers backed it.")).toEqual([]);
    });

    it("flags a paragraph with two em-dashes", () => {
      const issues = lintProse("The design held up — the numbers backed it — and the queue absorbed bursts.");
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatch(/2 em-dashes/);
      expect(issues[0]).toMatch(/Paragraph 1/);
    });

    it("counts per paragraph, not per text", () => {
      const text = "First part — one dash.\n\nSecond part — one dash.";
      expect(lintProse(text)).toEqual([]);
    });

    it("reports the right paragraph number", () => {
      const text = "Clean paragraph.\n\nA — b — c — d.";
      const issues = lintProse(text);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatch(/Paragraph 2/);
      expect(issues[0]).toMatch(/3 em-dashes/);
    });

    it("ignores em-dashes in inline code, fenced code and table rows", () => {
      const text = [
        "Use `a — b — c` as the literal.",
        "",
        "```",
        "x — y — z",
        "```",
        "",
        "| a — b — c | d |",
        "|---|---|",
      ].join("\n");
      expect(lintProse(text)).toEqual([]);
    });
  });

  describe("symbols", () => {
    it.each(["→", "≈", "⇒", "×"])("flags %s in a sentence", (symbol) => {
      const issues = lintProse(`The cost grows ${symbol} quickly with load.`);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain(symbol);
    });

    it("lists each symbol once per sentence", () => {
      const issues = lintProse("It costs about ≈ 5 × more ≈ here.");
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain("≈");
      expect(issues[0]).toContain("×");
    });

    it("reports one issue per offending sentence", () => {
      const issues = lintProse("It grew → fast. Then it shrank → slowly. Nothing else happened.");
      expect(issues).toHaveLength(2);
    });

    it("ignores the symbols inside inline code, fenced code and tables", () => {
      const text = [
        "Write `5 × 3` in the code.",
        "",
        "```text",
        "a → b ≈ c ⇒ d × e",
        "```",
        "",
        "| step | cost |",
        "|---|---|",
        "| read → write | 3 × more |",
      ].join("\n");
      expect(lintProse(text)).toEqual([]);
    });

    it("does not flag the ASCII arrow or an ordinary x", () => {
      expect(lintProse("A queue sits between a -> b and costs 3x more.")).toEqual([]);
    });
  });

  describe("soft sentence openers", () => {
    it.each(["That's", "This is", "It's"])("flags a sentence starting with %s as a soft issue", (opener) => {
      const issues = lintProse(`The cache failed. ${opener} the reason the page was slow.`);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatch(/^Soft issue/);
      expect(issues[0]).toContain(opener);
    });

    it("flags an opener at the very start of a paragraph", () => {
      expect(lintProse("It's the trick.")).toHaveLength(1);
    });

    it("understands a curly apostrophe", () => {
      expect(lintProse("The cache failed. That’s the reason.")).toHaveLength(1);
    });

    it("does not flag the words in the middle of a sentence or lookalikes", () => {
      expect(lintProse("The reason is that it's slow. Its owner agreed. Thatcher agreed too.")).toEqual([]);
    });

    it("ignores an opener inside inline code or a fenced block", () => {
      expect(lintProse("Say `It's fine.` out loud.\n\n```\nThat's it.\n```")).toEqual([]);
    });

    it("strips list and heading markers before looking at the opener", () => {
      expect(lintProse("- It's the first point.")).toHaveLength(1);
      expect(lintProse("## It's a heading")).toHaveLength(1);
    });
  });

  describe("paragraph length", () => {
    it("allows exactly 300 words", () => {
      expect(lintProse(words(300))).toEqual([]);
    });

    it("flags 301 words", () => {
      const issues = lintProse(words(301));
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatch(/301 words/);
    });

    it("counts words per paragraph", () => {
      expect(lintProse(`${words(200)}\n\n${words(200)}`)).toEqual([]);
    });

    it("does not count code, tables or punctuation-only tokens", () => {
      const text = [words(299), "`one two three four five`", "-", "", "| a | b |"].join("\n");
      expect(lintProse(text)).toEqual([]);
    });
  });

  it("treats each list item as its own paragraph", () => {
    const text = ["- first — point — here", "- second point — fine", "- third point"].join("\n");
    const issues = lintProse(text);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/Paragraph 1/);
  });

  it("returns the issues in paragraph order", () => {
    const text = ["A — b — c.", "", "It grew → fast.", "", words(310)].join("\n");
    const issues = lintProse(text);
    expect(issues).toHaveLength(3);
    expect(issues[0]).toMatch(/Paragraph 1/);
    expect(issues[1]).toMatch(/Paragraph 2/);
    expect(issues[2]).toMatch(/Paragraph 3/);
  });

  it("gives short issue strings", () => {
    for (const issue of lintProse(`${words(400)} — a — b → c`)) {
      expect(issue.length).toBeLessThan(200);
    }
  });
});
