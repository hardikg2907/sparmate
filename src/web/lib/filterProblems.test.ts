import { describe, expect, it } from "vitest";
import type { ProblemSummary } from "../../shared/types";
import { filterAndSortProblems, matchesStatus } from "./filterProblems";

function makeProblem(overrides: Partial<ProblemSummary> & { id: string; title: string }): ProblemSummary {
  return {
    track: "hld",
    summary: "A mock problem",
    custom: false,
    difficulty: "medium",
    trackerMark: "[ ]",
    lastAttempt: null,
    badge: null,
    tags: [],
    ...overrides,
  };
}

describe("matchesStatus", () => {
  const unstarted = makeProblem({ id: "p1", title: "P1", trackerMark: "[ ]" });
  const partly = makeProblem({ id: "p2", title: "P2", trackerMark: "[~]" });
  const done = makeProblem({ id: "p3", title: "P3", trackerMark: "[x]" });
  const redo = makeProblem({ id: "p4", title: "P4", trackerMark: "[~]", badge: "redo" });
  const custom = makeProblem({ id: "p5", title: "P5", trackerMark: null });

  it("matches all problems for 'all'", () => {
    expect(matchesStatus(unstarted, "all")).toBe(true);
    expect(matchesStatus(partly, "all")).toBe(true);
    expect(matchesStatus(done, "all")).toBe(true);
    expect(matchesStatus(redo, "all")).toBe(true);
    expect(matchesStatus(custom, "all")).toBe(true);
  });

  it("filters not started problems", () => {
    expect(matchesStatus(unstarted, "not_started")).toBe(true);
    expect(matchesStatus(custom, "not_started")).toBe(true);
    expect(matchesStatus(partly, "not_started")).toBe(false);
    expect(matchesStatus(done, "not_started")).toBe(false);
    expect(matchesStatus(redo, "not_started")).toBe(false);
  });

  it("filters partly done problems", () => {
    expect(matchesStatus(partly, "partly_done")).toBe(true);
    expect(matchesStatus(redo, "partly_done")).toBe(true);
    expect(matchesStatus(unstarted, "partly_done")).toBe(false);
    expect(matchesStatus(done, "partly_done")).toBe(false);
  });

  it("filters done problems", () => {
    expect(matchesStatus(done, "done")).toBe(true);
    expect(matchesStatus(unstarted, "done")).toBe(false);
    expect(matchesStatus(partly, "done")).toBe(false);
  });

  it("filters redo due problems", () => {
    expect(matchesStatus(redo, "redo_due")).toBe(true);
    expect(matchesStatus(partly, "redo_due")).toBe(false);
    expect(matchesStatus(unstarted, "redo_due")).toBe(false);
  });
});

describe("filterAndSortProblems", () => {
  const problems: ProblemSummary[] = [
    makeProblem({ id: "1", title: "First", difficulty: "hard", trackerMark: "[ ]" }),
    makeProblem({
      id: "2",
      title: "Second",
      difficulty: "easy",
      trackerMark: "[~]",
      badge: "redo",
      lastAttempt: { date: "2026-10-15", verdict: "lean_no_hire", sessionId: "s2", mode: "interview" },
    }),
    makeProblem({
      id: "3",
      title: "Third",
      difficulty: "medium",
      trackerMark: "[x]",
      lastAttempt: { date: "2026-10-25", verdict: "hire", sessionId: "s3", mode: "interview" },
    }),
    makeProblem({ id: "4", title: "Fourth", difficulty: "easy", trackerMark: "[ ]" }),
  ];

  it("preserves tracker order by default", () => {
    const res = filterAndSortProblems(problems, "all", "tracker");
    expect(res.map((p) => p.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("sorts by difficulty ascending (easy -> medium -> hard) preserving relative order", () => {
    const res = filterAndSortProblems(problems, "all", "difficulty");
    expect(res.map((p) => p.id)).toEqual(["2", "4", "3", "1"]);
  });

  it("sorts by last attempt newest first, putting unattempted last", () => {
    const res = filterAndSortProblems(problems, "all", "last_attempt");
    expect(res.map((p) => p.id)).toEqual(["3", "2", "1", "4"]);
  });

  it("filters and sorts together", () => {
    const res = filterAndSortProblems(problems, "not_started", "difficulty");
    expect(res.map((p) => p.id)).toEqual(["4", "1"]);
  });

  it("returns empty array when filter matches nothing", () => {
    const res = filterAndSortProblems(problems.slice(0, 1), "done", "tracker");
    expect(res).toEqual([]);
  });
});
