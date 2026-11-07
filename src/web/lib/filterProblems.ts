import type { ProblemSummary } from "../../shared/types";

export type StatusFilter = "all" | "not_started" | "partly_done" | "done" | "redo_due";
export type SortOption = "tracker" | "difficulty" | "last_attempt";

export const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: "All",
  not_started: "Not started",
  partly_done: "Partly done",
  done: "Done",
  redo_due: "Redo due",
};

export const SORT_OPTION_LABELS: Record<SortOption, string> = {
  tracker: "Tracker order",
  difficulty: "Difficulty",
  last_attempt: "Last attempt",
};

const DIFFICULTY_WEIGHT: Record<ProblemSummary["difficulty"], number> = {
  easy: 1,
  medium: 2,
  hard: 3,
};

/** Matches a problem against the chosen status filter. */
export function matchesStatus(problem: ProblemSummary, filter: StatusFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "not_started":
      return problem.trackerMark === "[ ]" || (problem.trackerMark === null && !problem.lastAttempt);
    case "partly_done":
      return problem.trackerMark === "[~]";
    case "done":
      return problem.trackerMark === "[x]";
    case "redo_due":
      return problem.badge === "redo";
  }
}

/** Pure filter and sort pipeline for a track problem list. */
export function filterAndSortProblems(problems: ProblemSummary[], filter: StatusFilter, sort: SortOption): ProblemSummary[] {
  const filtered = filter === "all" ? problems.slice() : problems.filter((p) => matchesStatus(p, filter));

  if (sort === "tracker") {
    return filtered;
  }

  return filtered
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      if (sort === "difficulty") {
        const diff = DIFFICULTY_WEIGHT[a.item.difficulty] - DIFFICULTY_WEIGHT[b.item.difficulty];
        return diff !== 0 ? diff : a.index - b.index;
      }
      if (sort === "last_attempt") {
        const aTime = a.item.lastAttempt ? Date.parse(a.item.lastAttempt.date) : -1;
        const bTime = b.item.lastAttempt ? Date.parse(b.item.lastAttempt.date) : -1;
        if (aTime !== bTime) {
          return bTime - aTime;
        }
        return a.index - b.index;
      }
      return a.index - b.index;
    })
    .map(({ item }) => item);
}
