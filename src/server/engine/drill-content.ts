import { DRILL_INFO, MAX_VARIANT_ID, drillServesTrack, drillsForTrack, type DrillPrompt, type DrillType } from "../../shared/drills";
import type { Problem } from "../../shared/problem";

/** What a drill shows the candidate, and the answer key only the grader reads. */
export interface DrillContent {
  prompt: DrillPrompt;
  key: string;
  /** The changed-constraint question of a variant, saved with the attempt. */
  changed?: string;
}

export interface DrillContext {
  /** The gap's title, used to pick the deep dive or trade-off that matches it. */
  gapTitle?: string;
  /** Why the gap matters; it only breaks ties between deep dives. */
  hint?: string;
  /** Picks the topic when the gap's title matches none: the count of finished attempts, so the topic moves on after each one. */
  rotation?: number;
  /** A deep dive's or trade-off's title, to rebuild the topic a saved attempt or the prompt used. */
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

/** Words that name no topic in a trade-off gap or title: they sit in nearly every entry and every gap about a choice. */
const TRADEOFF_COMMON: ReadonlySet<string> = new Set([...COMMON, "without", "reason", "choice", "option", "design", "picked", "explain"]);

/** Four-letter word stems, so "caching" and "cache" meet. */
function stems(text: string, skip: ReadonlySet<string> = COMMON): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !skip.has(w))
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

/** The matching deep dive, else the one the rotation points at. */
export function pickDeepDive(entries: readonly DeepDiveEntry[], gapTitle = "", reason = "", rotation = 0): DeepDiveEntry | null {
  if (entries.length === 0) return null;
  return matchDeepDive(entries, gapTitle, reason) ?? entries[Math.abs(rotation) % entries.length] ?? null;
}

// ---------------------------------------------------------------------------
// Trade-offs: the accepted alternatives of a system design brief. Each top-level bullet is one design choice.

export interface TradeoffEntry {
  title: string;
  /** The whole bullet with its sub-bullets. It is the answer key and never leaves the server. */
  text: string;
}

const MAX_TRADEOFF_SECTION = 40_000;
const MAX_TRADEOFF_ENTRIES = 30;
const MAX_TRADEOFF_TEXT = 6000;
const MAX_TRADEOFF_TITLE = 120;

/**
 * A bullet that gathers small unrelated choices names no decision, so it cannot be a topic. Briefs title such a bullet
 * "Other ..." (and older ones "Smaller choices"); this short list is the only place that rule lives.
 */
function isCatchAll(title: string): boolean {
  const lower = title.toLowerCase();
  return lower === "smaller choices" || lower.startsWith("other");
}

/** The text after a top-level bullet mark, or null when the line is not one. */
function topBulletText(line: string): string | null {
  return line.startsWith("- ") || line.startsWith("* ") ? line.slice(2) : null;
}

/** Cuts dots, colons and spaces off the end of a bold lead. */
function trimLead(text: string): string {
  let end = text.length;
  while (end > 0 && ". :\t".includes(text[end - 1] ?? "x")) end--;
  return text.slice(0, end);
}

/**
 * The entries of the "Accepted alternatives" section. A top-level bullet that opens with a bold lead is an entry, its
 * title is the lead without the closing dot, and the indented lines under it belong to it. Brief text is untrusted, so
 * the parse walks the lines once and every length is capped.
 */
