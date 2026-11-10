import type { Mode, Track } from "./phases";
import type { HistoryGap, ProblemSummary, SessionHistoryItem } from "./types";
import { planIndex, type DayKind } from "./week";

const MINUTE = 60_000;
const DAY = 86_400_000;

/** A round paused for less than this is still fresh, so it is the first thing offered. */
export const RECENT_PAUSE_MS = DAY;
/** A round with less clock than this has nothing worth a debrief. */
export const MIN_DEBRIEF_CLOCK_MS = 5 * MINUTE;
/** A redo is due this many days after the last attempt. */
export const REDO_AFTER_DAYS = 7;
/** Rounds in this window count when the Redo day chooses the track with less practice. */
const RECENT_ROUNDS_DAYS = 14;

/**
 * Nothing about the problem has been tried: no real attempt, and the tracker has not marked it partly done or done.
 * Today's "new problem" and the Library's Fresh group both use this one rule.
 */
export function isFresh(problem: Pick<ProblemSummary, "trackerMark" | "lastAttempt">): boolean {
  return problem.lastAttempt === null && (problem.trackerMark === "[ ]" || problem.trackerMark === null);
}

/** A gap round is practice on one gap, not an attempt, so nothing that counts attempts may include it. */
export function isAttempt(item: Pick<SessionHistoryItem, "focus">): boolean {
  return !item.focus;
}

export function isOpenRound(item: Pick<SessionHistoryItem, "status">): boolean {
  return item.status === "live" || item.status === "paused";
}

export function isFinishedAttempt(item: SessionHistoryItem): boolean {
  return isAttempt(item) && !isOpenRound(item) && item.status !== "failed";
}

/**
 * The local day a round ended, falling back to its start for a summary saved before the end time existed. Every count
 * that puts a round in a day or a week uses this one day, so two pages never place the same round differently.
 */
export function roundEndedDay(item: Pick<SessionHistoryItem, "endedAt" | "createdAt">): string | null {
  const at = new Date(item.endedAt ?? item.createdAt);
  return Number.isNaN(at.getTime()) ? null : localDay(at);
}

/** A round on a problem that an earlier round already took to a debrief. */
export function isRedoRound(item: SessionHistoryItem, history: readonly SessionHistoryItem[]): boolean {
  return history.some((o) => isAttempt(o) && o.status === "debriefed" && o.problemId === item.problemId && o.id !== item.id && o.createdAt < item.createdAt);
}

/** Clock time used so far, in milliseconds. Null for a round saved without its clock. */
export function clockUsedMs(item: SessionHistoryItem, nowMs: number): number | null {
  const clock = item.clock;
  if (!clock) return null;
  const started = Date.parse(clock.startedAt);
  const until = clock.pauseStartedAt ? Date.parse(clock.pauseStartedAt) : nowMs;
  if (Number.isNaN(started) || Number.isNaN(until)) return null;
  return Math.max(0, until - started - clock.pausedMs);
}

/** When the round was last active: the pause time, or the start for a round still marked live. */
function lastActiveMs(item: SessionHistoryItem): number {
  const at = Date.parse(item.pause?.pausedAt ?? item.clock?.startedAt ?? item.createdAt);
  return Number.isNaN(at) ? 0 : at;
}

/** Guided only when the last attempt was a guided round the readiness call said was not ready yet. */
export function modeFor(problem: Pick<ProblemSummary, "lastAttempt">): Mode {
  const last = problem.lastAttempt;
  return last?.mode === "guided" && last.readiness === "not_yet" ? "guided" : "interview";
}

