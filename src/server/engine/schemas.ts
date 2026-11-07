import { z } from "zod";

export const TesterOutputSchema = z.strictObject({
  compiled: z.boolean().describe("Whether the candidate's own file compiled together with the harness."),
  scenarios: z
    .array(
      z.strictObject({
        name: z.string().describe("The demo scenario, short, in the brief's order."),
        pass: z.boolean(),
        detail: z.string().describe("What happened, or why the candidate's API could not express the scenario."),
      }),
    )
    .max(40),
  notes: z.string().describe("Anything the judge should know about how the scenarios were run."),
});
export type TesterOutput = z.infer<typeof TesterOutputSchema>;

import { ProblemSourceSchema } from "../../shared/problem";

/** The model writes only the human parts; the server fills in ids, paths and the track itself. */
export const BriefWriterOutputSchema = z.strictObject({
  meta: z.strictObject({
    title: z.string().min(2).max(120),
    difficulty: z.enum(["easy", "medium", "hard"]),
    tags: z.array(z.string().max(40)).max(12),
  }),
  body: z.string().min(200).max(60_000).describe("The problem file body: every required section as a '## ' heading, in order."),
  sources: z.array(ProblemSourceSchema).max(20).describe("Pages actually relied upon during research."),
  confidence: z.string().max(1000).describe("Short confidence note naming any claim that could not be confirmed."),
});
export type BriefWriterOutput = z.infer<typeof BriefWriterOutputSchema>;

export const BriefCorrectionSchema = z.strictObject({
  section: z.string().min(1).max(100).describe("The brief section heading, without ##."),
  claim: z.string().min(1).max(500).describe("The wrong or doubtful claim."),
  fix: z.string().min(1).max(1000).describe("The corrected fact or number."),
  source: z.string().min(1).max(500).describe("Source URL or title backing the correction."),
});
export type BriefCorrection = z.infer<typeof BriefCorrectionSchema>;

export const BriefCheckerOutputSchema = z.strictObject({
  body: z.string().min(200).max(60_000).describe("The full corrected problem file body, with all required sections."),
  corrections: z.array(BriefCorrectionSchema).max(50).describe("List of corrections applied."),
  unconfirmed: z.array(z.string().min(1).max(500)).max(20).optional().describe("Any remaining doubtful claims."),
});
export type BriefCheckerOutput = z.infer<typeof BriefCheckerOutputSchema>;

/**
 * JSON Schema for the SDK's structured output. The Claude Code CLI validates the schema itself and rejects the
 * draft 2020-12 "$schema" URI that zod adds, so that key goes. Every other keyword zod emits was accepted.
 */
export function toApiSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

const DROPPED_KEYWORDS = new Set(["minLength", "maxLength", "pattern", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "maxItems", "format"]);

/**
 * A more conservative form, used only when the strict form is refused: oneOf becomes anyOf, const becomes a
 * one-value enum, and length and range limits go. The zod parse in code still enforces every dropped limit.
 */
export function toCompatSchema(schema: z.ZodType): Record<string, unknown> {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (DROPPED_KEYWORDS.has(key)) continue;
      if (key === "oneOf") out.anyOf = walk(value);
      else if (key === "const") out.enum = [value];
      else out[key] = walk(value);
    }
    return out;
  };
  return walk(toApiSchema(schema)) as Record<string, unknown>;
}
