import { COMMON_TOPICS, emptyDsa, type DsaResponse, type DsaSolve } from "../../shared/dsa";
import { planIndex, weekStart } from "../../shared/week";
import type { DsaData } from "../lib/useDsa";

export const DSA_STATES = ["ok", "touched", "fresh", "stale", "notfound", "error", "none"] as const;

const day = (now: Date, back: number, hour: number, minute = 0): string => new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, hour, minute).toISOString();

function recent(now: Date): DsaSolve[] {
  return [
    { title: "Merge Intervals", slug: "merge-intervals", difficulty: "Medium", solvedAt: day(now, 0, 7, 40) },
    { title: "Valid Parentheses", slug: "valid-parentheses", difficulty: "Easy", solvedAt: day(now, 1, 21, 5) },
    { title: "Course Schedule", slug: "course-schedule", difficulty: "Medium", solvedAt: day(now, 2, 18, 20) },
    { title: "Trapping Rain Water", slug: "trapping-rain-water", difficulty: "Hard", solvedAt: day(now, 4, 9, 15) },
    { title: "Two Sum", slug: "two-sum", difficulty: "Easy", solvedAt: day(now, 6, 20, 0) },
  ];
}

function base(now: Date): DsaResponse {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14);
  const countFrom = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-${String(from.getDate()).padStart(2, "0")}`;
  // The week numbers come from the same list the page shows, so a screenshot never disagrees with itself.
  const solves = recent(now);
  const start = weekStart(now);
  const inWeek = solves.filter((solve) => new Date(solve.solvedAt) >= start);
  const perDay = [0, 0, 0, 0, 0, 0, 0];
  const mediumsPerDay = [0, 0, 0, 0, 0, 0, 0];
  for (const solve of inWeek) {
    const index = planIndex(new Date(solve.solvedAt));
    perDay[index] = (perDay[index] ?? 0) + 1;
    if (solve.difficulty === "Medium") mediumsPerDay[index] = (mediumsPerDay[index] ?? 0) + 1;
  }
  return {
    username: "example_user",
    status: "ok",
    fetchedAt: day(now, 0, now.getHours(), 0),
    countFrom,
    pass: { solved: 5, easy: 2, medium: 2, hard: 1, unread: 0 },
    topics: [
      { name: "Array", slug: "array", solved: 3 },
      { name: "Hash Table", slug: "hash-table", solved: 2 },
      { name: "Stack", slug: "stack", solved: 1 },
      { name: "Graph", slug: "graph", solved: 1 },
      { name: "Heap", slug: "heap-priority-queue", solved: 1 },
      { name: "Sorting", slug: "sorting", solved: 1 },
    ],
    week: { solved: inWeek.length, mediums: inWeek.filter((solve) => solve.difficulty === "Medium").length, perDay, mediumsPerDay },
    recent: solves,
    lifetimeSolved: 96,
    weeklyGoal: 3,
    failure: null,
    nextReadAt: null,
  };
}

/** The DSA page's data for each state, with no network. */
export function fixtureDsa(state: string, now: Date): DsaData {
  const idle = { loading: false, unreachable: false, refreshing: false, refresh: () => undefined };
  const ok = base(now);
  let response: DsaResponse | null = ok;
  if (state === "touched") {
    const counts = [9, 7, 6, 5, 4, 4, 3, 3, 3, 2, 2, 2, 1, 1, 1, 1];
    response = {
      ...ok,
      pass: { solved: 60, easy: 20, medium: 32, hard: 6, unread: 2 },
      topics: COMMON_TOPICS.map((t, i) => ({ name: t.name, slug: t.slug, solved: counts[i] ?? 1 })),
    };
  } else if (state === "fresh") {
    response = {
      ...ok,
      pass: { solved: 0, easy: 0, medium: 0, hard: 0, unread: 0 },
      topics: [],
      week: { solved: 0, mediums: 0, perDay: [0, 0, 0, 0, 0, 0, 0], mediumsPerDay: [0, 0, 0, 0, 0, 0, 0] },
      recent: [],
    };
  } else if (state === "stale") {
    response = {
      ...ok,
      status: "stale",
      fetchedAt: day(now, 2, 8, 10),
      failure: { reason: "timeout", at: now.toISOString() },
      nextReadAt: new Date(now.getTime() + 8000).toISOString(),
    };
  } else if (state === "notfound") {
    response = emptyDsa("example_user", "not_found", 3, ok.countFrom);
  } else if (state === "error") {
    response = { ...emptyDsa("example_user", "error", 3, ok.countFrom), failure: { reason: "unreachable", at: now.toISOString() } };
  } else if (state === "none") {
    response = null;
  }
  return { response, ...idle };
}