export function localDay(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** The day a redo falls due: a week after the attempt, as a local date. */
export function redoDueOn(attemptDay: string): string {
  return addDays(attemptDay, REDO_AFTER_DAYS);
}

function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return localDay(new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
}

export interface RedoEntry {
  problem: ProblemSummary;
  /** Local date, YYYY-MM-DD. Null when the last attempt has no date. */
  dueOn: string | null;
  due: boolean;
}

/** Problems with a partly done mark, soonest due first. A problem with an open round waits until that round ends. */
export function redoQueue(problems: readonly ProblemSummary[], history: readonly SessionHistoryItem[]): RedoEntry[] {
  const open = new Set(history.filter(isOpenRound).map((item) => item.problemId));
  const entries = problems
    .filter((p) => p.trackerMark === "[~]" && !open.has(p.id))
    .map((problem): RedoEntry => {
      // The server sends the date its redo rule used. It covers a problem with only a tracker date and no app attempt.
      const date = problem.lastAttempt?.date ?? null;
      const dueOn = problem.redoDueOn ?? (date ? redoDueOn(date) : null);
      return { problem, dueOn, due: problem.badge === "redo" };
    });
  const key = (e: RedoEntry) => e.dueOn ?? "9999-12-31";
  return entries.sort((a, b) => Number(b.due) - Number(a.due) || key(a).localeCompare(key(b)) || a.problem.title.localeCompare(b.problem.title));
}

export interface UnfinishedRound {
  item: SessionHistoryItem;
  usedMs: number | null;
  /** False when the clock is under five minutes, so the page offers Discard in place of End and debrief. */
  canDebrief: boolean;
}

export type TodayHero =
  | { kind: "resume"; round: UnfinishedRound }
  | { kind: "problem"; problem: ProblemSummary; reason: "redo" | "new"; mode: Mode; dueOn: string | null }
  | { kind: "dsa"; gap: { item: SessionHistoryItem; gap: HistoryGap } | null }
  | { kind: "rest" }
  | { kind: "empty" };

export interface TodayPick {
  dayKind: DayKind;
  hero: TodayHero;
  /** Open rounds, newest first, without the one that is the hero. */
  unfinished: UnfinishedRound[];
  /** Redos still waiting after the hero, soonest due first. */
  moreRedos: RedoEntry[];
}

export interface TodayInput {
  now: Date;
  plan: readonly DayKind[];
  problems: readonly ProblemSummary[];
  history: readonly SessionHistoryItem[];
}

function unfinishedRound(item: SessionHistoryItem, nowMs: number): UnfinishedRound {
  const usedMs = clockUsedMs(item, nowMs);
  return { item, usedMs, canDebrief: usedMs === null || usedMs >= MIN_DEBRIEF_CLOCK_MS };
}

/** The newest gap the coach has not finished, from the newest scored round that has one. */
export function newestOpenGap(history: readonly SessionHistoryItem[]): { item: SessionHistoryItem; gap: HistoryGap } | null {
  const severity = { high: 0, medium: 1, low: 2 } as const;
  const rounds = [...history].filter((h) => isAttempt(h) && h.status === "debriefed" && h.gaps?.some((g) => !g.done)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const item = rounds[0];
  const gap = item?.gaps?.filter((g) => !g.done).sort((a, b) => severity[a.severity] - severity[b.severity])[0];
  return item && gap ? { item, gap } : null;
}

/**
 * Chooses what Today offers. Order: a round paused in the last day first; then by the day's kind. On a track day a
 * due redo of that track comes before an unfinished round of that track, and both come before a new problem.
 * A problem with an open round is never offered as a redo or as new, because its round is the way back to it.
 * The next new problem is the first fresh, non-custom problem in the list order the server gives, which follows
 * the tracker; the server's own recommendation wins when it is on the day's track.
 */
export function selectToday({ now, plan, problems, history }: TodayInput): TodayPick {
  const nowMs = now.getTime();
  const dayKind = plan[planIndex(now)] ?? "rest";
  const open = history.filter(isOpenRound).sort((a, b) => lastActiveMs(b) - lastActiveMs(a));
  const openProblems = new Set(open.map((item) => item.problemId));
  const queue = redoQueue(problems, history);
  const dueRedos = queue.filter((e) => e.due);

  const fresh = problems.filter((p) => isFresh(p) && !p.custom && !openProblems.has(p.id));
  const newFor = (track: Track): ProblemSummary | undefined => fresh.find((p) => p.track === track && p.badge === "next") ?? fresh.find((p) => p.track === track);

  const finish = (hero: TodayHero): TodayPick => {
    const heroRoundId = hero.kind === "resume" ? hero.round.item.id : null;
    const heroProblemId = hero.kind === "problem" ? hero.problem.id : null;
    return {
      dayKind,
      hero,
      unfinished: open.filter((item) => item.id !== heroRoundId).map((item) => unfinishedRound(item, nowMs)),
      moreRedos: queue.filter((e) => e.problem.id !== heroProblemId),
    };
  };
  const redoHero = (e: RedoEntry): TodayHero => ({ kind: "problem", problem: e.problem, reason: "redo", mode: modeFor(e.problem), dueOn: e.dueOn });
  const newHero = (problem: ProblemSummary): TodayHero => ({ kind: "problem", problem, reason: "new", mode: modeFor(problem), dueOn: null });

  const recent = open.find((item) => nowMs - lastActiveMs(item) < RECENT_PAUSE_MS);
  if (recent) return finish({ kind: "resume", round: unfinishedRound(recent, nowMs) });

  if (dayKind === "rest") return finish({ kind: "rest" });
  if (dayKind === "dsa") return finish({ kind: "dsa", gap: newestOpenGap(history) });

  if (dayKind === "redo") {
    const oldest = dueRedos[0];
    if (oldest) return finish(redoHero(oldest));
    const since = nowMs - RECENT_ROUNDS_DAYS * DAY;
    const rounds = (track: Track) => history.filter((h) => isAttempt(h) && h.track === track && Date.parse(h.createdAt) >= since).length;
    const first: Track = rounds("hld") <= rounds("lld") ? "hld" : "lld";
    const other: Track = first === "hld" ? "lld" : "hld";
    const pick = newFor(first) ?? newFor(other);
    return finish(pick ? newHero(pick) : { kind: "empty" });
  }

  const track: Track = dayKind;
  const redo = dueRedos.find((e) => e.problem.track === track);
  if (redo) return finish(redoHero(redo));
  const unfinished = open.find((item) => item.track === track);
  if (unfinished) return finish({ kind: "resume", round: unfinishedRound(unfinished, nowMs) });
  const next = newFor(track) ?? newFor(track === "hld" ? "lld" : "hld");
  if (next) return finish(newHero(next));
  const anyRedo = dueRedos[0];
  return finish(anyRedo ? redoHero(anyRedo) : { kind: "empty" });
}

export interface Overrun {
  phase: string;
  label: string;
  actualMinutes: number;
  plannedMinutes: number;
}

/**
 * The one step that ran clearly over its plan in a past round: at least 3 minutes and 1.5 times over, so a small
 * slip never earns a warning. `planned` gives today's plan per step id; the round's own plan is the fallback.
 */
export function largestOverrun(timing: SessionHistoryItem["phaseTiming"], planned?: ReadonlyMap<string, number>): Overrun | null {
  let worst: Overrun | null = null;
  let worstBy = 0;
  for (const row of timing ?? []) {
    const plan = planned?.get(row.phase) ?? row.plannedMinutes;
    const over = row.actualMinutes - row.plannedMinutes;
    if (over < 3 || row.actualMinutes < row.plannedMinutes * 1.5 || over <= worstBy) continue;
    worst = { phase: row.phase, label: row.label, actualMinutes: row.actualMinutes, plannedMinutes: plan };
    worstBy = over;
  }
  return worst;
}
