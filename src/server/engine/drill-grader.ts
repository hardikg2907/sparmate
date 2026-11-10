import { z } from "zod";
import { DRILL_INFO, DRILL_RUBRIC, MAX_FOLLOW_UPS, outcomeFor, type DrillOutcome, type DrillPrompt, type DrillTurn, type DrillType } from "../../shared/drills";
import { quoteIn } from "../../shared/quotes";

const MAX_TEXT = 600;
/** What the page shows; the schema allows a little more so a slightly long reply is trimmed, not thrown away. */
const SHOWN_CHARS = 320;
const SHOWN_QUOTE_CHARS = 240;
/** Words in a row that a feedback line may share with the answer key before it counts as a copy of it. */
export const KEY_COPY_WORDS = 6;

const Line = z.string().min(1).max(MAX_TEXT);

export const GraderOutputSchema = z.strictObject({
  scores: z
    .array(z.strictObject({ id: z.string().min(1).max(40), score: z.number().int().min(1).max(4) }))
    .min(1)
    .max(8)
    .describe("One score from 1 to 4 for each criterion in the criteria block, with the criterion's id."),
  wentWell: z.array(Line).max(2).describe("Up to two short plain sentences on what the answer did well. Empty when nothing stands out."),
  improve: z.array(Line).min(1).max(2).describe("One or two short plain sentences on what to do to make the answer stronger. Never quote or list the answer key."),
  yourLine: z.string().max(MAX_TEXT).describe("The one line of the candidate's answer that shows the problem or the best of it, copied word for word."),
  strong: Line.describe("One short line of what a strong answer says for this problem, written as the candidate would say it."),
});
export type GraderOutput = z.infer<typeof GraderOutputSchema>;

const MAX_QUESTION_RAW = 800;
/** What the page shows of a follow-up question. */
const SHOWN_QUESTION_CHARS = 300;

/** The question the interviewer asks when the model's own question would hand back the key. */
export const FALLBACK_QUESTION = "What is the weakest part of what you just said?";

export const FirstQuestionSchema = z.strictObject({
  question: z
    .string()
    .min(1)
    .max(MAX_QUESTION_RAW)
    .describe("One short question that probes the weakest or least supported part of the answer. Never reveal or quote the reference."),
});
export type FirstQuestion = z.infer<typeof FirstQuestionSchema>;

export const NextQuestionSchema = z.strictObject({
  another: z.boolean().describe("True only when a core point is still open after the candidate's reply."),
  question: z.string().max(MAX_QUESTION_RAW).describe("The next short question when another is true, else an empty string. Never reveal or quote the reference."),
});
export type NextQuestion = z.infer<typeof NextQuestionSchema>;

export interface GradedAnswer {
  scores: { id: string; score: number }[];
  outcome: DrillOutcome;
  wentWell: string[];
  improve: string[];
  yourLine: string;
  /** Saved with the attempt and never sent to the browser. */
  strong: string;
}

// Model output is untrusted: control characters never reach the page, and the page renders every field as text.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]+/g;

function flatQuestion(raw: string): string {
  return raw.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
}