export function tradeoffEntries(problem: Problem): TradeoffEntry[] {
  const entries: TradeoffEntry[] = [];
  let current: { title: string; lines: string[] } | null = null;
  const flush = () => {
    if (current) entries.push({ title: current.title, text: current.lines.join("\n").trim().slice(0, MAX_TRADEOFF_TEXT) });
    current = null;
  };
  for (const line of section(problem, "Accepted alternatives").slice(0, MAX_TRADEOFF_SECTION).split("\n")) {
    const top = topBulletText(line);
    if (top === null) {
      current?.lines.push(line);
      continue;
    }
    flush();
    if (entries.length >= MAX_TRADEOFF_ENTRIES) break;
    if (!top.startsWith("**")) continue;
    const close = top.indexOf("**", 2);
    if (close < 3) continue;
    const title = trimLead(top.slice(2, close).replace(/`/g, "").trim()).slice(0, MAX_TRADEOFF_TITLE);
    if (title !== "" && !isCatchAll(title)) current = { title, lines: [line] };
  }
  flush();
  return entries;
}

/**
 * The trade-off whose title shares the most word stems with the gap's title, the first one on a tie. Words anywhere
 * else, such as the gap's reason or the entry's text, are too common to tell topics apart. Null when no title matches.
 */
export function matchTradeoff(entries: readonly TradeoffEntry[], gapTitle = ""): TradeoffEntry | null {
  const wanted = stems(gapTitle, TRADEOFF_COMMON);
  let best: TradeoffEntry | null = null;
  let score = 0;
  for (const entry of entries) {
    const title = stems(entry.title, TRADEOFF_COMMON);
    let shared = 0;
    for (const s of wanted) if (title.has(s)) shared++;
    if (shared > score) {
      score = shared;
      best = entry;
    }
  }
  return best;
}

/** The matching trade-off, else the one the rotation points at. */
export function pickTradeoff(entries: readonly TradeoffEntry[], gapTitle = "", rotation = 0): TradeoffEntry | null {
  if (entries.length === 0) return null;
  return matchTradeoff(entries, gapTitle) ?? entries[Math.abs(rotation) % entries.length] ?? null;
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

const VARIANT_TASK: Record<Exclude<DrillType, "tradeoff">, string> = {
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

// A brief's fact bullets are written for the interviewer, and some carry notes to them inside a fact. A drill shows
// the facts to the candidate, so a note, and any word about the extensions still to come, must not reach the page.
const NOTE_SENTENCE = [
  /\b(?:do not|don't|never) (?:mention|volunteer|test|require|reveal|bring up|hint)\b/i,
  /\bextension step\b/i,
  /\bif they (?:propose|suggest|ask)\b/i,
  /\blet them\b/i,
  /\bthe candidate\b/i,
];
const NOTE_ASIDE = /\b(?:if asked|volunteer|candidate|extension|interviewer|do not|don't)\b/i;
const EXTENSIONS_LEAD = /^\**\s*extensions?\b/i;
const MAX_FACT_CHARS = 2000;

/** One fact bullet without its notes to the interviewer, or null when nothing but a note or its label is left. */
export function factOnly(bullet: string): string | null {
  const text = bullet.slice(0, MAX_FACT_CHARS);
  if (EXTENSIONS_LEAD.test(text)) return null;
  const asides = text.replace(/\s*\([^()]{0,300}\)/g, (aside) => (NOTE_ASIDE.test(aside) ? "" : aside));
  // The bold label names the fact, so it stays even when the sentence it opens is a note.
  const lead = /^\*\*[^*]{1,120}\*\*:?/.exec(asides)?.[0] ?? "";
  const kept = asides
    .slice(lead.length)
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !NOTE_SENTENCE.some((note) => note.test(sentence)))
    .join(" ")
    .trim();
  if (kept === "") return null;
  return lead === "" ? kept : `${lead} ${kept}`;
}

/** The hidden-fact bullets as a drill may show them: facts only. */
export function shownFacts(problem: Problem): string[] {
  return bullets(section(problem, "Hidden facts")).flatMap((b) => factOnly(b) ?? []);
}

/** Hidden-fact bullets that carry a number: the scale facts a capacity estimate starts from. */
export function scaleFacts(problem: Problem): string[] {
  return shownFacts(problem).filter((b) => /\d/.test(b));
}

function walkName(problem: Problem): string {
  const m = /^Walk one ([^.:\n]+?)[.:]/m.exec(section(problem, "Reference design"));
  return m?.[1]?.replace(/`/g, "").trim() || "request";
}

const PATTERNS_SECTION = "Patterns that fit";

/** Whether a problem has what the drill needs: a section to prompt from and a key to grade against. */
export function drillFits(problem: Problem, drill: DrillType): boolean {
  if (!drillServesTrack(drill, problem.meta.track)) return false;
  if (drill === "capacity") return section(problem, "Capacity math") !== "" && scaleFacts(problem).length > 0;
  if (drill === "walk") return section(problem, "Reference design") !== "";
  if (drill === "requirements") return section(problem, "Expected requirements") !== "";
  if (drill === "deep_dive") return deepDiveEntries(problem).length > 0;
  if (drill === "tradeoff") return problem.meta.track === "lld" ? section(problem, PATTERNS_SECTION) !== "" : tradeoffEntries(problem).length > 0;
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
  if (drill === "tradeoff") return buildTradeoffVariant(problem, entry);
  // The deep dive behind a variant follows the change itself, so a saved attempt rebuilds the same key.
  const base = buildNormal(problem, drill, drill === "deep_dive" ? { gapTitle: entry.title, hint: entry.question } : {});
  if (!base) return null;
  const material = base.prompt.material.filter((m) => m.heading !== "The topic");
  return {
    prompt: {
      ...base.prompt,
      task: VARIANT_TASK[drill as Exclude<DrillType, "tradeoff">],
      ...(drill === "deep_dive" ? { topic: entry.title } : {}),
      variant: { id: entry.id, title: entry.title },
      material: [...material, { heading: "What changed", markdown: entry.question }],
    },
    key: `${base.key}\n\nAfter the change, a strong answer covers:\n${entry.expect}`,
    changed: entry.question,
  };
}

/** The titles a drill may name as its topic. A kind with no topics offers none. */
export function topicTitles(problem: Problem, drill: DrillType): string[] {
  if (drill === "deep_dive") return deepDiveEntries(problem).map((e) => e.title);
  if (drill === "tradeoff" && problem.meta.track !== "lld") return tradeoffEntries(problem).map((e) => e.title);
  return [];
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
    case "tradeoff":
      return buildTradeoff(problem, ctx);
    default: {
      const facts = shownFacts(problem);
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

const LLD_TRADEOFF_TASK = "Name the design patterns you would use in this problem and the ones you would leave out, each with the reason from the requirements.";
const LLD_TRADEOFF_HINT = "Name each pattern with the reason from the requirements. Say which ones you leave out and why.";
const LLD_TRADEOFF_VARIANT_TASK = "The requirement below is new. Say which patterns you would use or drop now, each with the reason.";
const LLD_TRADEOFF_VARIANT_HINT = "Name the patterns you would use or drop after the new requirement, each with the reason.";

/** What both trade-off prompts start from. A machine coding problem also shows its facts, so the reasons can come from the requirements. */
function tradeoffShell(problem: Problem) {
  const opening = section(problem, "Opening prompt").replace(/\s*Where would you (like to )?start\?\s*$/i, "");
  const info = DRILL_INFO.tradeoff;
  const facts = problem.meta.track === "lld" ? shownFacts(problem) : [];
  return {
    base: {
      drill: "tradeoff" as const,
      title: info.title,
      minutes: info.minutes,
      problem: { id: problem.meta.id, title: problem.meta.title, track: problem.meta.track },
    },
    material: [{ heading: "The problem", markdown: opening }, ...(facts.length > 0 ? [{ heading: "What you know", markdown: facts.map((f) => `- ${f}`).join("\n") }] : [])],
  };
}

/**
 * The trade-off drill. A system design problem offers one design choice of the brief; a machine coding problem offers
 * its whole patterns section at once, because a pattern's name would give the answer away.
 */
function buildTradeoff(problem: Problem, ctx: DrillContext): DrillContent | null {
  if (!drillFits(problem, "tradeoff")) return null;
  const { base, material } = tradeoffShell(problem);
  if (problem.meta.track === "lld") {
    return { prompt: { ...base, task: LLD_TRADEOFF_TASK, material, answerHint: LLD_TRADEOFF_HINT }, key: section(problem, PATTERNS_SECTION) };
  }
  const entries = tradeoffEntries(problem);
  const entry = (ctx.topic ? entries.find((e) => e.title === ctx.topic) : undefined) ?? pickTradeoff(entries, ctx.gapTitle, ctx.rotation);
  if (!entry) return null;
  return {
    prompt: {
      ...base,
      task: `The topic is "${entry.title}". Say what you would choose for this problem, give the reason from its requirements, and say what would make you choose differently.`,
      topic: entry.title,
      material: [...material, { heading: "The topic", markdown: entry.title }],
      answerHint: "Take a side and give the reason from this problem's needs. Expect a question that pushes back.",
    },
    key: entry.text,
  };
}

/** The alternative a changed constraint most likely touches: the one whose title shares the most stems with the change, else the first. */
function alternativeFor(entries: readonly TradeoffEntry[], change: VariantEntry): TradeoffEntry | null {
  return matchTradeoff(entries, `${change.title} ${change.question}`) ?? entries[0] ?? null;
}

/**
 * The trade-off drill after a changed constraint. A system design task names the alternative the change touches, and
 * its key is the whole section; a machine coding task asks which patterns the new requirement adds or drops.
 */
function buildTradeoffVariant(problem: Problem, change: VariantEntry): DrillContent | null {
  if (!drillFits(problem, "tradeoff")) return null;
  const { base, material } = tradeoffShell(problem);
  const lld = problem.meta.track === "lld";
  const chosen = lld ? null : alternativeFor(tradeoffEntries(problem), change);
  if (!lld && !chosen) return null;
  const key = lld ? section(problem, PATTERNS_SECTION) : section(problem, "Accepted alternatives").slice(0, MAX_TRADEOFF_SECTION);
  return {
    prompt: {
      ...base,
      task: chosen
        ? `Your choice was about "${chosen.title}". The situation changed as below. Say whether you keep that choice or change it, and defend it.`
        : LLD_TRADEOFF_VARIANT_TASK,
      ...(chosen ? { topic: chosen.title } : {}),
      variant: { id: change.id, title: change.title },
      material: [...material, { heading: "What changed", markdown: change.question }],
      answerHint: chosen ? "Say whether you keep the choice or change it, and give the reason from the change." : LLD_TRADEOFF_VARIANT_HINT,
    },
    key: `${key}\n\nAfter the change, a strong answer covers:\n${change.expect}`,
    changed: change.question,
  };
}
