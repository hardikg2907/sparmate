import type { Problem } from "../../shared/problem";
import type { Scorecard, Session } from "../../shared/types";
import { formatStamp, roundTimeMs } from "./clock";
import { numberedCode, stepNotesText, transcriptLines } from "./envelope";
import { phasesFor } from "../../shared/phases";
import type { TesterOutput } from "./schemas";

export type JudgedCard = Omit<Scorecard, "quoteChecks" | "phaseTiming" | "lintIssues">;
export type QuoteCheck = NonNullable<Scorecard["quoteChecks"]>[number];
export type StepQuoteCheck = NonNullable<Scorecard["stepQuoteChecks"]>[number];

/** Round-time spans for each visited step, in order of first visit. */
export function stepWindows(session: Session, endMs?: number): string[] {
  const history = [...(session.phaseHistory ?? [])].sort((a, b) => a.at - b.at);
  if (history.length === 0) return ["none"];
  const measured = roundTimeMs(session, session.endedAt ? Date.parse(session.endedAt) : Date.now());
  const finalMs = endMs ?? (Number.isFinite(measured) ? measured : session.durationMs);
  const order: string[] = [];
  const spansByPhase = new Map<string, string[]>();
  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    if (!h) continue;
    const until = Math.max(h.at, Math.min(finalMs, history[i + 1]?.at ?? finalMs));
    const span = `${formatStamp(h.at)}–${formatStamp(until)}`;
    if (!spansByPhase.has(h.phase)) {
      order.push(h.phase);
      spansByPhase.set(h.phase, []);
    }
    spansByPhase.get(h.phase)!.push(span);
  }
  return order.map((phase) => `- ${phase}: ${spansByPhase.get(phase)!.join(", ")}`);
}

/** Planned against actual minutes per phase, from the phase history (the first phase runs from 0 by default). */
export function phaseTiming(
  session: Pick<Session, "phaseHistory">,
  plan: readonly { id: string; label: string; minutes: number }[],
  endMs: number,
): NonNullable<Scorecard["phaseTiming"]> {
  const spent = new Map<string, number>();
  const history = [...session.phaseHistory].sort((a, b) => a.at - b.at);
  const first = plan[0]?.id;
  const segments: { phase: string; at: number }[] = [];
  if (first && (history.length === 0 || (history[0]?.at ?? 0) > 0)) segments.push({ phase: first, at: 0 });
  segments.push(...history.map((h) => ({ phase: h.phase, at: h.at })));
  segments.forEach((seg, i) => {
    const until = Math.min(endMs, segments[i + 1]?.at ?? endMs);
    spent.set(seg.phase, (spent.get(seg.phase) ?? 0) + Math.max(0, until - seg.at));
  });
  return plan.map((p) => ({
    phase: p.id,
    label: p.label,
    plannedMinutes: p.minutes,
    actualMinutes: Math.round(((spent.get(p.id) ?? 0) / 60_000) * 10) / 10,
  }));
}

/** The candidate's own words: his chat messages and his written step answers. */
export function candidateText(session: Pick<Session, "transcript" | "stepNotes">): string {
  return session.transcript
    .filter((e) => e.channel === "interview" && e.role === "candidate")
    .map((e) => e.text)
    .concat(Object.values(session.stepNotes ?? {}))
    .join("\n");
}

export function candidateLines(session: Pick<Session, "transcript">): string[] {
  return session.transcript.filter((e) => e.channel === "interview" && e.role === "candidate").map((e) => e.text);
}

export function testerText(t: TesterOutput | null): string {
  if (!t) return "The scenario tester could not run. Judge working_code from the code and the candidate's own runs.";
  const lines = [`compiled: ${t.compiled ? "yes" : "no"}`];
  for (const s of t.scenarios) lines.push(`- ${s.pass ? "PASS" : "FAIL"} ${s.name}: ${s.detail}`);
  if (t.notes) lines.push(`notes: ${t.notes}`);
  return lines.join("\n");
}

export interface JudgeInput {
  session: Session;
  problem: Problem;
  timing: NonNullable<Scorecard["phaseTiming"]>;
  finalGraphText: string;
  finalCode: string | null;
  tester: TesterOutput | null;
  hasImage: boolean;
  /** Boxes and arrows the judge may pin, with their ids, or a line saying the board has none. */
  pinTargets?: string;
}

