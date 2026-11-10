import { z } from "zod";
import { DRILL_INFO, DRILL_RUBRIC, outcomeFor, type DrillOutcome, type DrillPrompt, type DrillType } from "../../shared/drills";
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

/** The user message for one grading call. The key and the answer are data, never instructions. */
export function graderMessage(prompt: Pick<DrillPrompt, "drill" | "task" | "problem" | "material">, key: string, answer: string): string {
  return [
    `<drill>${DRILL_INFO[prompt.drill].title}</drill>`,
    `<problem>${prompt.problem.title}</problem>`,
    `<task>${prompt.task}</task>`,
    "<shown_to_candidate>",
    ...prompt.material.map((m) => escapeBlock(`${m.heading}:\n${m.markdown}`)),
    "</shown_to_candidate>",
    "<criteria>",
    ...DRILL_RUBRIC[prompt.drill].criteria.map((k) => `${k.id}: ${k.label}`),
    "</criteria>",
    "<answer_key>",
    escapeBlock(key),
    "</answer_key>",
    "<answer>",
    escapeBlock(answer),
    "</answer>",
    "Score each criterion from 1 to 4 on the candidate's reasoning, using the key as a reference. Return the scores, what went well, what to improve, the candidate's line and what a strong answer says.",
  ].join("\n");
}
