import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { phasesFor, phasePlan, EXTENSION_LEAD_MINUTES, type Mode, type Track } from "../../shared/phases";
import { requiredSections } from "../../shared/problem";
import { parseTarget } from "../../shared/target";

export class PromptError extends Error {
  override name = "PromptError";
}

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/**
 * Plain `{{name}}` replacement. Unknown names are checked against the template before anything is replaced,
 * so braces inside an inserted value (a brief, a C++ snippet) can never be mistaken for a placeholder.
 */
export function renderPrompt(template: string, vars: Readonly<Record<string, string>>, name = "prompt"): string {
  const unknown = new Set<string>();
  for (const m of template.matchAll(PLACEHOLDER)) {
    const key = m[1] ?? "";
    if (!Object.hasOwn(vars, key)) unknown.add(key);
  }
  if (unknown.size > 0) {
    throw new PromptError(`Unknown placeholder in ${name}: ${[...unknown].map((n) => `{{${n}}}`).join(", ")}`);
  }
  return template.replace(PLACEHOLDER, (_m, key: string) => vars[key] ?? "");
}

export const COMMON_VARS = ["date", "problem_title", "track", "mode", "duration_min", "candidate_profile", "target_level", "stretch_level", "target_company"] as const;

/** Each prompt file and the variables it may use, besides the common ones. */
export const PROMPT_VARS = {
  "interviewer-hld": ["problem_brief", "extension_minute", "phase_plan"],
  "interviewer-lld": ["problem_brief", "extension_minute", "phase_plan"],
  "guide-hld": ["problem_brief", "phase_plan", "focus"],
  "guide-lld": ["problem_brief", "phase_plan", "focus"],
  "tester-lld": ["problem_brief"],
  "judge-hld": ["problem_brief", "rubric"],
  "judge-lld": ["problem_brief", "rubric"],
  coach: ["problem_brief", "teaching_md", "scorecard_json"],
  scribe: ["teaching_md", "max_ops"],
  "brief-writer": ["section_list", "example_problem"],
  "brief-checker": ["example_problem"],
  checker: [],
  "drill-grader": [],
  "drill-follow-up": [],
} as const;

function levelVars(vars: Readonly<Record<string, string>>): Record<string, string> {
  return { target_level: vars.target_level ?? "", stretch_level: vars.stretch_level ?? "", target_company: vars.target_company ?? "" };
}

export type PromptName = keyof typeof PROMPT_VARS;
export type PromptVars = Record<(typeof COMMON_VARS)[number], string> & Record<string, string>;

export class PromptLoader {
  constructor(
    private readonly contentDir: string,
    private readonly studyRoot: string,
  ) {}

  /** Read fresh on every role start so edited prompt files apply without a restart. */
  async template(name: PromptName): Promise<string> {
    return this.readContent(join("prompts", `${name}.md`), `prompt file content/prompts/${name}.md`);
  }

  async render(name: PromptName, vars: PromptVars): Promise<string> {
    const allowed = new Set<string>([...COMMON_VARS, ...PROMPT_VARS[name]]);
    const scoped: Record<string, string> = {};
    for (const [k, v] of Object.entries(vars)) if (allowed.has(k)) scoped[k] = v;
    // The rubric is inserted as a value, so its own level placeholders need filling before it goes in.
    if (scoped.rubric !== undefined) scoped.rubric = renderPrompt(scoped.rubric, levelVars(scoped), "rubric");
    return renderPrompt(await this.template(name), scoped, `content/prompts/${name}.md`);
  }

  async candidateProfile(): Promise<string> {
    try {
      return await readFile(join(this.studyRoot, "ABOUT_ME.md"), "utf8");
    } catch {
      return this.readContent("candidate.example.md", "content/candidate.example.md");
    }
  }

  rubric(track: Track): Promise<string> {
    return this.readContent(join("rubrics", `${track}.md`), `content/rubrics/${track}.md`);
  }

  async teachingMd(): Promise<string> {
    try {
      return await readFile(join(this.studyRoot, "TEACHING.md"), "utf8");
    } catch {
      throw new PromptError("TEACHING.md is missing from the study folder");
    }
  }

  private async readContent(relative: string, label: string): Promise<string> {
    try {
      return await readFile(join(this.contentDir, relative), "utf8");
    } catch {
      throw new PromptError(`Missing ${label}`);
    }
  }
}

export function formatPhasePlan(track: Track, durationMin: number): string {
  const plan = phasePlan(track, durationMin);
  return phasesFor(track)
    .map((p, i) => `- ${p.label}: about ${plan[i]?.minutes ?? p.baseMinutes} min — ${p.goal}`)
    .join("\n");
}

/** The guide's focus paragraph for a round on one gap; empty for every other round. */
export function focusText(focus: { title: string; goodLooksLike: string } | null, stepLabel: string | null = null): string {
  if (!focus) return "";
  const step = stepLabel
    ? ` The gap belongs to the ${stepLabel} step: the gap counts as practised when that step passes with no "I'm stuck" on it, so judge that step by the same evidence rules as any other.`
    : "";
  return [
    `**Focus for this session.** He came back to practise one gap from an earlier round on this problem: "${focus.title}". The session is short, about 20 minutes. Run the steps as usual, but steer each one toward this gap, and spend your teaching on it.${step} What good looks like, in the judge's words:`,
    "",
    `> ${focus.goodLooksLike.replace(/\n+/g, " ")}`,
    "",
    "Judge his steps against that standard before any other. When he handles it well, say so and stop drilling it.",
  ].join("\n");
}

export function extensionMinute(track: Track, durationMin: number): number {
  return durationMin - EXTENSION_LEAD_MINUTES[track];
}

export function sectionList(track: Track): string {
  return requiredSections(track)
    .map((s) => `## ${s}`)
    .join("\n");
}

export function commonVars(input: {
  date: string;
  problemTitle: string;
  track: Track;
  mode: Mode;
  durationMin: number;
  candidateProfile: string;
}): Record<(typeof COMMON_VARS)[number], string> {
  const target = parseTarget(input.candidateProfile);
  return {
    date: input.date,
    problem_title: input.problemTitle,
    track: input.track,
    mode: input.mode,
    duration_min: String(input.durationMin),
    candidate_profile: input.candidateProfile,
    target_level: target.level,
    stretch_level: target.stretch,
    target_company: target.company,
  };
}