export function judgeMessage(input: JudgeInput, retryNote: string | null = null): string {
  const { session, problem } = input;
  const parts: string[] = [];
  parts.push(
    "<round>",
    `problem: ${problem.meta.title} (${session.track.toUpperCase()}, ${session.mode} mode, ${Math.round(session.durationMs / 60_000)} minutes)`,
    "</round>",
    "<transcript>",
    transcriptLines(session.transcript, "interview") || "(no messages)",
    "</transcript>",
    "<step_windows>",
    ...stepWindows(session),
    "</step_windows>",
    "<notes>",
    stepNotesText(phasesFor(session.track), session.stepNotes) || "(he wrote no step answers)",
    "</notes>",
    "<phase_timing>",
    ...input.timing.map((t) => `- ${t.label}: planned ${t.plannedMinutes} min, actual ${t.actualMinutes} min`),
    "</phase_timing>",
    "<hints>",
    session.hints.length === 0 ? "none" : session.hints.map((h) => `- [${formatStamp(h.at)}] H${h.level}: ${h.topic}`).join("\n"),
    "</hints>",
    "<extension>",
    session.extension ? `[${formatStamp(session.extension.at)}] ${session.extension.text}` : "none",
    "</extension>",
    "<board_final>",
    input.finalGraphText.trim() || "(the board is empty)",
    input.hasImage ? "(the final board is also attached as an image; trust this text for labels and connections)" : "(no image of the board was available)",
    "</board_final>",
  );
  if (session.track === "lld") {
    parts.push("<code_final>", input.finalCode ? numberedCode(input.finalCode) : "(no code)", "</code_final>");
    parts.push("<tester_results>", testerText(input.tester), "</tester_results>");
  }
  if (input.pinTargets) parts.push("<pin_targets>", input.pinTargets, "</pin_targets>");
  if (retryNote) parts.push("<note>", retryNote, "</note>");
  parts.push("Score this round against the rubric and the brief's level bar. Return the scorecard.");
  return parts.join("\n");
}

export function failedRatio(
  checks: readonly { verified: boolean }[],
  stepChecks: readonly { verified: boolean }[] = [],
): number {
  const total = checks.length + stepChecks.length;
  if (total === 0) return 0;
  const failed = checks.filter((c) => !c.verified).length + stepChecks.filter((c) => !c.verified).length;
  return failed / total;
}

export function failedQuoteNote(
  card: JudgedCard,
  checks: readonly QuoteCheck[],
  stepChecks: readonly StepQuoteCheck[] = [],
): string {
  const lines: string[] = [];
  for (const c of checks) {
    if (!c.verified) {
      const quote = card.dimensions.find((d) => d.id === c.dimensionId)?.evidence[c.index]?.quote ?? "";
      lines.push(`- "${quote}" (dimension ${c.dimensionId})`);
    }
  }
  for (const c of stepChecks) {
    if (!c.verified) {
      const quote = card.steps?.find((s) => s.phase === c.phase)?.took[c.index]?.evidence.quote ?? "";
      lines.push(`- "${quote}" (step ${c.phase})`);
    }
  }
  return [
    "These evidence quotes were not found word for word in the candidate's messages, the board text or the code:",
    ...lines,
    "Copy every quote exactly from its source, or leave it out.",
  ].join("\n");
}

/** Rules the engine owns regardless of what the judge wrote. */
export function enforceRules(card: JudgedCard, ctx: { mode: Session["mode"]; track: Session["track"]; tester: TesterOutput | null }): JudgedCard {
  const out: JudgedCard = { ...card };
  if (ctx.track === "lld") out.lldScenarios = ctx.tester ? ctx.tester.scenarios.map((s) => ({ ...s })) : out.lldScenarios;
  else out.lldScenarios = [];
  if (out.trackerMark === "[x]") {
    if (ctx.mode === "guided") {
      out.trackerMark = "[~]";
      out.trackerMarkReason = `${out.trackerMarkReason} Guided rounds earn at most [~].`.trim();
    } else if (ctx.track === "lld" && ctx.tester && !ctx.tester.compiled) {
      out.trackerMark = "[~]";
      out.trackerMarkReason = `${out.trackerMarkReason} The code did not compile, so the mark stays [~].`.trim();
    }
  }
  const validPhases = phasesFor(ctx.track);
  const phaseOrder = new Map(validPhases.map((p, i) => [p.id, i]));
  const seen = new Set<string>();
  // Only the first entry per step counts, matching the quote checks, which are keyed by step.
  out.steps = (card.steps ?? [])
    .filter((s) => phaseOrder.has(s.phase) && !seen.has(s.phase) && seen.add(s.phase))
    .sort((a, b) => (phaseOrder.get(a.phase) ?? 0) - (phaseOrder.get(b.phase) ?? 0));
  return out;
}

export function lintCard(card: JudgedCard, lint: (text: string) => string[]): NonNullable<Scorecard["lintIssues"]> {
  const issues: NonNullable<Scorecard["lintIssues"]> = [];
  const add = (field: string, text: string) => {
    for (const issue of lint(text)) issues.push({ field, issue });
  };
  add("verdict.summary", card.verdict.summary);
  card.strengths.forEach((s, i) => add(`strengths[${i}]`, s));
  card.gaps.forEach((g, i) => {
    add(`gaps[${i}].whyItMatters`, g.whyItMatters);
    add(`gaps[${i}].whatGoodLooksLike`, g.whatGoodLooksLike);
  });
  card.steps?.forEach((step, stepIndex) => {
    step.took.forEach((t, tookIndex) => {
      add(`steps[${stepIndex}].took[${tookIndex}].point`, t.point);
    });
    step.missing.forEach((m, missingIndex) => {
      add(`steps[${stepIndex}].missing[${missingIndex}]`, m);
    });
  });
  return issues;
}
