import type { Problem } from "../../shared/problem";
import { MAX_GAPS, type Scorecard, type Session } from "../../shared/types";
import { formatStamp, roundTimeMs } from "./clock";
import { numberedCode, stepEntries, stepNotesText, transcriptLines } from "./envelope";
import { codeScopeFor, stepCodeText, unnumberedCode } from "../../shared/stepCode";
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

/**
 * What each step's own quotes may come from: the candidate chat of that step's visits and its written answer, the
 * step's frame text when `stepBoard` has one (else the whole board), and the code that step reads.
 */
export function stepSources(
  session: Session,
  finalCode: string | null,
  opts: { endMs?: number; stepBoard?: Readonly<Record<string, string>> } = {},
): Record<string, { candidate: string; board: string; code: string }> {
  const measured = roundTimeMs(session, session.endedAt ? Date.parse(session.endedAt) : Date.now());
  const endMs = opts.endMs ?? (Number.isFinite(measured) ? measured : session.durationMs);
  const out: Record<string, { candidate: string; board: string; code: string }> = {};
  for (const p of phasesFor(session.track)) {
    const chat = stepEntries(session.transcript, session.phaseHistory ?? [], p.id, endMs)
      .filter((e) => e.role === "candidate")
      .map((e) => e.text);
    const scope = codeScopeFor(session.track, p.id);
    const code = finalCode === null || scope === null ? "" : scope === "file" ? finalCode : unnumberedCode(stepCodeText(finalCode, session.stepCode?.[p.id] ?? []));
    out[p.id] = {
      candidate: chat.concat(session.stepNotes?.[p.id] ?? []).join("\n"),
      board: opts.stepBoard?.[p.id] ?? session.board.graphText,
      code,
    };
  }
  return out;
}

export function candidateLines(session: Pick<Session, "transcript">): string[] {
  return session.transcript.filter((e) => e.channel === "interview" && e.role === "candidate").map((e) => e.text);
}

/** Longest root-cause label the page shows; the tester is asked for a few words. */
export const MAX_CAUSE_CHARS = 160;

/** What a failed scenario's cause is when the file did not compile, so the page can say one cause failed them all. */
export const NOT_COMPILED_CAUSE = "Did not compile";

/**
 * A cause belongs to a failed scenario only. It is cut to one short line, and a cause with no word in it is dropped,
 * so the page never shows an empty label. A file that did not compile fails every scenario for that one cause.
 */
export function tidyTesterOutput(t: TesterOutput): TesterOutput {
  if (!t.compiled) return { ...t, scenarios: t.scenarios.map(({ cause: _cause, ...s }) => ({ ...s, pass: false, cause: NOT_COMPILED_CAUSE })) };
  return {
    ...t,
    scenarios: t.scenarios.map(({ cause, ...s }) => {
      if (s.pass) return s;
      const label = (cause ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_CAUSE_CHARS);
      return /[\p{L}\p{N}]/u.test(label) ? { ...s, cause: label } : s;
    }),
  };
}

