import { z } from "zod";
import type { Session, StepVerdict } from "../../shared/types";

export const MAX_GAP_CHARS = 200;

/** The tool's argument shape. The gap rules depend on the verdict, so `parseStepVerdict` checks them. */
export const StepVerdictShape = {
  phase: z.string().min(1).max(40),
  verdict: z.enum(["pass", "not_yet"]),
  gap: z.string().max(2_000).optional(),
};

const StepVerdictInputSchema = z.strictObject(StepVerdictShape);

export type StepVerdictInput = { phase: string; verdict: "pass" | "not_yet"; gap?: string };

// Model output is untrusted: control characters never reach the page, and the page renders the gap as text only.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]+/g;

/** Strict check of the tool's arguments against the round's step ids. The gap is trimmed, plain text, 1 to 200 characters. */
export function parseStepVerdict(args: unknown, phaseIds: readonly string[]): { ok: true; value: StepVerdictInput } | { ok: false; error: string } {
  const parsed = StepVerdictInputSchema.safeParse(args);
  if (!parsed.success) return { ok: false, error: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}` };
  const { phase, verdict, gap } = parsed.data;
  if (!phaseIds.includes(phase)) return { ok: false, error: `Unknown step. Use one of: ${phaseIds.join(", ")}.` };
  if (verdict === "pass") return { ok: true, value: { phase, verdict } };
  const text = (gap ?? "").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  if (text.length === 0) return { ok: false, error: "A not_yet verdict needs a gap: the one thing the step still lacks, in one sentence." };
  if (text.length > MAX_GAP_CHARS) return { ok: false, error: `The gap is too long. Use at most ${MAX_GAP_CHARS} characters.` };
  return { ok: true, value: { phase, verdict, gap: text } };
}

/**
 * Stores the guide's call on a step. A pass is final, so a later "not_yet" for that step is refused with a message
 * the guide can act on; a pass may replace a "not_yet".
 */
export function recordStepVerdict(session: Pick<Session, "stepVerdicts">, input: StepVerdictInput, at: number): { ok: true } | { ok: false; error: string } {
  const held = session.stepVerdicts?.[input.phase];
  if (held?.verdict === "pass" && input.verdict === "not_yet") {
    return { ok: false, error: "That step already passed. Do not raise it again, in this reply or any later one. Small items go to the debrief." };
  }
  const entry: StepVerdict = input.verdict === "pass" ? { verdict: "pass", at } : { verdict: "not_yet", gap: input.gap ?? "", at };
  session.stepVerdicts = { ...session.stepVerdicts, [input.phase]: entry };
  return { ok: true };
}
