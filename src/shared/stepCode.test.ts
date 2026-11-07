import { describe, expect, it } from "vitest";
import { HLD_PHASES, LLD_PHASES } from "./phases";
import { MAX_STEP_LINES, codeScopeFor, newLines, numberedCode, stepCodeText, unnumberedCode, withStepLines } from "./stepCode";

describe("codeScopeFor", () => {
  it("gives a design round no code", () => {
    for (const p of HLD_PHASES) expect(codeScopeFor("hld", p.id)).toBeNull();
  });

  it("reads only the step's own lines in the design steps and the whole file in the build steps", () => {
    expect(Object.fromEntries(LLD_PHASES.map((p) => [p.id, codeScopeFor("lld", p.id)]))).toEqual({
      clarify: "step",
      entities: "step",
      behaviour: "step",
      skeleton: "file",
      thin_slice: "file",
      fill_out: "file",
      extend: "file",
    });
  });

  it("gives an unknown step no code", () => {
    expect(codeScopeFor("lld", "requirements")).toBeNull();
    expect(codeScopeFor("lld", "")).toBeNull();
  });
});

describe("newLines", () => {
  it("returns the trimmed text of each non-blank line that is new, once, in file order", () => {
    const before = "// Clarify\n// one gate\n";
    const after = "// Clarify\n// one gate\n\nclass Spot {\n  int floor;\n};\n  class Spot {\n";
    expect(newLines(before, after)).toEqual(["class Spot {", "int floor;", "};"]);
  });

  it("does not count a line that only moved or changed its indent", () => {
    expect(newLines("a\n  b\nc", "c\nb\na\n")).toEqual([]);
  });

  it("counts every non-blank line of a file that was empty", () => {
    expect(newLines("", "// one gate\n\n// no payments\n")).toEqual(["// one gate", "// no payments"]);
    expect(newLines("x", "")).toEqual([]);
  });
});

describe("withStepLines", () => {
  it("adds the new lines and drops the step's lines that left the file, such as half-typed fragments", () => {
    const typing = withStepLines([], ["// one ga"], "// one ga\n");
    expect(typing).toEqual(["// one ga"]);
    expect(withStepLines(typing, ["// one gate"], "// one gate\n")).toEqual(["// one gate"]);
  });

  it("moves a line typed again to the end and keeps only the newest", () => {
    expect(withStepLines(["a", "b"], ["a"], "a\nb\n")).toEqual(["b", "a"]);
    const many = Array.from({ length: MAX_STEP_LINES + 10 }, (_, i) => `line ${i}`);
    const kept = withStepLines([], many, many.join("\n"));
    expect(kept).toHaveLength(MAX_STEP_LINES);
    expect(kept[0]).toBe("line 10");
    expect(withStepLines(["a", "b", "c"], ["d"], "a\nb\nc\nd", 2)).toEqual(["c", "d"]);
  });
});

describe("stepCodeText", () => {
  const file = ["// Clarify: one entry gate", "// Out of scope: payments", "", "class Spot {", "  int floor;", "};", "", "int main() {}"].join("\n");

  it("keeps each line's number in the file and leaves out every other line", () => {
    expect(stepCodeText(file, ["class Spot {", "int floor;"])).toBe("4 | class Spot {\n5 |   int floor;");
    expect(stepCodeText(file, ["// Clarify: one entry gate", "// Out of scope: payments"])).toBe("1 | // Clarify: one entry gate\n2 | // Out of scope: payments");
  });

  it("numbers exactly as the whole file is numbered, padding included", () => {
    const long = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n");
    expect(stepCodeText(long, ["line 3", "line 11"])).toBe(" 3 | line 3\n11 | line 11");
    const all = file.split("\n").map((l) => l.trim()).filter((l) => l !== "");
    expect(stepCodeText(file, all)).toBe(numberedCode(file).split("\n").filter((l) => !/^\s*\d+ \| \s*$/.test(l)).join("\n"));
  });

  it("is empty when the step wrote nothing or its lines are gone", () => {
    expect(stepCodeText(file, [])).toBe("");
    expect(stepCodeText(file, ["class Gate {"])).toBe("");
  });

  it("reads back as his own text", () => {
    expect(unnumberedCode(stepCodeText(file, ["class Spot {", "int floor;"]))).toBe("class Spot {\n  int floor;");
    expect(unnumberedCode(numberedCode("x | y\n 7 | z"))).toBe("x | y\n 7 | z");
  });
});