export function testerText(t: TesterOutput | null): string {
  if (!t) return "The scenario tester could not run. Judge working_code from the code and the candidate's own runs.";
  const lines = [`compiled: ${t.compiled ? "yes" : "no"}`];
  for (const s of t.scenarios) lines.push(`- ${s.pass ? "PASS" : "FAIL"} ${s.name}: ${s.detail}${s.cause ? ` (cause: ${s.cause})` : ""}`);
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

export function failedRatio(checks: readonly { verified: boolean }[], stepChecks: readonly { verified: boolean }[] = []): number {
  const total = checks.length + stepChecks.length;
  if (total === 0) return 0;
  const failed = checks.filter((c) => !c.verified).length + stepChecks.filter((c) => !c.verified).length;
  return failed / total;
}

export function failedQuoteNote(card: JudgedCard, checks: readonly QuoteCheck[], stepChecks: readonly StepQuoteCheck[] = []): string {
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

const HLD_DIMENSIONS = ["navigation", "design", "depth", "scale_reliability", "communication", "drive_time"];
const LLD_DIMENSIONS = ["requirements", "working_code", "design", "extensibility", "edge_cases", "concurrency", "code_quality", "communication_time"];
type Verdict = JudgedCard["verdict"]["sde2"];

/** The rubric's verdict table, or null when a dimension it needs was not scored. Concurrency may be left out of an LLD card. */
function verdictsFor(track: Session["track"], dimensions: JudgedCard["dimensions"]): { sde2: Verdict; senior: Verdict } | null {
  const known = track === "lld" ? LLD_DIMENSIONS : HLD_DIMENSIONS;
  const score = new Map<string, number>();
  for (const d of dimensions) if (known.includes(d.id) && !score.has(d.id)) score.set(d.id, d.score);
  if (known.some((id) => id !== "concurrency" && !score.has(id))) return null;
  const all = [...score.values()];
  const count = (min: number) => all.filter((v) => v >= min).length;
  const fours = (...ids: string[]) => ids.every((id) => score.get(id) === 4);
  const ones = all.filter((v) => v === 1).length;
  const allThree = all.every((v) => v >= 3);
  const at = (id: string) => score.get(id) ?? 0;
  const four = all.filter((v) => v === 4).length;
  if (track === "lld") {
    const core = at("working_code") >= 3 && at("design") >= 3 && at("extensibility") >= 3;
    const sde2: Verdict =
      allThree && four >= 2
        ? "strong_hire"
        : ones === 0 && core && count(3) >= 5
          ? "hire"
          : at("working_code") === 1 || at("design") === 1 || at("extensibility") === 1 || ones >= 2
            ? "no_hire"
            : "lean_no_hire";
    const senior: Verdict =
      allThree && four >= 5 && fours("working_code", "design", "extensibility")
        ? "strong_hire"
        : allThree && four >= 3 && fours("design", "extensibility")
          ? "hire"
          : !allThree
            ? "no_hire"
            : "lean_no_hire";
    return { sde2, senior };
  }
  const sde2: Verdict =
    allThree && four >= 2
      ? "strong_hire"
      : ones === 0 && at("navigation") >= 3 && at("design") >= 3 && count(3) >= 4
        ? "hire"
        : at("navigation") === 1 || at("design") === 1 || ones >= 2 || count(3) < 3
          ? "no_hire"
          : "lean_no_hire";
  const senior: Verdict = allThree && four >= 5 ? "strong_hire" : allThree && four >= 3 && fours("depth", "scale_reliability") ? "hire" : !allThree ? "no_hire" : "lean_no_hire";
  return { sde2, senior };
}

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const;

/**
 * The judge's gaps cut to the cap by dropping the least severe. The kept gaps stay in the judge's order, because its
 * practice task aims at the gap it put first.
 */
export function mostSevereGaps<G extends { severity: keyof typeof SEVERITY_RANK }>(gaps: readonly G[]): G[] {
  if (gaps.length <= MAX_GAPS) return [...gaps];
  const keep = new Set(
    gaps
      .map((g, i) => ({ g, i }))
      .sort((a, b) => SEVERITY_RANK[a.g.severity] - SEVERITY_RANK[b.g.severity] || a.i - b.i)
      .slice(0, MAX_GAPS)
      .map((x) => x.i),
  );
  return gaps.filter((_, i) => keep.has(i));
}

/**
 * Rules the engine owns regardless of what the judge wrote. Hint caps are not applied: a hint carries free text and
 * no dimension, so which score it caps is a judgement the judge makes.
 */
export function enforceRules(card: JudgedCard, ctx: { mode: Session["mode"]; track: Session["track"]; tester: TesterOutput | null }): JudgedCard {
  const out: JudgedCard = { ...card };
  // Scenario results come from the tester alone; without one, a judge's own list would be unchecked model text.
  if (ctx.track === "lld") out.lldScenarios = ctx.tester ? ctx.tester.scenarios.map((s) => ({ ...s })) : [];
  else out.lldScenarios = [];

  // A step tag is model output: one that names no step of this track is dropped rather than trusted.
  const stepIds = new Set(phasesFor(ctx.track).map((p) => p.id));
  out.gaps = card.gaps.map(({ step, ...gap }) => (step !== undefined && stepIds.has(step) ? { ...gap, step } : gap));

  const verdicts = verdictsFor(ctx.track, card.dimensions);
  const confidence = ctx.mode === "guided" && card.verdict.confidence === "high" ? "medium" : card.verdict.confidence;
  out.verdict = { ...card.verdict, ...(verdicts ?? {}), confidence };

  if (out.trackerMark === "[x]") {
    const reasons: string[] = [];
    if (ctx.mode === "guided") reasons.push("A guided round is marked partly done at most.");
    if (ctx.track === "lld") {
      if (!ctx.tester) reasons.push("The scenario tester did not run, so the mark stays partly done.");
      else if (!ctx.tester.compiled) reasons.push("The code did not compile, so the mark stays partly done.");
      else if (ctx.tester.scenarios.length === 0) reasons.push("No scenario ran, so the mark stays partly done.");
      else if (ctx.tester.scenarios.some((s) => !s.pass)) reasons.push("A scenario failed, so the mark stays partly done.");
    }
    if (card.dimensions.some((d) => d.score < 3)) reasons.push("A dimension scored below 3, so the mark stays partly done.");
    if (card.gaps.some((g) => g.severity !== "low")) reasons.push("A high or medium gap remains, so the mark stays partly done.");
    if (reasons.length > 0) {
      out.trackerMark = "[~]";
      out.trackerMarkReason = [out.trackerMarkReason, ...reasons].join(" ").trim();
    }
  }
  out.gaps = mostSevereGaps(out.gaps);
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
