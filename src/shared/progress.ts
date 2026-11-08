import type { Mode } from "./phases";
import { isAttempt, isOpenRound } from "./today";
import type { HistoryGap, HistoryScore, SessionHistoryItem } from "./types";
import { DEFAULT_WEEKLY_PLAN, weekStart, type DayKind } from "./week";

/** A score of 3 is "at bar" on the judge's 1-4 scale. */
export const BAR_SCORE = 3;
/** The focus skill reads this many of the newest scored rounds, so one odd round does not decide it. */
export const FOCUS_ROUNDS = 3;
/** Each skill row draws at most this many rounds as dots. */
export const SKILL_DOTS = 6;

const scored = (history: readonly SessionHistoryItem[], mode: Mode) =>
  history.filter((h) => isAttempt(h) && h.mode === mode && h.status === "debriefed" && (h.scores?.length ?? 0) > 0).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

/** Interview rounds when there are any, since they show unaided work. Guided rounds otherwise. */
export function scoredRounds(history: readonly SessionHistoryItem[]): { mode: Mode; rounds: SessionHistoryItem[] } {
  const interview = scored(history, "interview");
  if (interview.length > 0) return { mode: "interview", rounds: interview };
  return { mode: "guided", rounds: scored(history, "guided") };
}

export interface FocusSkill {
  id: string;
  name: string;
  /** Average over the rounds counted, to one decimal. */
  score: number;
  roundsCounted: number;
  mode: Mode;
  /** The newest counted round that has step timing. The chart and the figure both come from it. */
  timing: NonNullable<SessionHistoryItem["phaseTiming"]> | null;
  /** That round, so the page can name where the numbers come from. */
  timingRound: { title: string; createdAt: string } | null;
}

/** The lowest skill over the newest scored rounds. Ties go to the skill listed first on the newest scorecard. */
export function focusSkill(history: readonly SessionHistoryItem[]): FocusSkill | null {
  const { mode, rounds } = scoredRounds(history);
  const counted = rounds.slice(0, FOCUS_ROUNDS);
  const newest = counted[0];
  if (!newest?.scores) return null;
  let best: { score: HistoryScore; average: number } | null = null;
  for (const score of newest.scores) {
    const values = counted.flatMap((r) => r.scores?.filter((s) => s.id === score.id).map((s) => s.score) ?? []);
    const average = values.reduce((a, b) => a + b, 0) / values.length;
    if (!best || average < best.average) best = { score, average };
  }
  if (!best) return null;
  const withTiming = counted.find((r) => (r.phaseTiming?.length ?? 0) > 0);
  const timing = withTiming?.phaseTiming ?? null;
  return {
    id: best.score.id,
    name: best.score.name,
    score: Math.round(best.average * 10) / 10,
    roundsCounted: counted.filter((r) => r.scores?.some((s) => s.id === best.score.id)).length,
    mode,
    timing,
    timingRound: withTiming && timing ? { title: withTiming.title, createdAt: withTiming.createdAt } : null,
  };
}

type Timing = NonNullable<SessionHistoryItem["phaseTiming"]>;

const round1 = (n: number) => Math.round(n * 10) / 10;

export interface FocusFigure {
  value: string;
  unit: string;
  caption: string;
  /** A second line, such as how many steps were never reached. */
  note: string | null;
  /** The whole figure as one sentence, for a screen reader. */
  text: string;
}

/**
 * The one number under the focus skill, chosen from what the round's step timing shows. A step with no time was never
 * reached. The value and its words come from the same case, so they can never disagree, and a round with no timing
 * has no figure at all.
 */
export function focusFigure(timing: Timing | null | undefined): FocusFigure | null {
  if (!timing || timing.length === 0) return null;
  const ran = timing.filter((row) => row.actualMinutes > 0);
  if (ran.length === 0) return null;
  const used = round1(timing.reduce((sum, row) => sum + row.actualMinutes, 0));
  const planned = round1(timing.reduce((sum, row) => sum + row.plannedMinutes, 0));
  const plannedRan = round1(ran.reduce((sum, row) => sum + row.plannedMinutes, 0));
  const never = timing.length - ran.length;
  if (never > 0 && used < planned) {
    const note = `${never} ${never === 1 ? "step" : "steps"} never reached`;
    return { value: String(used), unit: `of ${planned} min`, caption: "Where the round ended", note, text: `Ended at ${used} of ${planned} min. ${note}` };
  }
  if (used > plannedRan) {
    const scope = ran.length === timing.length ? `all ${ran.length} steps` : `the first ${ran.length} ${ran.length === 1 ? "step" : "steps"}`;
    return { value: String(used), unit: "min", caption: `on ${scope}, plan ${plannedRan}`, note: null, text: `${used} min on ${scope}, plan ${plannedRan}` };
  }
  return { value: String(used), unit: "min", caption: `used, plan ${planned}`, note: null, text: `${used} min used, plan ${planned}` };
}

