import { DRILL_INFO, MAX_VARIANT_ID, drillsForTrack, type DrillPrompt, type DrillType } from "../../shared/drills";
import type { Problem } from "../../shared/problem";

/** What a drill shows the candidate, and the answer key only the grader reads. */
export interface DrillContent {
  prompt: DrillPrompt;
  key: string;
  /** The changed-constraint question of a variant, saved with the attempt. */
  changed?: string;
}

export interface DrillContext {
  /** The gap's title, used to pick the deep dive that matches it. */
  gapTitle?: string;
  /** Why the gap matters; it only breaks ties between deep dives. */
  hint?: string;
  /** How many drills of this kind the candidate already tried on the problem, so a free drill moves on to the next topic. */
  rotation?: number;
  /** A deep dive's title, to rebuild the same topic a saved attempt used. */
  topic?: string;
  /** The id of a changed-constraint entry of the brief. An id the brief does not have builds the normal drill. */
  variant?: string;
}

const BULLET = /^\s*[-*]\s+(.+)$/;

function section(problem: Problem, name: string): string {
  return (problem.sections[name] ?? "").trim();
}

function bullets(text: string): string[] {
  return text.split("\n").flatMap((line) => {
    const m = BULLET.exec(line);
    return m?.[1] ? [m[1].trim()] : [];
  });
}

export interface DeepDiveEntry {
  title: string;
  text: string;
}

const MAX_DEEP_DIVE_SECTION = 40_000;
const MAX_DEEP_DIVE_TITLE = 200;
const HEADING = "### ";

