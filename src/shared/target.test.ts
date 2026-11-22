import { describe, expect, it } from "vitest";
import { DEFAULT_TARGET, parseTarget } from "./target";

describe("parseTarget", () => {
  it("reads the level, the stretch level and the company from one line", () => {
    expect(parseTarget("# Me\n\nTarget: SDE-3; stretch: staff; company: large product company\n- other")).toEqual({
      level: "SDE-3",
      stretch: "staff",
      below: DEFAULT_TARGET.below,
      company: "large product company",
    });
  });

  it("reads the level below the target without leaking it into the company", () => {
    expect(parseTarget("Target: SDE-3; stretch: staff; below: SDE-2; company: Acme")).toEqual({
      level: "SDE-3",
      stretch: "staff",
      below: "SDE-2",
      company: "Acme",
    });
    expect(parseTarget("Target: SDE-3; below: SDE-2")).toMatchObject({ below: "SDE-2", company: DEFAULT_TARGET.company });
    expect(parseTarget("Target: SDE-3; below: {{x}}`SDE-2`")).toMatchObject({ below: "xSDE-2" });
  });

  it("defaults the level below to SDE-1", () => {
    expect(parseTarget("Target: SDE-3").below).toBe("SDE-1");
    expect(parseTarget("Target: SDE-3; below: ").below).toBe("SDE-1");
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