function clip(text: string, max: number): string {
  const flat = flatQuestion(text);
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

function firstLine(answer: string): string {
  const line = answer.split("\n").find((l) => l.trim() !== "") ?? "";
  return clip(line, SHOWN_QUOTE_CHARS);
}

function tokens(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/**
 * Drops every line that shares `KEY_COPY_WORDS` or more words in a row with the answer key, so feedback never hands
 * the key back. The comparison uses lower-case letters and digits only. The key is indexed once, then each line is
 * walked once, so the work grows with the input and never with its square.
 */
export function dropKeyCopies(lines: readonly string[], key: string, run = KEY_COPY_WORDS): string[] {
  const keyWords = tokens(key);
  const seen = new Set<string>();
  for (let i = 0; i + run <= keyWords.length; i++) seen.add(keyWords.slice(i, i + run).join(" "));
  if (seen.size === 0) return [...lines];
  return lines.filter((line) => {
    const words = tokens(line);
    for (let i = 0; i + run <= words.length; i++) {
      if (seen.has(words.slice(i, i + run).join(" "))) return false;
    }
    return true;
  });
}

/** Key-only words a feedback line may hold before it counts as handing over the answer. */
export const KEY_REVEAL_WORDS = 3;
const REVEAL_WORD_CHARS = 6;

/**
 * Drops every line that gives away part of the answer key in its own words: a number from the key, or
 * `KEY_REVEAL_WORDS` longer words from it, that the candidate did not write and the drill did not show. Feedback may
 * point at a gap, but the candidate must still do the thinking, because one revision follows the feedback.
 */
export function dropKeyReveals(lines: readonly string[], key: string, known: string, limit = KEY_REVEAL_WORDS): string[] {
  const inKey = new Set(tokens(key));
  const seen = new Set(tokens(known));
  return lines.filter((line) => {
    const fresh = new Set(tokens(line).filter((w) => inKey.has(w) && !seen.has(w)));
    let words = 0;
    for (const w of fresh) {
      if (/[0-9]/.test(w)) return false;
      if (w.length >= REVEAL_WORD_CHARS) words++;
    }
    return words < limit;
  });
}

export type QuestionProblem = "two" | "opener" | "statement" | "key";

/** Why a question was not used, in words the model reads when it is asked again. */
export const QUESTION_PROBLEMS: Record<QuestionProblem, string> = {
  two: 'it asks two things at once. Ask one question with one question mark, no second clause joined by "and", and nothing after the question mark.',
  opener: "it opens by telling the candidate what the hard part of the problem is. Ask about what the candidate wrote.",
  statement: "it tells the candidate what their design is. Quote or name only what the candidate wrote, then ask.",
  key: "it names something from the reference that the candidate did not write. Ask what happens, what it costs or why, in the candidate's own terms.",
};

// The input is model output capped by its schema. In each pattern below no two repeats can match the same characters,
// and nested repeats are bounded, so none can backtrack badly.
const AUX = "(?:does|do|did|is|are|was|were|can|could|would|will|should|has|have|might|must)";
/** Where a question starts: a question word, "where" or "when" with a verb, or a verb before its subject. */
const QUESTION_START = new RegExp(
  `^(?:(?:so|and|but|then)\\s+)?${AUX}\\s+\\S|(?:^|[,:]\\s+)(?:(?:so|and|but|then)\\s+)?(?:(?:what|which|who|whose|how|why)\\b|(?:where|when)\\s+${AUX}\\b|${AUX}\\s+(?:you|it|this|that|these|those|the|a|an|your|they|we|there|each|every|one)\\b)`,
  "i",
);
/** A second question joined to the first: ", and what ...", "and why?", "; how ...". */
const SECOND = new RegExp(
  `(?:,\\s+and\\s+(?:what|which|who|whose|how|why|where|when|if|whether|${AUX})\\b|\\s+and\\s+(?:what|which|how|why|where|when)\\b(?=\\s*\\?|\\s+${AUX}\\b)|;\\s*(?:what|which|who|how|why|where|when|${AUX})\\b)`,
  "i",
);
const OPENER =
  /^(?:(?:so|now|well|here|okay|ok),?\s+)?the\s+(?:(?:hardest|hard|trickiest|tricky|key|main|real|core|central|biggest)\s+(?:part|problem|challenge|issue|difficulty|question|risk|catch)|crux)\b/i;
const STATEMENT = /\byour\s+((?:[a-z-]+\s+){0,2})is\s+(?:a|an|just|really|actually|basically|essentially)\s+([a-z-]+(?:\s+[a-z-]+){0,2})/i;
/** A subject that is the candidate's whole design, so naming what it "is" tells them their design. */
const DESIGN_WORDS = new Set(["design", "approach", "plan", "solution", "system", "architecture", "answer", "idea", "model", "scheme", "strategy"]);
/** Words too common to name a mechanism when two of them sit side by side. */
const PAIR_FILLER = new Set([
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
  "about",
  "would",
  "could",
  "should",
  "there",
  "their",
  "which",
  "where",
  "while",
  "after",
  "before",
  "being",
  "been",
  "were",
  "happens",
  "happen",
  "same",
  "other",
  "every",
  "some",
  "many",
  "much",
  "most",
  "still",
]);
const QUESTION_NUMBER_DIGITS = 3;
const QUESTION_WORD_CHARS = 6;
const STATEMENT_WORD_CHARS = 7;
/** A question builds on the candidate's own words, so fewer key words than in a feedback line already give it away. */
export const QUESTION_REVEAL_WORDS = 2;

function numbers(text: string): Set<string> {
  return new Set((text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, "").replace(/\.$/, "")));
}

function pairs(words: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 1 < words.length; i++) out.add(`${words[i]} ${words[i + 1]}`);
  return out;
}

