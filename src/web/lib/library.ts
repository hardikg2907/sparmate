import type { ProblemSummary, SessionHistoryItem } from "../../shared/types";
import { isOpenRound } from "../../shared/today";

export type LibraryTab = "hld" | "lld" | "custom";
export type LibraryFilter = "fresh" | "redo" | "all";

export const FILTER_LABEL: Record<LibraryFilter, string> = { fresh: "Fresh first", redo: "Redo due", all: "All" };

/** A problem with no attempt and no mark: nothing about it has been tried. */
export function isFresh(problem: ProblemSummary): boolean {
  return problem.lastAttempt === null && problem.trackerMark !== "[x]" && problem.trackerMark !== "[~]";
}

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
            { id: "fresh", label: "Fresh", problems: inThisTab.filter(isFresh) },
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

export const STATUS_LABEL: Record<ProblemStatus, string> = { fresh: "Fresh", redo: "Redo due", open: "Round open", partly: "Partly done", done: "Done" };

/** The open round of a problem, newest first. */
export function openRoundFor(problemId: string, history: readonly SessionHistoryItem[]): SessionHistoryItem | undefined {
  return history.filter((h) => h.problemId === problemId && isOpenRound(h)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}
