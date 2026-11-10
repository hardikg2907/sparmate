import { describe, expect, it } from "vitest";
import type { ProblemSummary, SessionHistoryItem } from "../../shared/types";
import { libraryGroups, openRoundFor, problemStatus, rowDetail, tabCounts } from "./library";

function problem(id: string, extra: Partial<ProblemSummary> = {}): ProblemSummary {
  return { id, track: "hld", title: id, difficulty: "medium", tags: [], trackerMark: "[ ]", lastAttempt: null, summary: "", badge: null, custom: false, ...extra };
}
const attempt = { sessionId: "s", date: "2026-11-01", mode: "interview" as const, verdict: null };
const open = (problemId: string): SessionHistoryItem => ({
  id: `r-${problemId}`,
  problemId,
  title: problemId,
  track: "hld",
  mode: "interview",
  createdAt: "2026-11-02T10:00:00.000Z",
  status: "paused",
  verdict: null,
  pause: null,
  notesSaved: false,
});

const catalog = [
  problem("a"),
  problem("b"),
  problem("c", { trackerMark: "[~]", badge: "redo", lastAttempt: attempt }),
  problem("d", { trackerMark: "[x]", lastAttempt: attempt }),
  problem("e", { track: "lld" }),
  problem("mine", { custom: true, trackerMark: null, track: "lld" }),
];

describe("library tabs", () => {
  it("counts each tab, and keeps custom problems out of the track tabs", () => {
    expect(tabCounts(catalog)).toEqual({ hld: 4, lld: 1, custom: 1 });
  });
});

describe("libraryGroups", () => {
  it("puts fresh problems first and the rest under Tried before", () => {
    const groups = libraryGroups(catalog, "hld", "fresh");
    expect(groups.map((g) => [g.label, g.problems.map((p) => p.id)])).toEqual([
      ["Not tried", ["a", "b"]],
      ["Tried before", ["c", "d"]],
    ]);
  });

  it("shows only redos that are due under the Redo due filter", () => {
    expect(libraryGroups(catalog, "hld", "redo").flatMap((g) => g.problems.map((p) => p.id))).toEqual(["c"]);
  });

  it("shows everything in one group under All", () => {
    expect(libraryGroups(catalog, "hld", "all")).toHaveLength(1);
    expect(libraryGroups(catalog, "hld", "all")[0]?.problems).toHaveLength(4);
  });

  it("leaves out an empty group and lists custom problems on their own tab", () => {
    expect(libraryGroups(catalog, "lld", "redo")).toEqual([]);
    expect(libraryGroups(catalog, "custom", "fresh").flatMap((g) => g.problems.map((p) => p.id))).toEqual(["mine"]);
  });
});

describe("problemStatus", () => {
  it("ranks an open round above everything else", () => {
    expect(problemStatus(catalog[2]!, [open("c")])).toBe("open");
  });

  it.each([
    ["a", "fresh"],
    ["c", "redo"],
    ["d", "done"],
  ])("calls %s %s", (id, status) => {
    expect(
      problemStatus(
        catalog.find((p) => p.id === id)!,
        [],
      ),
    ).toBe(status);
  });

  it("finds the open round of a problem", () => {
    expect(openRoundFor("a", [open("a"), open("b")])?.id).toBe("r-a");
    expect(openRoundFor("z", [open("a")])).toBeUndefined();
  });
});

describe("rowDetail", () => {
  const now = new Date(2026, 10, 12, 10);

  it("names the day an overdue redo fell due", () => {
    expect(rowDetail(problem("c", { trackerMark: "[~]", badge: "redo", redoDueOn: "2026-10-31", lastAttempt: attempt }), "redo", now)).toBe("Due since 31 Oct");
  });

  it("gives the last try's own result and day, and a plain line when it has no result", () => {
    const guided = { ...attempt, mode: "guided" as const, readiness: "not_yet" as const, date: "2026-11-03" };
    expect(rowDetail(problem("p", { trackerMark: "[~]", lastAttempt: guided }), "partly", now)).toBe("Not yet · 3 Nov");
    expect(rowDetail(problem("q", { lastAttempt: attempt }), "partly", now)).toBe("Tried 1 Nov");
  });

  it("has no line for a problem that was never tried", () => {
    expect(rowDetail(problem("a"), "fresh", now)).toBeNull();
  });
});
