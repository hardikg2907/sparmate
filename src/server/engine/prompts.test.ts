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

