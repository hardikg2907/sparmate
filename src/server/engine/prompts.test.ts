import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ROOT } from "./config";
import {
  COMMON_VARS,
  PROMPT_VARS,
  PromptError,
  PromptLoader,
  extensionMinute,
  formatPhasePlan,
  renderPrompt,
  commonVars,
  sectionList,
  type PromptName,
} from "./prompts";

describe("renderPrompt", () => {
  it("replaces every known placeholder", () => {
    expect(renderPrompt("Hi {{name}}, {{name}} at {{ when }}.", { name: "Ada", when: "noon" })).toBe("Hi Ada, Ada at noon.");
  });

  it("throws on an unknown placeholder and names it", () => {
    expect(() => renderPrompt("{{known}} {{missing}}", { known: "x" }, "t.md")).toThrow(/\{\{missing\}\} .*|t\.md/);
    expect(() => renderPrompt("{{missing}}", {})).toThrow(PromptError);
  });

  it("never re-reads braces that come from an inserted value", () => {
    const out = renderPrompt("Brief: {{brief}}", { brief: "use {{not_a_var}} and std::map<int,int> m{{1, 2}};" });
    expect(out).toBe("Brief: use {{not_a_var}} and std::map<int,int> m{{1, 2}};");
  });

  it("leaves brace-init that is not an identifier alone", () => {
    expect(renderPrompt("v{{1, 2}} {{x}}", { x: "y" })).toBe("v{{1, 2}} y");
  });
});

describe("prompt helpers", () => {
  it("formats the phase plan one line per phase", () => {
    const text = formatPhasePlan("hld", 45);
    const lines = text.split("\n");
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe("- Requirements: about 5 min — 3-4 functional and 3-4 non-functional requirements, each with a number or a rule");
  });

  it("scales the plan for a longer round", () => {
    expect(formatPhasePlan("lld", 120).split("\n")[0]).toMatch(/^- Clarify: about 7 min — /);
  });

  it("puts the extension 10 minutes before the end for HLD and 15 for LLD", () => {
    expect(extensionMinute("hld", 45)).toBe(35);
    expect(extensionMinute("lld", 120)).toBe(105);
  });

  it("lists the required sections as headings", () => {
    expect(sectionList("hld").split("\n")[0]).toBe("## Opening prompt");
  });
});

describe("prompt files that exist render with their declared variables", async () => {
  const dir = join(APP_ROOT, "content", "prompts");
  const files = await readdir(dir).catch(() => [] as string[]);
  const names = Object.keys(PROMPT_VARS) as PromptName[];
  const present = names.filter((n) => files.includes(`${n}.md`));
  it.skipIf(present.length === 0)("renders every present prompt without unknown placeholders", async () => {
    const loader = new PromptLoader(join(APP_ROOT, "content"), APP_ROOT);
    for (const name of present) {
      const vars: Record<string, string> = {};
      for (const k of [...COMMON_VARS, ...PROMPT_VARS[name]]) vars[k] = `<${k}>`;
      const out = await loader.render(name, vars as never);
      expect(out, name).not.toMatch(/\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}/);
    }
  });
});

describe("focus text", () => {
  it("is empty for a normal round and names the gap for a focused one", async () => {
    const { focusText } = await import("./prompts");
    expect(focusText(null)).toBe("");
    const text = focusText({ title: "Hot keys", goodLooksLike: "Split the key.\nAdd a local cache." });
    expect(text).toContain('"Hot keys"');
    expect(text).toContain("> Split the key. Add a local cache.");
  });
});

describe("candidate profile lookup", () => {
  it("prefers ABOUT_ME.md in study folder over content/candidate.example.md", async () => {
    const { mkdtemp, rm, writeFile: writeF } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const tempStudy = await mkdtemp(join(tmpdir(), "ir-study-about-"));
    try {
      await writeF(join(tempStudy, "ABOUT_ME.md"), "# Custom Profile\nTarget: Senior Engineer\n");
      const loader = new PromptLoader(join(APP_ROOT, "content"), tempStudy);
      const profile = await loader.candidateProfile();
      expect(profile).toBe("# Custom Profile\nTarget: Senior Engineer\n");
    } finally {
      await rm(tempStudy, { recursive: true, force: true });
    }
  });

  it("falls back to content/candidate.example.md when ABOUT_ME.md is missing", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const tempStudy = await mkdtemp(join(tmpdir(), "ir-study-empty-"));
    try {
      const loader = new PromptLoader(join(APP_ROOT, "content"), tempStudy);
      const profile = await loader.candidateProfile();
      expect(profile.length).toBeGreaterThan(0);
    } finally {
      await rm(tempStudy, { recursive: true, force: true });
    }
  });
});


describe("target level in prompts", () => {
  const input = { date: "2026-01-01", problemTitle: "Cache", track: "hld", mode: "interview", durationMin: 45 } as const;

  it("fills the level variables from the profile and renders the judge prompt and rubric with them", async () => {
    const loader = new PromptLoader(join(APP_ROOT, "content"), "/nonexistent");
    const vars = commonVars({ ...input, candidateProfile: "Target: SDE-3; stretch: staff; company: large product company" });
    expect(vars).toMatchObject({ target_level: "SDE-3", stretch_level: "staff", target_company: "large product company" });
    const out = await loader.render("judge-hld", { ...vars, problem_brief: "brief", rubric: await loader.rubric("hld") });
    expect(out).toContain("SDE-3");
    expect(out).toContain("staff");
    expect(out).not.toContain("SDE-2");
    expect(out).not.toMatch(/\{\{\s*(target_level|stretch_level|target_company)\s*\}\}/);
  });

  it("keeps today's bar when the profile has no target line", async () => {
    const vars = commonVars({ ...input, candidateProfile: "- **Target level:** SDE-3" });
    expect(vars).toMatchObject({ target_level: "SDE-2", stretch_level: "senior", target_company: "Series A to C startup" });
  });

  it("renders every prompt with the level variables filled", async () => {
    const loader = new PromptLoader(join(APP_ROOT, "content"), "/nonexistent");
    const vars = commonVars({ ...input, candidateProfile: "Target: SDE-3" });
    for (const name of Object.keys(PROMPT_VARS) as PromptName[]) {
      const extra = Object.fromEntries(PROMPT_VARS[name].map((k) => [k, "x"]));
      const out = await loader.render(name, { ...vars, ...extra });
      expect(out).not.toMatch(/\{\{\s*(target_level|stretch_level|target_company)\s*\}\}/);
    }
  });
});
