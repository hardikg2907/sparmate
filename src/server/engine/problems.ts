import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { ProblemMetaSchema, requiredSections, type Problem } from "../../shared/problem";
import type { Track } from "../../shared/phases";
import type { Logger } from "./log";

const MAX_PROBLEM_BYTES = 256 * 1024;

export class ProblemFileError extends Error {
  override name = "ProblemFileError";
}

const FRONTMATTER = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const H2 = /^## +(.+?)\s*#*\s*$/;

/** Splits a Markdown body on level-two headings. Headings inside fenced code blocks do not count. */
export function splitSections(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  let current: string | null = null;
  let buf: string[] = [];
  let fence: string | null = null;

  const flush = () => {
    if (current === null) return;
    if (Object.hasOwn(sections, current)) throw new ProblemFileError(`Section "${current}" appears twice`);
    sections[current] = buf.join("\n").trim();
  };

  for (const line of body.split(/\r?\n/)) {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? "";
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    }
    const heading = fence === null && !fenceMatch ? H2.exec(line) : null;
    if (heading) {
      flush();
      current = (heading[1] ?? "").trim();
      buf = [];
    } else if (current !== null) {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

export function parseProblem(text: string, file: string, custom: boolean): Problem {
  const fm = FRONTMATTER.exec(text);
  if (!fm) throw new ProblemFileError("Missing YAML frontmatter");
  let raw: unknown;
  try {
    raw = parseYaml(fm[1] ?? "", { maxAliasCount: 20, prettyErrors: false });
  } catch (err) {
    throw new ProblemFileError(`Frontmatter is not valid YAML: ${(err as Error).message}`);
  }
  const parsed = ProblemMetaSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new ProblemFileError(`Frontmatter does not match the problem format: ${issues}`);
  }
  const meta = parsed.data;
  if (meta.track === "lld" && !meta.lldFolder) throw new ProblemFileError("LLD problems need lldFolder");
  const body = text.slice(fm[0].length).replace(/^\s*\n/, "");
  const sections = splitSections(body);
  const missing = requiredSections(meta.track).filter((s) => !sections[s]);
  if (missing.length > 0) throw new ProblemFileError(`Missing or empty sections: ${missing.join(", ")}`);
  return { meta, sections, body, file, custom };
}

async function markdownFiles(dir: string, recursive: boolean): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir, { recursive });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return names.filter((n) => n.endsWith(".md")).sort().map((n) => join(dir, n));
}

/** Loads every problem file. A broken file is skipped with a warning so one bad file never hides the rest. */
export async function loadProblems(
  sources: { dir: string; custom: boolean; recursive: boolean }[],
  log: Logger,
): Promise<Problem[]> {
  const out: Problem[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    for (const file of await markdownFiles(source.dir, source.recursive)) {
      try {
        const info = await stat(file);
        if (!info.isFile()) continue;
        if (info.size > MAX_PROBLEM_BYTES) throw new ProblemFileError(`File is larger than ${MAX_PROBLEM_BYTES} bytes`);
        const problem = parseProblem(await readFile(file, "utf8"), file, source.custom);
        if (seen.has(problem.meta.id)) throw new ProblemFileError(`Duplicate problem id "${problem.meta.id}"`);
        seen.add(problem.meta.id);
        out.push(problem);
      } catch (err) {
        log.warn(`Skipping problem file ${file}`, err);
      }
    }
  }
  return out;
}

export class ProblemCatalog {
  private problems: Problem[] = [];

  constructor(
    private readonly sources: { dir: string; custom: boolean; recursive: boolean }[],
    private readonly log: Logger,
  ) {}

  async reload(): Promise<Problem[]> {
    this.problems = await loadProblems(this.sources, this.log);
    return this.problems;
  }

  list(): Problem[] {
    return this.problems;
  }

  get(id: string): Problem | undefined {
    return this.problems.find((p) => p.meta.id === id);
  }

  /** The first built-in problem of a track, used as the model for custom problems. */
  example(track: Track): Problem | undefined {
    return this.problems.find((p) => !p.custom && p.meta.track === track);
  }
}