export interface StepRow {
  phase: string;
  label: string;
  planned: number;
  used: number;
  reached: boolean;
  /** Minutes past the plan, 0 when on plan or not reached. */
  over: number;
}

/** One row per step for the chart. A step is over plan only when it is a clear overrun, as on Today. */
export function stepRows(timing: Timing): StepRow[] {
  return timing.map((row) => {
    const reached = row.actualMinutes > 0;
    const over = reached && row.actualMinutes - row.plannedMinutes >= 1 && row.actualMinutes > row.plannedMinutes * 1.2 ? round1(row.actualMinutes - row.plannedMinutes) : 0;
    return { phase: row.phase, label: row.label, planned: row.plannedMinutes, used: row.actualMinutes, reached, over };
  });
}

/** The newest open gap whose text names the skill. The scorecard does not link gaps to skills, so the words decide. */
export function gapForSkill(history: readonly SessionHistoryItem[], skill: { id: string; name: string }): { item: SessionHistoryItem; gap: HistoryGap } | null {
  const needles = [skill.name, skill.id.replace(/[_-]+/g, " ")].map((n) => n.trim().toLowerCase()).filter((n) => n.length >= 3);
  const rounds = [...history].filter((h) => isAttempt(h) && h.status === "debriefed").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const item of rounds) {
    const gap = item.gaps?.find((g) => !g.done && needles.some((n) => `${g.title} ${g.goodLooksLike}`.toLowerCase().includes(n)));
    if (gap) return { item, gap };
  }
  return null;
}

export interface SkillRow {
  id: string;
  name: string;
  /** Oldest first, so the last entry is the newest round. */
  scores: number[];
  latest: number;
}

/** One row per skill for one mode. The two modes are never mixed, because guided rounds have help built in. */
export function skillRows(history: readonly SessionHistoryItem[], mode: Mode): { rows: SkillRow[]; rounds: number } {
  const rounds = scored(history, mode);
  const order: { id: string; name: string }[] = [];
  for (const round of rounds) for (const s of round.scores ?? []) if (!order.some((o) => o.id === s.id)) order.push({ id: s.id, name: s.name });
  const rows = order.map(({ id, name }): SkillRow => {
    const scores = rounds
      .slice(0, SKILL_DOTS)
      .flatMap((r) => r.scores?.filter((s) => s.id === id).map((s) => s.score) ?? [])
      .reverse();
    return { id, name, scores, latest: scores[scores.length - 1] ?? 0 };
  });
  return { rows: rows.filter((r) => r.scores.length > 0), rounds: rounds.length };
}

export interface WeekStats {
  rounds: { done: number; planned: number };
  redos: { done: number; planned: number };
}

/**
 * Rounds finished this week against the plan. A finished round on a problem that was tried before counts as a
 * redo, and a first try counts as a round. Paused and live rounds are not finished.
 */
export function weekStats(history: readonly SessionHistoryItem[], plan: readonly DayKind[] = DEFAULT_WEEKLY_PLAN, now: Date = new Date()): WeekStats {
  const start = weekStart(now).getTime();
  const end = start + 7 * 86_400_000;
  const finished = (h: SessionHistoryItem) => isAttempt(h) && !isOpenRound(h) && h.status !== "failed";
  const mine = history.filter((h) => finished(h) && Date.parse(h.createdAt) >= start && Date.parse(h.createdAt) < end);
  // Only an earlier round that was debriefed makes this one a redo. An open or failed earlier round was never finished.
  const isRedo = (h: SessionHistoryItem) =>
    history.some((o) => isAttempt(o) && o.status === "debriefed" && o.problemId === h.problemId && o.id !== h.id && o.createdAt < h.createdAt);
  const redos = mine.filter(isRedo).length;
  return {
    rounds: { done: mine.length - redos, planned: plan.filter((d) => d === "hld" || d === "lld").length },
    redos: { done: redos, planned: plan.filter((d) => d === "redo").length },
  };
}
