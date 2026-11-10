import { DRILL_INFO, DRILL_TYPES, addDays, drillSkill, localDay, type DrillAttempt, type DrillOutcome, type DrillPoint, type DrillType } from "./drills";
import type { Mode, Track } from "./phases";
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

/** Each skill row draws at most this many drill marks. */
export const SKILL_DRILL_MARKS = 8;
/** Drills of the last this many days (today included) count toward a level and the kind rows. */
export const DRILL_WINDOW_DAYS = 30;
/** One drill weighs a quarter of a round in a level. */
export const DRILL_WEIGHT = 0.25;
/** The server sends the drill points of the last this many days, and no more than `MAX_DRILL_POINTS`. */
export const DRILL_POINT_DAYS = 90;
export const MAX_DRILL_POINTS = 500;
/** The outcomes a kind row draws as pips. */
export const KIND_PIPS = 8;

/**
 * The finished, non-legacy attempts that have scores, as points oldest first. A kind that serves both tracks takes the
 * track of the attempt's problem through `trackOf`; an attempt whose track is unknown is left out.
 */
export function drillPoints(
  attempts: readonly Pick<DrillAttempt, "day" | "drill" | "problemId" | "status" | "legacy" | "scores" | "outcome" | "revised">[],
  today: string,
  trackOf: (problemId: string) => Track | null,
): DrillPoint[] {
  const since = addDays(today, -(DRILL_POINT_DAYS - 1));
  const points: DrillPoint[] = [];
  for (const a of attempts) {
    if (a.status !== "done" || a.legacy || a.outcome === null || a.scores.length === 0 || a.day < since) continue;
    const tracks = DRILL_INFO[a.drill].tracks;
    const track = tracks.length === 1 ? tracks[0] : trackOf(a.problemId);
    if (!track) continue;
    const score = a.scores.reduce((sum, s) => sum + s.score, 0) / a.scores.length;
    points.push({ day: a.day, kind: a.drill, skill: drillSkill(a.drill, track), score, outcome: a.outcome, firstTry: !a.revised && a.outcome === "ready" });
  }
  return points.sort((x, y) => x.day.localeCompare(y.day)).slice(-MAX_DRILL_POINTS);
}

const byDay = (points: readonly DrillPoint[]) => [...points].sort((a, b) => a.day.localeCompare(b.day));

/**
 * The weighted mean of the round scores and the drill scores of one skill. Each round weighs 1 and each drill a
 * quarter, but all drills together weigh at most one round, so a burst of drills never outvotes the rounds.
 */
export function skillLevel(roundScores: readonly number[], drillScores: readonly number[]): number {
  const weight = drillScores.length * DRILL_WEIGHT > 1 ? 1 / drillScores.length : DRILL_WEIGHT;
  const total = roundScores.reduce((a, b) => a + b, 0) + drillScores.reduce((a, b) => a + b, 0) * weight;
  return round1(total / (roundScores.length + drillScores.length * weight));
}

export interface SkillDrill {
  day: string;
  score: number;
  kind: DrillType;
  outcome: DrillOutcome;
}

export interface SkillRow {
  id: string;
  name: string;
  /** Oldest first, so the last entry is the newest round. */
  scores: number[];
  latest: number;
  /** Rounds and drills together, to one decimal; see `skillLevel`. */
  level: number;
  /** The newest drills for this skill, oldest first. Empty on the rows of the mode that drills do not join. */
  drills: SkillDrill[];
}

/**
 * One row per skill for one mode. The two modes are never mixed, because guided rounds have help built in. Drills join
 * only the mode that `scoredRounds` picks, since they are done without help; the other mode stays rounds only.
 */
export function skillRows(history: readonly SessionHistoryItem[], mode: Mode, points: readonly DrillPoint[], now: Date): { rows: SkillRow[]; rounds: number } {
  const rounds = scored(history, mode);
  const withDrills = scoredRounds(history).mode === mode;
  const since = addDays(localDay(now), -(DRILL_WINDOW_DAYS - 1));
  const order: { id: string; name: string }[] = [];
  for (const round of rounds) for (const s of round.scores ?? []) if (!order.some((o) => o.id === s.id)) order.push({ id: s.id, name: s.name });
  const rows = order.map(({ id, name }): SkillRow => {
    const scores = rounds
      .slice(0, SKILL_DOTS)
      .flatMap((r) => r.scores?.filter((s) => s.id === id).map((s) => s.score) ?? [])
      .reverse();
    const mine = withDrills ? byDay(points).filter((p) => p.skill === id) : [];
    const levelRounds = rounds.flatMap((r) => r.scores?.filter((s) => s.id === id).map((s) => s.score) ?? []).slice(0, FOCUS_ROUNDS);
    const recent = mine.filter((p) => p.day >= since).map((p) => p.score);
    return {
      id,
      name,
      scores,
      latest: scores[scores.length - 1] ?? 0,
      level: levelRounds.length > 0 ? skillLevel(levelRounds, recent) : 0,
      drills: mine.slice(-SKILL_DRILL_MARKS).map(({ day, score, kind, outcome }) => ({ day, score, kind, outcome })),
    };
  });
  return { rows: rows.filter((r) => r.scores.length > 0), rounds: rounds.length };
}

export interface DrillKindRow {
  kind: DrillType;
  /** The newest outcomes, oldest first. */
  outcomes: DrillOutcome[];
  /** Attempts in the last `DRILL_WINDOW_DAYS` days. */
  recent: number;
  /** Interview-ready with no revision, as a share of `recent`; null with no recent attempt. */
  share: number | null;
}

/** One row per drill kind that has a point, in the order of the kinds. */
export function drillKindRows(points: readonly DrillPoint[], today: string): DrillKindRow[] {
  const since = addDays(today, -(DRILL_WINDOW_DAYS - 1));
  return DRILL_TYPES.flatMap((kind): DrillKindRow[] => {
    const mine = byDay(points).filter((p) => p.kind === kind);
    if (mine.length === 0) return [];
    const recent = mine.filter((p) => p.day >= since);
    return [
      {
        kind,
        outcomes: mine.slice(-KIND_PIPS).map((p) => p.outcome),
        recent: recent.length,
        share: recent.length > 0 ? recent.filter((p) => p.firstTry).length / recent.length : null,
      },
    ];
  });
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
