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
export const FALLBACK_QUESTION = "What is the weakest part of what you just said, and how would you fix it?";

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

function clip(text: string, max: number): string {
  const flat = text.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
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

/**
 * Cleans a follow-up question from the model. Control characters go, the length is capped, private names are redacted,
 * and a question that shares `KEY_COPY_WORDS` or more words in a row with the answer key is replaced by a fixed one, so
 * a question never hands the key back. Null when nothing is left.
 */
export function cleanQuestion(raw: string, key: string, redact: (text: string) => string): string | null {
  const text = redact(clip(raw, SHOWN_QUESTION_CHARS));
  if (text === "") return null;
  return dropKeyCopies([text], key).length === 0 ? FALLBACK_QUESTION : text;
}

export interface FinishOptions {
  drill: DrillType;
  key: string;
  redact: (text: string) => string;
}

/**
 * Turns the grader's reply into what the page shows. It throws, so the caller can ask again, unless the scores name
 * exactly the drill's criteria once each. The outcome comes from the scores in code, never from the model. The quoted
 * line must really be in the answer; when the model misquotes, the first line of the answer stands in, so the page
 * never shows words the candidate did not write. Feedback that copies the key is dropped.
 */
export function finishGrade(output: GraderOutput, answer: string, opts: FinishOptions): GradedAnswer {
  const criteria = DRILL_RUBRIC[opts.drill].criteria;
  const ids = output.scores.map((s) => s.id);
  if (ids.length !== criteria.length || new Set(ids).size !== ids.length || !criteria.every((k) => ids.includes(k.id))) {
    throw new Error("The grader did not score exactly the criteria of this drill.");
  }
  const scores = criteria.map((k) => ({ id: k.id, score: output.scores.find((s) => s.id === k.id)?.score ?? 1 }));
  const text = (line: string) => opts.redact(clip(line, SHOWN_CHARS));
  const lines = (list: readonly string[]) =>
    dropKeyCopies(
      list.map(text).filter((l) => l !== ""),
      opts.key,
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
    strong: text(output.strong),
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
    `<problem>${prompt.problem.title}</problem>`,
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

/** The user message for the interviewer's question calls. `asked` is how many questions the transcript already holds. */
export function followUpMessage(prompt: Pick<DrillPrompt, "drill" | "task" | "problem" | "material">, key: string, turns: readonly DrillTurn[], asked: number): string {
  const last =
    asked === 0
      ? "Ask the first follow-up question. Return it in `question`."
      : `You asked ${asked} of at most ${MAX_FOLLOW_UPS} questions. Decide whether one more question is needed: only when a core point is still open. Return \`another\`, and the question in \`question\` (an empty string when another is false).`;
  return [...messageHead(prompt, key), ...transcriptBlock(turns), last].join("\n");
}
