import type { ProblemSummary, SessionHistoryItem } from "../../shared/types";
import { isFresh, isOpenRound } from "../../shared/today";
import { dayMonth } from "./dates";
import { redoDueText } from "./redoDue";
import { attemptBadge } from "./verdict";

export type LibraryTab = "hld" | "lld" | "custom";
export type LibraryFilter = "fresh" | "redo" | "all";

export const FILTER_LABEL: Record<LibraryFilter, string> = { fresh: "Not tried first", redo: "Redo due", all: "All" };

export { isFresh };

export function inTab(problem: ProblemSummary, tab: LibraryTab): boolean {
  return tab === "custom" ? problem.custom : !problem.custom && problem.track === tab;
}

export function tabCounts(problems: readonly ProblemSummary[]): Record<LibraryTab, number> {
  return { hld: problems.filter((p) => inTab(p, "hld")).length, lld: problems.filter((p) => inTab(p, "lld")).length, custom: problems.filter((p) => p.custom).length };
}

export interface LibraryGroup {
  id: "fresh" | "tried" | "redo" | "all";
  label: string;
  problems: ProblemSummary[];
}

/** The rows of one tab, in the groups the filter asks for. A group with no rows is left out. */
export function libraryGroups(problems: readonly ProblemSummary[], tab: LibraryTab, filter: LibraryFilter): LibraryGroup[] {
  const inThisTab = problems.filter((p) => inTab(p, tab));
  const groups: LibraryGroup[] =
    filter === "redo"
      ? [{ id: "redo", label: "Redo due", problems: inThisTab.filter((p) => p.badge === "redo") }]
      : filter === "all"
        ? [{ id: "all", label: "All", problems: inThisTab }]
        : [
            { id: "fresh", label: "Not tried", problems: inThisTab.filter(isFresh) },
            { id: "tried", label: "Tried before", problems: inThisTab.filter((p) => !isFresh(p)) },
          ];
  return groups.filter((g) => g.problems.length > 0);
}

export type ProblemStatus = "fresh" | "redo" | "open" | "partly" | "done";

/** What the detail panel calls the problem's standing. An open round outranks the rest, because it is the way back in. */
export function problemStatus(problem: ProblemSummary, history: readonly SessionHistoryItem[]): ProblemStatus {
  if (history.some((h) => h.problemId === problem.id && isOpenRound(h))) return "open";
  if (problem.badge === "redo") return "redo";
  if (problem.trackerMark === "[x]") return "done";
  if (problem.trackerMark === "[~]") return "partly";
  return isFresh(problem) ? "fresh" : "partly";
}

export const STATUS_LABEL: Record<ProblemStatus, string> = { fresh: "Not tried", redo: "Redo due", open: "Round open", partly: "Partly done", done: "Done" };

export const STATUS_TONE: Record<ProblemStatus, "good" | "warn" | "neutral" | "accent"> = { fresh: "neutral", redo: "warn", open: "accent", partly: "warn", done: "good" };

/** The open round of a problem, newest first. */
export function openRoundFor(problemId: string, history: readonly SessionHistoryItem[]): SessionHistoryItem | undefined {
  return history.filter((h) => h.problemId === problemId && isOpenRound(h)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/** The second line of a row: when a redo fell due, or how the last try went. */
export function rowDetail(problem: Pick<ProblemSummary, "lastAttempt" | "redoDueOn">, status: ProblemStatus, now: Date): string | null {
  if (status === "redo") return redoDueText(problem.redoDueOn ?? null, now);
  const last = problem.lastAttempt;
  if (!last) return null;
  const badge = attemptBadge(last);
  return badge ? `${badge.label} · ${dayMonth(last.date)}` : `Tried ${dayMonth(last.date)}`;
}
