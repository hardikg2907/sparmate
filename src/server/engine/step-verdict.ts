import { z } from "zod";
import type { PhaseDef } from "../../shared/phases";
import type { ChecklistItem, Session, StepCheck, StepVerdict } from "../../shared/types";

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

/** The fewest covered checklist items a guided pass needs on this step. */
export function passNeed(phase: Pick<PhaseDef, "passNeeds">, total: number): number {
  if (total === 0) return 0;
  if (phase.passNeeds === "one") return 1;
  if (phase.passNeeds === "all") return total;
  return Math.max(1, Math.ceil(total / 2));
}

export type PassCheck = { ok: true } | { ok: false; covered: number; total: number; need: number; open: string[] };

/**
 * Whether the checker's reading supports a pass, so "Passed" in the room means what the debrief's step card shows.
 * A step with no checklist, or with no finished reading (the checker failed or never ran), is left to the guide:
 * a broken checker must not lock a step.
 */
export function passCheck(phase: Pick<PhaseDef, "passNeeds">, items: readonly ChecklistItem[], check: StepCheck | undefined): PassCheck {
  if (items.length === 0 || check?.checkedAt == null) return { ok: true };
  const covered = items.filter((i) => check.items[i.id]?.state === "covered").length;
  const need = passNeed(phase, items.length);
  if (covered >= need) return { ok: true };
  const open = items.filter((i) => check.items[i.id]?.state !== "covered").map((i) => i.label);
  return { ok: false, covered, total: items.length, need, open };
}

/** The refusal the guide gets for an unsupported pass. It lists the open items so the guide can pick the one to name. */
export function passRefusalText(label: string, refused: Extract<PassCheck, { ok: false }>): string {
  return [
    `${label} cannot pass yet. The latest reading of his work covers ${refused.covered} of ${refused.total} checklist items, and a pass needs at least ${refused.need}.`,
    `Items not covered yet: ${refused.open.join("; ")}.`,
    `Call step_verdict with "not_yet" and name the most important one as a missing question or a missing decision. Do not list the others, and do not mention this reading to him.`,
    `If he covered more than this reading shows, call recheck_step for this step once, then decide.`,
  ].join("\n");
}

/** The refusal for a pass on a step that holds nothing of his yet. */
export function emptyStepRefusalText(label: string): string {
  return `${label} cannot pass: he has said nothing in this step, drawn nothing in its frame and written no answer for it. Call step_verdict with "not_yet" and ask for his answer to this step. If he gave it while another step was on the rail, ask him to say it again here or to add it to this step's written answer.`;
}

/** Which steps have a pass and which do not, in rail order, so the guide never has to recall it. */
export function stepStatusLine(phases: readonly { id: string; label: string }[], verdicts: Session["stepVerdicts"]): string {
  const passed = phases.filter((p) => verdicts?.[p.id]?.verdict === "pass").map((p) => p.label);
  const open = phases.filter((p) => verdicts?.[p.id]?.verdict !== "pass").map((p) => p.label);
  if (open.length === 0) return "every step has passed";
  return `passed: ${passed.length > 0 ? passed.join(", ") : "none yet"} · not passed yet: ${open.join(", ")}`;
}