/** Each "### " entry of the Deep dives section, with its Bad, Good and Great levels. */
export function deepDiveEntries(problem: Problem): DeepDiveEntry[] {
  const text = section(problem, "Deep dives").slice(0, MAX_DEEP_DIVE_SECTION);
  const entries: DeepDiveEntry[] = [];
  let current: { title: string; lines: string[] } | null = null;
  const flush = () => {
    if (current) entries.push({ title: current.title, text: current.lines.join("\n").trim() });
  };
  for (const line of text.split("\n")) {
    const heading = line.startsWith(HEADING) ? line.slice(HEADING.length).trim() : "";
    if (heading !== "") {
      flush();
      current = { title: heading.replace(/`/g, "").slice(0, MAX_DEEP_DIVE_TITLE), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  flush();
  return entries.filter((e) => e.text !== "");
}

const COMMON = new Set([
  "that",
  "with",
  "from",
  "your",
  "into",
  "them",
  "what",
  "when",
  "this",
  "they",
  "each",
  "then",
  "than",
  "have",
  "will",
  "make",
  "more",
  "only",
  "also",
  "does",
  "over",
  "just",
]);

/** Four-letter word stems, so "caching" and "cache" meet. */
function stems(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !COMMON.has(w))
      .map((w) => w.slice(0, 4)),
  );
}

/**
 * The deep dive for a gap. An entry is a candidate only when its title shares a word stem with the gap's title: a word
 * anywhere in a long entry, or in the gap's reason, is too weak a sign of the same topic. Among the candidates the
 * shared title words decide, then the gap's words in the entry's text, then the reason's. Null when no title matches.
 */
export function matchDeepDive(entries: readonly DeepDiveEntry[], gapTitle = "", reason = ""): DeepDiveEntry | null {
  const fromTitle = stems(gapTitle);
  const fromReason = stems(reason);
  let best: DeepDiveEntry | null = null;
  let score = 0;
  for (const entry of entries) {
    const title = stems(entry.title);
    let shared = 0;
    for (const s of fromTitle) if (title.has(s)) shared++;
    if (shared === 0) continue;
    let total = shared * 10;
    for (const s of stems(entry.text)) {
      if (title.has(s)) continue;
      if (fromTitle.has(s)) total += 2;
      else if (fromReason.has(s)) total += 0.5;
    }
    for (const s of fromReason) if (title.has(s) && !fromTitle.has(s)) total += 1;
    if (total > score) {
      score = total;
      best = entry;
    }
  }
  return best;
}

/** The matching deep dive, else the one the rotation points at. Only a free drill wants the rotation. */
export function pickDeepDive(entries: readonly DeepDiveEntry[], gapTitle = "", reason = "", rotation = 0): DeepDiveEntry | null {
  if (entries.length === 0) return null;
  return matchDeepDive(entries, gapTitle, reason) ?? entries[Math.abs(rotation) % entries.length] ?? null;
}

// ---------------------------------------------------------------------------
// Changed constraints: the curveballs of a system design brief and the extensions of a machine coding brief.

export interface VariantEntry {
  /** A slug of the title: lower-case letters, digits and hyphens. */
  id: string;
  title: string;
  /** What the candidate sees. */
  question: string;
  /** What a strong answer covers. It joins the answer key and never leaves the server. */
  expect: string;
}

const MAX_VARIANT_ENTRIES = 8;
const MAX_VARIANT_SECTION = 30_000;
const MAX_VARIANT_TITLE = 120;
const MAX_VARIANT_QUESTION = 1500;
const MAX_VARIANT_EXPECT = 4000;
const EXPECT_MARKER = "Expect:";
/** An entry that says the candidate met it already is not offered again. */
const SEEN_MARKERS = ["already seen", "already used", "seen before", "past session", "earlier attempt", "earlier session"];

function variantSection(problem: Problem): string {
  return section(problem, problem.meta.track === "lld" ? "Extensions" : "Curveballs").slice(0, MAX_VARIANT_SECTION);
}

/** A line that opens a numbered item, such as "1. **Hot link:** ...". Returns the text after the number. */
function numberedStart(line: string): string | null {
  let i = 0;
  while (i < 3 && line[i] === " ") i++;
  let digits = 0;
  while (digits < 3 && /[0-9]/.test(line[i + digits] ?? "")) digits++;
  if (digits === 0) return null;
  const mark = line[i + digits];
  if ((mark !== "." && mark !== ")") || line[i + digits + 1] !== " ") return null;
  return line.slice(i + digits + 2);
}

/** Cuts bullet marks and spaces off the end, so a question never ends on the dash that began an "Expect:" line. */
function trimTail(text: string): string {
  let end = text.length;
  while (end > 0 && " \t\r\n-*".includes(text[end - 1] ?? "x")) end--;
  return text.slice(0, end);
}

function slug(title: string): string {
  const flat = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  let start = 0;
  let end = flat.length;
  while (start < end && flat[start] === "-") start++;
  while (end > start && flat[end - 1] === "-") end--;
  return flat.slice(start, end).slice(0, MAX_VARIANT_ID).replace(/-+$/, "");
}

function expectIndex(text: string): number {
  let from = 0;
  for (;;) {
    const at = text.indexOf(EXPECT_MARKER, from);
    if (at < 0) return -1;
    if (at === 0 || !/[A-Za-z0-9]/.test(text[at - 1] ?? " ")) return at;
    from = at + EXPECT_MARKER.length;
  }
}

/** Cuts a closing parenthetical, which is a note about the entry and not its name. */
function withoutTrailingNote(title: string): string {
  if (!title.endsWith(")")) return title;
  let depth = 0;
  for (let i = title.length - 1; i >= 0; i--) {
    if (title[i] === ")") depth++;
    else if (title[i] === "(" && --depth === 0) return title.slice(0, i).trim() || title;
  }
  return title;
}

function cleanTitle(lead: string): string {
  const trimmed = lead.trim().replace(/[:.\s]+$/, "");
  return withoutTrailingNote(trimmed)
    .replace(/[:.\s]+$/, "")
    .slice(0, MAX_VARIANT_TITLE);
}

function parseVariantEntry(raw: string): Omit<VariantEntry, "id"> | null {
  const text = raw.trim();
  if (!text.startsWith("**")) return null;
  const close = text.indexOf("**", 2);
  if (close < 3) return null;
  const lead = text.slice(2, close);
  if (lead.includes("\n") || lead.length > 300) return null;
  const title = cleanTitle(lead);
  if (
    title === "" ||
    title
      .toLowerCase()
      .split(/[^a-z]+/)
      .includes("expect")
  )
    return null;
  const lower = text.toLowerCase();
  if (SEEN_MARKERS.some((m) => lower.includes(m))) return null;
  let rest = text.slice(close + 2);
  if (rest.startsWith(":")) rest = rest.slice(1);
  const at = expectIndex(rest);
  if (at < 0) return null;
  const question = trimTail(rest.slice(0, at)).trim().slice(0, MAX_VARIANT_QUESTION);
  const expect = rest
    .slice(at + EXPECT_MARKER.length)
    .trim()
    .slice(0, MAX_VARIANT_EXPECT);
  if (question === "" || expect === "") return null;
  return { title, question, expect };
}

/**
 * The changed-constraint entries of a brief, in brief order. Each numbered item is one entry: a bold lead is its title,
 * the text before "Expect:" is the question and the text after joins the answer key. Anything before the first
 * numbered item is a note to the interviewer and is ignored. An entry with no title or no "Expect:", or one that says
 * it was seen already, is skipped. Brief text is untrusted, so the parse walks the lines once and every length is capped.
 */
export function variantEntries(problem: Problem): VariantEntry[] {
  const blocks: string[][] = [];
  for (const line of variantSection(problem).split("\n")) {
    const start = numberedStart(line);
    if (start !== null) blocks.push([start]);
    else blocks.at(-1)?.push(line);
  }
  const entries: VariantEntry[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    const entry = parseVariantEntry(block.join("\n"));
    const id = entry ? slug(entry.title) : "";
    if (!entry || id === "" || seen.has(id)) continue;
    seen.add(id);
    entries.push({ id, ...entry });
    if (entries.length >= MAX_VARIANT_ENTRIES) break;
  }
  return entries;
}

const INTERVIEWER_NOTES = ["the candidate", "is also accepted", "are accepted", "pick another", "state this when", "they saw"];

/** Phrases that belong to the interviewer's notes, found in a question the candidate would read. */
export function interviewerNotesIn(question: string): string[] {
  const lower = question.toLowerCase();
  return INTERVIEWER_NOTES.filter((phrase) => lower.includes(phrase));
}

const VARIANT_TASK: Record<DrillType, string> = {
  capacity: "The situation changed as below. Work out the numbers that matter now, and say what each one forces.",
  walk: "Walk one request through your design after the change below. Say which boxes change and why.",
  requirements: "The interviewer adds the change below. Say which requirements move and what you ask again, with the numbers you would assume.",
  deep_dive: "Take the change below: say what breaks first, what you would build instead, and what it costs.",
  lld_skeleton: "The requirement below is new. Write the classes that change or are added, with fields and signatures, and say which class stays untouched.",
};

/**
 * The entries a drill may ask. A capacity drill needs numbers to work with, so it prefers entries whose question holds
 * a digit and falls back to all of them.
 */
export function variantsFor(problem: Problem, drill: DrillType): VariantEntry[] {
  const entries = variantEntries(problem);
  if (drill !== "capacity") return entries;
  const numeric = entries.filter((e) => /\d/.test(e.question));
  return numeric.length > 0 ? numeric : entries;
}

/** Hidden-fact bullets that carry a number: the scale facts a capacity estimate starts from. */
export function scaleFacts(problem: Problem): string[] {
  return bullets(section(problem, "Hidden facts")).filter((b) => /\d/.test(b));
}

function walkName(problem: Problem): string {
  const m = /^Walk one ([^.:\n]+?)[.:]/m.exec(section(problem, "Reference design"));
  return m?.[1]?.replace(/`/g, "").trim() || "request";
}

/** Whether a problem has what the drill needs: a section to prompt from and a key to grade against. */
export function drillFits(problem: Problem, drill: DrillType): boolean {
  if (DRILL_INFO[drill].track !== problem.meta.track) return false;
  if (drill === "capacity") return section(problem, "Capacity math") !== "" && scaleFacts(problem).length > 0;
  if (drill === "walk") return section(problem, "Reference design") !== "";
  if (drill === "requirements") return section(problem, "Expected requirements") !== "";
  if (drill === "deep_dive") return deepDiveEntries(problem).length > 0;
  return section(problem, "Entities and relationships") !== "";
}

export function drillsAvailable(problem: Problem): DrillType[] {
  return drillsForTrack(problem.meta.track).filter((d) => drillFits(problem, d));
}

/**
 * Builds the prompt and the key for one drill on one problem, or null when the brief cannot supply it. With a variant
 * the same drill asks the problem after one changed constraint.
 */
export function buildDrill(problem: Problem, drill: DrillType, ctx: DrillContext = {}): DrillContent | null {
  const entry = ctx.variant ? variantEntries(problem).find((e) => e.id === ctx.variant) : undefined;
  if (!entry) return buildNormal(problem, drill, ctx);
  // The deep dive behind a variant follows the change itself, so a saved attempt rebuilds the same key.
  const base = buildNormal(problem, drill, drill === "deep_dive" ? { gapTitle: entry.title, hint: entry.question } : {});
  if (!base) return null;
  const material = base.prompt.material.filter((m) => m.heading !== "The topic");
  return {
    prompt: {
      ...base.prompt,
      task: VARIANT_TASK[drill],
      ...(drill === "deep_dive" ? { topic: entry.title } : {}),
      variant: { id: entry.id, title: entry.title },
      material: [...material, { heading: "What changed", markdown: entry.question }],
    },
    key: `${base.key}\n\nAfter the change, a strong answer covers:\n${entry.expect}`,
    changed: entry.question,
  };
}

function buildNormal(problem: Problem, drill: DrillType, ctx: DrillContext): DrillContent | null {
  if (!drillFits(problem, drill)) return null;
  const info = DRILL_INFO[drill];
  // The interviewer's closing "where would you like to start?" belongs to a live round, not a drill.
  const opening = section(problem, "Opening prompt").replace(/\s*Where would you (like to )?start\?\s*$/i, "");
  const base = {
    drill,
    title: info.title,
    minutes: info.minutes,
    problem: { id: problem.meta.id, title: problem.meta.title, track: problem.meta.track },
  };
  const problemBlock = { heading: "The problem", markdown: opening };

  switch (drill) {
    case "capacity": {
      return {
        prompt: {
          ...base,
          task: 'Pick only the numbers that decide something and write one line for each. End each line with "which means", then the decision it forces.',
          material: [
            problemBlock,
            {
              heading: "What you know",
              markdown: scaleFacts(problem)
                .map((f) => `- ${f}`)
                .join("\n"),
            },
          ],
          answerHint: "Plain lines are fine. Show the sum, then say what it forces you to build.",
        },
        key: section(problem, "Capacity math"),
      };
    }
    case "walk": {
      const name = walkName(problem);
      return {
        prompt: {
          ...base,
          task: `Walk one ${name} through your design, box by box, from the first call to the last.`,
          material: [problemBlock],
          answerHint: "Name each box in order, and say what it does with the request.",
        },
        key: section(problem, "Reference design"),
      };
    }
    case "requirements":
      return {
        prompt: {
          ...base,
          task: "Nobody answers here, so write each question with the answer or number you would assume. Split the requirements into what it does and how well it must do it, with the scale as numbers.",
          material: [problemBlock],
          answerHint: "Write each question and the answer or number you would assume. Say why when it changes the design.",
        },
        key: [
          section(problem, "Expected requirements"),
          "Facts the interviewer holds back until asked:",
          bullets(section(problem, "Hidden facts"))
            .map((b) => `- ${b}`)
            .join("\n"),
        ].join("\n\n"),
      };
    case "deep_dive": {
      const entries = deepDiveEntries(problem);
      const entry = (ctx.topic ? entries.find((e) => e.title === ctx.topic) : undefined) ?? pickDeepDive(entries, ctx.gapTitle, ctx.hint, ctx.rotation);
      if (!entry) return null;
      return {
        prompt: {
          ...base,
          task: `Take "${entry.title}": say what goes wrong with the naive way, what you would build instead, and what it costs.`,
          topic: entry.title,
          material: [problemBlock, { heading: "The topic", markdown: entry.title }],
          answerHint: "Go one level deeper than your first answer, and name the trade-off.",
        },
        key: `### ${entry.title}\n${entry.text}`,
      };
    }
    default: {
      const facts = bullets(section(problem, "Hidden facts"));
      return {
        prompt: {
          ...base,
          task: "Write the classes: names, fields and method signatures, with no bodies. Say which class owns each rule.",
          material: [problemBlock, ...(facts.length > 0 ? [{ heading: "What you know", markdown: facts.map((f) => `- ${f}`).join("\n") }] : [])],
          answerHint: "One class per block is fine. Plain text, C++ style signatures are welcome.",
        },
        key: [section(problem, "Entities and relationships"), section(problem, "Behaviour and states")].filter(Boolean).join("\n\n"),
      };
    }
  }
}
