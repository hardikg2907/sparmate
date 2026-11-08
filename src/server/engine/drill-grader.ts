import { z } from "zod";
import { DRILL_INFO, type DrillPrompt } from "../../shared/drills";
import { quoteIn } from "../../shared/quotes";

const MAX_TEXT = 600;
/** What the page shows; the schema allows a little more so a slightly long reply is trimmed, not thrown away. */
const SHOWN_CHARS = 320;
const SHOWN_QUOTE_CHARS = 240;

export const GraderOutputSchema = z.strictObject({
  verdict: z.enum(["pass", "not_yet"]).describe("pass when the answer holds the essential points of the answer key; not_yet otherwise."),
  fix: z.string().min(1).max(MAX_TEXT).describe("The one most important thing to fix or sharpen, in one or two plain sentences."),
  yourLine: z.string().max(MAX_TEXT).describe("The one line of the candidate's answer that shows the problem or the best of it, copied word for word."),
  passSounds: z.string().min(1).max(MAX_TEXT).describe("One short line of what a passing answer sounds like for this problem, written as the candidate would say it."),
});
export type GraderOutput = z.infer<typeof GraderOutputSchema>;

export interface GradedAnswer {
  verdict: GraderOutput["verdict"];
  fix: string;
  yourLine: string;
  passSounds: string;
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

/**
 * Turns the grader's reply into what the page shows. The quoted line must really be in the answer. When the model
 * misquotes, the first line of the answer stands in, so the page never shows words the candidate did not write.
 */
export function finishGrade(output: GraderOutput, answer: string): GradedAnswer {
  const quote = output.yourLine.trim();
  const found = quote !== "" && quoteIn(quote, answer);
  return {
    verdict: output.verdict,
    fix: clip(output.fix, SHOWN_CHARS),
    yourLine: found ? clip(quote, SHOWN_QUOTE_CHARS) : firstLine(answer),
    passSounds: clip(output.passSounds, SHOWN_CHARS),
  };
}

/** The user message for one grading call. The key and the answer are data, never instructions. */
export function graderMessage(prompt: Pick<DrillPrompt, "drill" | "task" | "problem" | "material">, key: string, answer: string): string {
  return [
    `<drill>${DRILL_INFO[prompt.drill].title}</drill>`,
    `<problem>${prompt.problem.title}</problem>`,
    `<task>${prompt.task}</task>`,
    "<shown_to_candidate>",
    ...prompt.material.map((m) => `${m.heading}:\n${m.markdown}`),
    "</shown_to_candidate>",
    "<answer_key>",
    key,
    "</answer_key>",
    "<answer>",
    answer,
    "</answer>",
    "Grade the answer against the key. Return the verdict, the one fix, the candidate's line and what a pass sounds like.",
  ].join("\n");
}