/**
 * Whether a question brings in part of the key the candidate did not write and was not shown: a number of three
 * digits or more, two longer words, or two words side by side as the key has them (a mechanism's name, such as
 * "<adjective> <noun>", is often two short words).
 */
function questionReveals(text: string, key: string, known: string): boolean {
  const seenNumbers = numbers(known);
  const keyNumbers = numbers(key);
  for (const n of numbers(text)) {
    if (n.replace(/\D/g, "").length >= QUESTION_NUMBER_DIGITS && keyNumbers.has(n) && !seenNumbers.has(n)) return true;
  }
  const words = (line: string) => tokens(line).filter((w) => !/[0-9]/.test(w));
  const keyWords = words(key);
  const inKey = new Set(keyWords);
  const seen = new Set(tokens(known));
  const asked = words(text);
  const fresh = new Set(asked.filter((w) => inKey.has(w) && !seen.has(w) && w.length >= QUESTION_WORD_CHARS));
  if (fresh.size >= QUESTION_REVEAL_WORDS) return true;
  const keyPairs = pairs(keyWords);
  for (let i = 0; i + 1 < asked.length; i++) {
    const a = asked[i] ?? "";
    const b = asked[i + 1] ?? "";
    if (a.length < 4 || b.length < 4 || PAIR_FILLER.has(a) || PAIR_FILLER.has(b)) continue;
    if ((!seen.has(a) || !seen.has(b)) && keyPairs.has(`${a} ${b}`)) return true;
  }
  return false;
}

/** The positions of the question marks that are not inside a quote, so a quoted question is the candidate's own words. */
function marksOutsideQuotes(text: string): number[] {
  const marks: number[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (c === "“") quoted = true;
    else if (c === "”") quoted = false;
    else if (c === "?" && !quoted) marks.push(i);
  }
  return marks;
}

/** A setup sentence may join clauses with "and"; only the sentence that asks can hold a second question. */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/);
}

/** Where a second question starts inside the asking sentence, or -1. It counts only after a real question start. */
function secondAt(ask: string): number {
  const second = SECOND.exec(ask);
  if (!second) return -1;
  return QUESTION_START.test(ask.slice(0, second.index)) ? second.index : -1;
}

function statesDesign(text: string, key: string, known: string): boolean {
  const m = STATEMENT.exec(text);
  if (!m) return false;
  const subject = (m[1] ?? "").toLowerCase().split(/\s+/);
  if (subject.some((w) => DESIGN_WORDS.has(w))) return true;
  // Otherwise the statement names a mechanism only when its words come from the key: one long word, or two side by side.
  const keyWords = tokens(key);
  const inKey = new Set(keyWords);
  const keyPairs = pairs(keyWords);
  const seen = new Set(tokens(known));
  const named = tokens(m[2] ?? "");
  if (named.some((w) => w.length >= STATEMENT_WORD_CHARS && inKey.has(w) && !seen.has(w))) return true;
  return named.some((w, i) => i + 1 < named.length && (!seen.has(w) || !seen.has(named[i + 1] ?? "")) && keyPairs.has(`${w} ${named[i + 1]}`));
}

