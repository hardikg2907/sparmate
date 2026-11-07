import type { Track } from "./phases";

/** Enough for any real step; typing that leaves thousands of lines behind must not grow session.json without end. */
export const MAX_STEP_LINES = 5_000;

// These steps write requirements, nouns and states as notes in the file before any program exists, so a step's
// evidence is only what he wrote while it was on the rail; the build steps after them read the whole program.
const LLD_DESIGN_STEPS: ReadonlySet<string> = new Set(["clarify", "entities", "behaviour"]);
const LLD_BUILD_STEPS: ReadonlySet<string> = new Set(["skeleton", "thin_slice", "fill_out", "extend"]);

/** Which code a step's checklist reads: the lines written during the step, the whole file, or none. */
export function codeScopeFor(track: Track, phase: string): "step" | "file" | null {
  if (track !== "lld") return null;
  if (LLD_DESIGN_STEPS.has(phase)) return "step";
  if (LLD_BUILD_STEPS.has(phase)) return "file";
  return null;
}

function fileLines(content: string): string[] {
  return content.replace(/\n$/, "").split("\n");
}

function trimmedSet(content: string): Set<string> {
  return new Set(
    fileLines(content)
      .map((l) => l.trim())
      .filter((l) => l !== ""),
  );
}

/** The trimmed text of each non-blank line in `after` that `before` does not hold, once each, in file order. */
export function newLines(before: string, after: string): string[] {
  const old = trimmedSet(before);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of fileLines(after)) {
    const line = raw.trim();
    if (line === "" || old.has(line) || seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

/**
 * A step's lines after a change on its watch. Lines that left the file are dropped, so half-typed fragments do
 * not pile up; a line typed again moves to the end, and only the newest `max` are kept.
 */
export function withStepLines(previous: readonly string[], added: readonly string[], content: string, max = MAX_STEP_LINES): string[] {
  const present = trimmedSet(content);
  const fresh = new Set(added);
  const kept = previous.filter((l) => present.has(l) && !fresh.has(l));
  return [...kept, ...added].slice(-max);
}

function numbered(n: number, width: number, line: string): string {
  return `${String(n).padStart(width, " ")} | ${line}`;
}

/** The file with 1-based line numbers, the form every model reads code in. */
export function numberedCode(content: string): string {
  const lines = fileLines(content);
  const width = String(lines.length).length;
  return lines.map((l, i) => numbered(i + 1, width, l)).join("\n");
}

/** The file's lines whose trimmed text is one of the step's, numbered as `numberedCode` numbers the whole file. */
export function stepCodeText(content: string, lines: readonly string[]): string {
  if (lines.length === 0) return "";
  const wanted = new Set(lines);
  const all = fileLines(content);
  const width = String(all.length).length;
  return all.flatMap((l, i) => (l.trim() !== "" && wanted.has(l.trim()) ? [numbered(i + 1, width, l)] : [])).join("\n");
}

/** Numbered code back to its plain lines, so a quote is matched against his text and never against a line number. */
export function unnumberedCode(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*\d+ \| /, ""))
    .join("\n");
}
