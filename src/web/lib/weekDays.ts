import type { DsaResponse } from "../../shared/dsa";
import { isAttempt, isOpenRound, localDay } from "../../shared/today";
import type { SessionHistoryItem } from "../../shared/types";
import { WEEKDAYS, planIndex, weekStart, type DayKind } from "../../shared/week";

export type DayState = "done" | "missed" | "today" | "planned" | "rest";

export interface WeekDay {
  index: number;
  name: (typeof WEEKDAYS)[number];
  /** Local calendar day, "YYYY-MM-DD". */
  day: string;
  kind: DayKind;
  state: DayState;
  isToday: boolean;
  /** Before today. A past DSA day that is not done is still unconfirmed, not missed. */
  past: boolean;
  /** The day's work is finished. Today keeps the state "today" and sets this when its round is done. */
  done: boolean;
}

export interface WeekSummary {
  days: WeekDay[];
  /** Days whose outcome is known: past or finished days of the plan, without rest days and without DSA days the data cannot confirm. */
  known: number;
  done: number;
}

const finished = (h: SessionHistoryItem) => isAttempt(h) && !isOpenRound(h) && h.status !== "failed";

/** The local day a round ended, falling back to its start for a summary saved before the end time existed. */
function endedDay(h: SessionHistoryItem): string | null {
  const at = new Date(h.endedAt ?? h.createdAt);
  return Number.isNaN(at.getTime()) ? null : localDay(at);
}

function isRedo(h: SessionHistoryItem, history: readonly SessionHistoryItem[]): boolean {
  return history.some((o) => isAttempt(o) && o.status === "debriefed" && o.problemId === h.problemId && o.id !== h.id && o.createdAt < h.createdAt);
}

/** The week's own medium count per day, the same one the weekly ring adds up, so no data means no answer. */
function solvedMedium(dsa: DsaResponse | null, index: number): boolean {
  if (!dsa || (dsa.status !== "ok" && dsa.status !== "stale")) return false;
  return (dsa.week.mediumsPerDay[index] ?? 0) > 0;
}

function dayDone(kind: DayKind, index: number, day: string, history: readonly SessionHistoryItem[], dsa: DsaResponse | null): boolean {
  if (kind === "rest") return false;
  if (kind === "dsa") return solvedMedium(dsa, index);
  const ended = history.filter((h) => finished(h) && endedDay(h) === day);
  if (kind === "redo") return ended.some((h) => isRedo(h, history));
  return ended.some((h) => h.track === kind);
}

/**
 * Each day of the current week with its state. A past day of a round kind that has no finished round is missed. A DSA
 * day is done only when the solves confirm it, and otherwise stays planned, because missing data is not a missed day.
 */
export function weekDays(plan: readonly DayKind[], history: readonly SessionHistoryItem[], dsa: DsaResponse | null, now: Date): WeekSummary {
  const today = planIndex(now);
  const start = weekStart(now);
  let known = 0;
  let doneCount = 0;
  const days = WEEKDAYS.map((name, index): WeekDay => {
    const kind = plan[index] ?? "rest";
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const day = localDay(date);
    const done = dayDone(kind, index, day, history, dsa);
    const isToday = index === today;
    const past = index < today;
    let state: DayState;
    if (isToday) state = "today";
    else if (kind === "rest") state = "rest";
    else if (done) state = "done";
    else if (past && kind !== "dsa") state = "missed";
    else state = "planned";
    const counted = kind !== "rest" && (past || (isToday && done)) && (kind !== "dsa" || done);
    if (counted) {
      known += 1;
      if (done) doneCount += 1;
    }
    return { index, name, day, kind, state, isToday, past, done };
  });
  return { days, known, done: doneCount };
}

/** Days from today to the next day of the plan that is not a rest day, counting on into next week. Null when the whole plan rests. */
export function daysUntilNextPlanned(plan: readonly DayKind[], now: Date): { days: number; kind: DayKind } | null {
  const today = planIndex(now);
  for (let step = 1; step <= 7; step += 1) {
    const kind = plan[(today + step) % 7] ?? "rest";
    if (kind !== "rest") return { days: step, kind };
  }
  return null;
}