/** The first rule a question breaks, checked in this order, or null. */
function problemOf(text: string, key: string, known: string): QuestionProblem | null {
  if (dropKeyCopies([text], key).length === 0 || questionReveals(text, key, known)) return "key";
  if (OPENER.test(text)) return "opener";
  if (statesDesign(text, key, known)) return "statement";
  const marks = marksOutsideQuotes(text);
  const first = marks[0] ?? -1;
  const after = first >= 0 ? text.slice(first + 1).replace(/^["')\]”\s]+/, "") : "";
  if (marks.length > 1 || after !== "") return "two";
  const ask = sentences(first >= 0 ? text.slice(0, first + 1) : text).at(-1) ?? "";
  return secondAt(ask) >= 0 ? "two" : null;
}

export interface QuestionReview {
  /** The question as the page would show it. */
  question: string;
  problem: QuestionProblem | null;
}

/**
 * Checks a follow-up question from the model. An interviewer asks one thing at a time, never tells the candidate what
 * their design is or where the difficulty lies, and never brings in the key. `known` is what the candidate wrote and
 * was shown: words from it are never a giveaway. Control characters go, private names are redacted before the
 * length is capped, so a cut never leaves part of a name. Null when nothing is left.
 */
export function reviewQuestion(raw: string, key: string, known: string, redact: (text: string) => string): QuestionReview | null {
  const flat = redact(flatQuestion(raw));
  const question = clip(flat, SHOWN_QUESTION_CHARS);
  if (question === "") return null;
  return { question, problem: problemOf(flat, key, known) };
}

/**
 * The question to show when the model asked a flawed one twice. It keeps the text up to the first question mark and
 * cuts a second question joined to the first. When what is left is not a question, has an open quote, or still
 * breaks a rule, the fixed question stands in, so a question never hands the key back.
 */
export function salvageQuestion(raw: string, key: string, known: string, redact: (text: string) => string): string {
  const flat = redact(flatQuestion(raw));
  const first = marksOutsideQuotes(flat)[0] ?? -1;
  const parts = sentences(first >= 0 ? flat.slice(0, first + 1) : flat);
  const ask = parts.at(-1) ?? "";
  const cut = secondAt(ask);
  if (cut >= 0) parts[parts.length - 1] = `${ask.slice(0, cut).trimEnd()}?`;
  const text = parts.join(" ");
  const quotes = (text.match(/"/g) ?? []).length % 2 === 0 && (text.match(/“/g) ?? []).length === (text.match(/”/g) ?? []).length;
  if (!text.endsWith("?") || !quotes || !QUESTION_START.test(parts.at(-1) ?? "") || problemOf(text, key, known) !== null) return FALLBACK_QUESTION;
  return clip(text, SHOWN_QUESTION_CHARS);
}

export interface FinishOptions {
  drill: DrillType;
  key: string;
  /** What the drill showed the candidate: the task and the material. Words from it are never a giveaway. */
  shown: string;
  redact: (text: string) => string;
}

/**
 * Turns the grader's reply into what the page shows. It throws, so the caller can ask again, unless the scores name
 * exactly the drill's criteria once each. The outcome comes from the scores in code, never from the model. The quoted
 * line must really be in the answer; when the model misquotes, the first line of the answer stands in, so the page
 * never shows words the candidate did not write. Feedback that copies the key, or gives part of it away, is dropped.
 */
export function finishGrade(output: GraderOutput, answer: string, opts: FinishOptions): GradedAnswer {
  const criteria = DRILL_RUBRIC[opts.drill].criteria;
  const ids = output.scores.map((s) => s.id);
  if (ids.length !== criteria.length || new Set(ids).size !== ids.length || !criteria.every((k) => ids.includes(k.id))) {
    throw new Error("The grader did not score exactly the criteria of this drill.");
  }
  const scores = criteria.map((k) => ({ id: k.id, score: output.scores.find((s) => s.id === k.id)?.score ?? 1 }));
  // The page shows labels only, so an id the model wrote into a line reads as its label.
  const named = (line: string) => criteria.reduce((out, k) => (k.id.includes("_") ? out.split(k.id).join(`"${k.label}"`) : out), line);
  const text = (line: string) => opts.redact(clip(named(line), SHOWN_CHARS));
  const known = [answer, opts.shown, ...criteria.map((k) => k.label)].join("\n");
  const lines = (list: readonly string[]) =>
    dropKeyReveals(
      dropKeyCopies(
        list.map(text).filter((l) => l !== ""),
        opts.key,
      ),
      opts.key,
      known,
    );
  const wentWell = lines(output.wentWell);
  let improve = lines(output.improve);
  if (improve.length === 0) {
    const score = new Map(scores.map((x) => [x.id, x.score]));
    const lowest = criteria.reduce((low, k) => ((score.get(k.id) ?? 4) < (score.get(low.id) ?? 4) ? k : low));
    improve = [`Work on this: ${lowest.label}.`];
  }
  const quote = output.yourLine.trim();
  const found = quote !== "" && quoteIn(quote, answer);
  return {
    scores,
    outcome: outcomeFor(opts.drill, scores),
    wentWell,
    improve,
    yourLine: opts.redact(found ? clip(quote, SHOWN_QUOTE_CHARS) : firstLine(answer)),
    // The strong line can reach the page once the drill is over, so it gets the same guard as the feedback.
    strong: dropKeyCopies([text(output.strong)], opts.key)[0] ?? "",
  };
}

/** Angle brackets become entities, so text inside a block can never close it or open a new one. */
export function escapeBlock(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const ROLE_NAME: Record<DrillTurn["role"], string> = { candidate: "candidate", grader: "interviewer" };

/** Every turn of a dialogue in order. Text is escaped, so a turn can never close the block or open another. */
function transcriptBlock(turns: readonly DrillTurn[]): string[] {
  return ["<transcript>", ...turns.map((t) => `<turn role="${ROLE_NAME[t.role]}">${escapeBlock(t.text)}</turn>`), "</transcript>"];
}

function messageHead(prompt: Pick<DrillPrompt, "drill" | "task" | "problem" | "material">, key: string): string[] {
  return [
    `<drill>${DRILL_INFO[prompt.drill].title}</drill>`,
    `<problem>${escapeBlock(prompt.problem.title)}</problem>`,
    `<task>${escapeBlock(prompt.task)}</task>`,
    "<shown_to_candidate>",
    ...prompt.material.map((m) => escapeBlock(`${m.heading}:\n${m.markdown}`)),
    "</shown_to_candidate>",
    "<criteria>",
    ...DRILL_RUBRIC[prompt.drill].criteria.map((k) => `${k.id}: ${k.label}`),
    "</criteria>",
    "<answer_key>",
    escapeBlock(key),
    "</answer_key>",
  ];
}

/**
 * The user message for one grading call. The key and the answer are data, never instructions. A dialogue drill sends
 * the whole conversation as a transcript instead of one answer.
 */
export function graderMessage(prompt: Pick<DrillPrompt, "drill" | "task" | "problem" | "material">, key: string, answer: string | readonly DrillTurn[]): string {
  if (typeof answer !== "string") {
    return [
      ...messageHead(prompt, key),
      ...transcriptBlock(answer),
      "Score each criterion from 1 to 4 on how the candidate reasons across the whole conversation, using the key as a reference. Changing position for a good reason scores as well as holding it. Return the scores, what went well, what to improve, the candidate's line and what a strong answer says.",
    ].join("\n");
  }
  return [
    ...messageHead(prompt, key),
    "<answer>",
    escapeBlock(answer),
    "</answer>",
    "Score each criterion from 1 to 4 on the candidate's reasoning, using the key as a reference. Return the scores, what went well, what to improve, the candidate's line and what a strong answer says.",
  ].join("\n");
}

/** A question the model wrote before that the server did not use, and why. */
export interface RejectedQuestion {
  question: string;
  problem: QuestionProblem;
}

/**
 * The user message for the interviewer's question calls. `asked` is how many questions the transcript already holds.
 * With `rejected`, the model sees its last question and the reason it was not used, so it can ask again once.
 */
export function followUpMessage(
  prompt: Pick<DrillPrompt, "drill" | "task" | "problem" | "material">,
  key: string,
  turns: readonly DrillTurn[],
  asked: number,
  rejected?: RejectedQuestion,
): string {
  const last =
    asked === 0
      ? "Ask the first follow-up question. Return it in `question`."
      : `You asked ${asked} of at most ${MAX_FOLLOW_UPS} questions. Decide whether one more question is needed: only when a core point is still open. Return \`another\`, and the question in \`question\` (an empty string when another is false).`;
  const retry = rejected
    ? [`<rejected_question>${escapeBlock(rejected.question)}</rejected_question>`, `That question was not used, because ${QUESTION_PROBLEMS[rejected.problem]} Write a new one.`]
    : [];
  return [...messageHead(prompt, key), ...transcriptBlock(turns), last, ...retry].join("\n");
}
