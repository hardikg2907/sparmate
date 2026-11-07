import { describe, expect, it } from "vitest";
import { DEFAULT_TARGET, parseTarget } from "./target";

describe("parseTarget", () => {
  it("reads the level, the stretch level and the company from one line", () => {
    expect(parseTarget("# Me\n\nTarget: SDE-3; stretch: staff; company: large product company\n- other")).toEqual({
      level: "SDE-3",
      stretch: "staff",
      company: "large product company",
    });
  });

  it("accepts a bullet and any letter case", () => {
    expect(parseTarget("- target: Senior; STRETCH: Staff")).toMatchObject({ level: "Senior", stretch: "Staff", company: DEFAULT_TARGET.company });
  });

  it("falls back to the defaults without a target line", () => {
    expect(parseTarget("")).toEqual(DEFAULT_TARGET);
    expect(parseTarget("- **Target level:** SDE-3\nMy target: staff")).toEqual(DEFAULT_TARGET);
  });

  it("keeps the default for an empty or unknown part", () => {
    expect(parseTarget("Target: ; stretch: ; colour: red")).toEqual(DEFAULT_TARGET);
    expect(parseTarget("Target: SDE-1")).toEqual({ ...DEFAULT_TARGET, level: "SDE-1" });
  });

  it("strips characters that could break a prompt and caps the length", () => {
    const out = parseTarget(`Target: {{x}}\`SDE-3\`<b>; company: ${"a".repeat(200)}`);
    expect(out.level).toBe("xSDE-3b");
    expect(out.company).toHaveLength(60);
  });

  it("reads the default profiles shipped with the app", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const file of ["content/candidate.example.md", "study-kit/ABOUT_ME.md"]) {
      expect(parseTarget(await readFile(file, "utf8"))).toEqual(DEFAULT_TARGET);
    }
  });
});
