import { describe, expect, it } from "vitest";
import type { Track } from "./phases";
import { clockUsedMs, isFresh, largestOverrun, modeFor, redoIntervalDays, redoQueue, selectToday, type TodayInput } from "./today";
import type { ProblemSummary, SessionHistoryItem } from "./types";
import { DEFAULT_WEEKLY_PLAN, type DayKind } from "./week";

// 2026-11-10 is a Tuesday, 2026-11-09 a Monday, 2026-11-14 a Saturday, 2026-11-15 a Sunday.
const at = (day: number, hour = 12) => new Date(2026, 10, day, hour, 0, 0);
const TUESDAY = at(10);
const HOUR = 3_600_000;

function problem(id: string, track: Track, extra: Partial<ProblemSummary> = {}): ProblemSummary {
  return { id, track, title: id, difficulty: "medium", tags: [], trackerMark: "[ ]", lastAttempt: null, summary: "", badge: null, custom: false, ...extra };
}

function redoProblem(id: string, track: Track, date: string, extra: Partial<ProblemSummary["lastAttempt"] & object> = {}): ProblemSummary {
  return problem(id, track, { trackerMark: "[~]", badge: "redo", lastAttempt: { sessionId: `s-${id}`, date, mode: "interview", verdict: "lean_no_hire", ...extra } });
}

function round(id: string, problemId: string, track: Track, extra: Partial<SessionHistoryItem> = {}): SessionHistoryItem {
  return {
    id,
    problemId,
    title: problemId,
    track,
    mode: "interview",
    createdAt: TUESDAY.toISOString(),
    status: "debriefed",
    verdict: null,
    pause: null,
    notesSaved: false,
    ...extra,
  };
}

function paused(
  id: string,
  problemId: string,
  track: Track,
  pausedHoursAgo: number,
  usedMin = 30,
  extra: Partial<SessionHistoryItem> = {},
  base: Date = TUESDAY,
): SessionHistoryItem {
  const pausedAt = new Date(base.getTime() - pausedHoursAgo * HOUR);
  const startedAt = new Date(pausedAt.getTime() - usedMin * 60_000);
  return round(id, problemId, track, {
    status: "paused",
    createdAt: startedAt.toISOString(),
    pause: { reason: "user", pausedAt: pausedAt.toISOString(), timeLeftMs: 10 * 60_000 },
    clock: { startedAt: startedAt.toISOString(), pausedMs: 0, pauseStartedAt: pausedAt.toISOString(), durationMs: 45 * 60_000 },
    ...extra,
  });
}

const pick = (input: Partial<TodayInput> & { plan?: readonly DayKind[] }) => selectToday({ now: TUESDAY, plan: DEFAULT_WEEKLY_PLAN, problems: [], history: [], ...input });

const catalog = [
  problem("hld-new", "hld", { badge: "next" }),
  problem("hld-other", "hld"),
  problem("lld-new", "lld"),
  redoProblem("hld-redo", "hld", "2026-10-30"),
  redoProblem("lld-redo", "lld", "2026-10-25"),
];

describe("day types", () => {
  it("offers the new problem of the track on an HLD day, before a due redo", () => {
    const result = pick({ problems: catalog });
    expect(result.dayKind).toBe("hld");
    expect(result.hero).toMatchObject({ kind: "problem", reason: "new", problem: { id: "hld-new" } });
  });

  it("offers the due redo of the track when the track has no new problem left", () => {
    const result = pick({ problems: catalog.filter((p) => p.track !== "hld" || p.id === "hld-redo") });
    expect(result.hero).toMatchObject({ kind: "problem", reason: "redo", problem: { id: "hld-redo" } });
  });

  it("offers the oldest due redo of the track, then a new problem of the other track, then any redo", () => {
    const hld = [redoProblem("hld-late", "hld", "2026-10-30"), redoProblem("hld-early", "hld", "2026-10-20")];
    expect(pick({ problems: [...hld, problem("lld-new", "lld"), redoProblem("lld-redo", "lld", "2026-10-01")] }).hero).toMatchObject({
      reason: "redo",
      problem: { id: "hld-early" },
    });
    expect(pick({ problems: [problem("lld-new", "lld"), redoProblem("lld-redo", "lld", "2026-10-01")] }).hero).toMatchObject({ reason: "new", problem: { id: "lld-new" } });
    expect(pick({ problems: [redoProblem("lld-redo", "lld", "2026-10-01")] }).hero).toMatchObject({ reason: "redo", problem: { id: "lld-redo" } });
  });

  it("offers the recommended new problem of the track when no redo is due", () => {
    const result = pick({ problems: catalog.filter((p) => p.id !== "hld-redo") });
    expect(result.hero).toMatchObject({ kind: "problem", reason: "new", problem: { id: "hld-new" } });
  });

  it("falls back to the first fresh problem of the track when the recommendation is on the other track", () => {
    const result = pick({ problems: [problem("lld-new", "lld", { badge: "next" }), problem("hld-a", "hld"), problem("hld-b", "hld")] });
    expect(result.hero).toMatchObject({ problem: { id: "hld-a" } });
  });

  it("uses the LLD track on Saturday", () => {
    const result = pick({ now: at(14), problems: catalog.filter((p) => p.id !== "lld-redo") });
    expect(result.dayKind).toBe("lld");
    expect(result.hero).toMatchObject({ problem: { id: "lld-new" } });
  });

  it("offers the oldest due redo of any track on a Redo day", () => {
    const result = pick({ now: at(15), problems: catalog });
    expect(result.dayKind).toBe("redo");
    expect(result.hero).toMatchObject({ reason: "redo", problem: { id: "lld-redo" } });
  });

  it("offers a new problem of the track with fewer recent rounds on a Redo day with nothing due", () => {
    const history = [round("a", "x", "hld", { createdAt: at(8).toISOString() }), round("b", "y", "hld", { createdAt: at(5).toISOString() })];
    const result = pick({ now: at(15), problems: [problem("hld-new", "hld"), problem("lld-new", "lld")], history });
    expect(result.hero).toMatchObject({ reason: "new", problem: { id: "lld-new" } });
  });

  it("says solve on LeetCode on a DSA day and offers the newest open gap", () => {
    const old = round("old", "p", "hld", {
      createdAt: at(2).toISOString(),
      gaps: [{ title: "Old gap", goodLooksLike: "x", severity: "high", done: false }],
    });
    const newer = round("new", "q", "hld", {
      createdAt: at(8).toISOString(),
      gaps: [
        { title: "Done gap", goodLooksLike: "x", severity: "high", done: true },
        { title: "Low gap", goodLooksLike: "y", severity: "low", done: false },
        { title: "Mid gap", goodLooksLike: "z", severity: "medium", done: false },
      ],
    });
    const result = pick({ now: at(9), problems: catalog, history: [old, newer] });
    expect(result.dayKind).toBe("dsa");
    expect(result.hero).toMatchObject({ kind: "dsa", gap: { item: { id: "new" }, gap: { title: "Mid gap" } } });
  });

  it("offers no gap on a DSA day when every gap is finished", () => {
    expect(pick({ now: at(9), problems: catalog }).hero).toEqual({ kind: "dsa", gap: null });
  });

  it("shows a rest day", () => {
    expect(pick({ now: at(11), plan: ["rest", "rest", "rest", "rest", "rest", "rest", "rest"], problems: catalog }).hero).toEqual({ kind: "rest" });
  });

  it("has nothing to offer with no problems", () => {
    expect(pick({}).hero).toEqual({ kind: "empty" });
  });

  it("has nothing to offer when every problem is done", () => {
    const done = [problem("a", "hld", { trackerMark: "[x]" }), problem("b", "lld", { trackerMark: "[x]" })];
    const result = pick({ problems: done });
    expect(result.hero).toEqual({ kind: "empty" });
    expect(result.moreRedos).toEqual([]);
  });

  it("never offers a custom problem as the new one", () => {
    const result = pick({ problems: [problem("mine", "hld", { custom: true, trackerMark: null })] });
    expect(result.hero).toEqual({ kind: "empty" });
  });

  it("falls back to the other track when the day's track has nothing left", () => {
    expect(pick({ problems: [problem("lld-new", "lld")] }).hero).toMatchObject({ problem: { id: "lld-new" } });
  });
});

describe("rule 1: an open round blocks the redo", () => {
  it("does not offer a redo while its round is open, and the round is not recent enough to lead", () => {
    const old = paused("open", "hld-redo", "hld", 72);
    const result = pick({ problems: catalog, history: [old] });
    expect(result.hero).toMatchObject({ kind: "resume", round: { item: { id: "open" } } });
    expect(redoQueue(catalog, [old]).map((e) => e.problem.id)).not.toContain("hld-redo");
  });

  it("does not offer the same problem as a fresh pick while its round is open", () => {
    const history = [paused("open", "hld-new", "hld", 72)];
    const result = pick({ problems: [problem("hld-new", "hld", { badge: "next" }), problem("hld-other", "hld")], history: [] });
    expect(result.hero).toMatchObject({ problem: { id: "hld-new" } });
    const blocked = pick({ problems: [problem("hld-new", "hld", { badge: "next" }), problem("hld-other", "hld")], history });
    expect(blocked.hero).toMatchObject({ kind: "resume" });
  });

  it("skips the blocked redo and takes the next due one", () => {
    const problems = [...catalog.filter((p) => p.trackerMark !== "[ ]"), redoProblem("hld-redo-2", "hld", "2026-10-31")];
    const result = pick({ problems, history: [paused("open", "hld-redo", "lld", 72)] });
    expect(result.hero).toMatchObject({ reason: "redo", problem: { id: "hld-redo-2" } });
  });
});

describe("rule 2: an unfinished round of the track comes before a new problem and a due redo", () => {
  it("offers the unfinished round before a due redo, and the redo waits in the queue", () => {
    const result = pick({ problems: catalog, history: [paused("open", "hld-other", "hld", 72)] });
    expect(result.hero).toMatchObject({ kind: "resume", round: { item: { id: "open" } } });
    expect(result.moreRedos.map((e) => e.problem.id)).toContain("hld-redo");
  });

  it("offers an older unfinished round of the track before a new problem", () => {
    const result = pick({ problems: catalog.filter((p) => p.id !== "hld-redo"), history: [paused("open", "hld-other", "hld", 72)] });
    expect(result.hero).toMatchObject({ kind: "resume", round: { item: { id: "open" } } });
  });

  it("ignores an older unfinished round of the other track", () => {
    const result = pick({ problems: catalog.filter((p) => p.id !== "hld-redo"), history: [paused("open", "lld-new", "lld", 72)] });
    expect(result.hero).toMatchObject({ kind: "problem", problem: { id: "hld-new" } });
  });
});

describe("rule 3: a round paused in the last 24 hours leads on any day", () => {
  it.each([
    ["an HLD day", 10],
    ["a DSA day", 9],
    ["a Redo day", 15],
  ])("leads on %s", (_name, day) => {
    const result = pick({ now: at(day), problems: catalog, history: [paused("fresh", "lld-new", "lld", 3, 30, {}, at(day))] });
    expect(result.hero).toMatchObject({ kind: "resume", round: { item: { id: "fresh" } } });
    expect(result.unfinished).toEqual([]);
  });

  it("leads on a rest day", () => {
    const result = pick({ plan: ["rest", "rest", "rest", "rest", "rest", "rest", "rest"], problems: catalog, history: [paused("fresh", "lld-new", "lld", 3)] });
    expect(result.hero.kind).toBe("resume");
  });

  it("does not lead after 24 hours", () => {
    const result = pick({ problems: catalog, history: [paused("stale", "lld-new", "lld", 25)] });
    expect(result.hero.kind).toBe("problem");
  });

  it("picks the newest of several fresh rounds and lists the rest", () => {
    const result = pick({ problems: catalog, history: [paused("a", "x", "lld", 10), paused("b", "y", "lld", 2)] });
    expect(result.hero).toMatchObject({ round: { item: { id: "b" } } });
    expect(result.unfinished.map((u) => u.item.id)).toEqual(["a"]);
  });
});

describe("rule 4: a round under 5 minutes on the clock cannot be debriefed", () => {
  it("offers Discard under 5 minutes and End and debrief from 5", () => {
    const result = pick({ problems: catalog, history: [paused("short", "x", "lld", 40, 4), paused("long", "y", "lld", 50, 5)] });
    const byId = Object.fromEntries(result.unfinished.map((u) => [u.item.id, u.canDebrief]));
    expect(byId).toEqual({ short: false, long: true });
  });

  it("applies to the hero round too", () => {
    const result = pick({ problems: catalog, history: [paused("short", "x", "lld", 2, 1)] });
    expect(result.hero).toMatchObject({ kind: "resume", round: { canDebrief: false } });
  });

  it("allows a debrief when the round has no clock", () => {
    const result = pick({ problems: catalog, history: [paused("noclock", "x", "lld", 40, 30, { clock: undefined })] });
    expect(result.unfinished[0]).toMatchObject({ usedMs: null, canDebrief: true });
  });
});

describe("mode rule", () => {
  it("is guided after a guided round that was not ready yet", () => {
    expect(modeFor({ lastAttempt: { sessionId: "s", date: "2026-10-30", mode: "guided", verdict: null, readiness: "not_yet" } })).toBe("guided");
  });

  it.each([
    ["a ready guided round", { mode: "guided" as const, readiness: "ready" as const }],
    ["an interview round", { mode: "interview" as const, readiness: null }],
    ["an old guided round without a call", { mode: "guided" as const, readiness: null }],
  ])("is interview after %s", (_name, last) => {
    expect(modeFor({ lastAttempt: { sessionId: "s", date: "2026-10-30", verdict: null, ...last } })).toBe("interview");
  });

  it("is interview for a problem never tried, and flows into the hero", () => {
    expect(modeFor({ lastAttempt: null })).toBe("interview");
    const guided = redoProblem("hld-redo", "hld", "2026-10-30", { mode: "guided", readiness: "not_yet" });
    expect(pick({ problems: [guided] }).hero).toMatchObject({ mode: "guided" });
  });
});

describe("redo queue", () => {
  it("lists due redos first, then upcoming ones by date, and gives the due date", () => {
    const soon = problem("soon", "hld", { trackerMark: "[~]", lastAttempt: { sessionId: "s", date: "2026-11-08", mode: "interview", verdict: null } });
    const later = problem("later", "lld", { trackerMark: "[~]", lastAttempt: { sessionId: "s", date: "2026-11-09", mode: "interview", verdict: null } });
    const queue = redoQueue([later, soon, redoProblem("due", "hld", "2026-10-01")], []);
    expect(queue.map((e) => [e.problem.id, e.dueOn, e.due])).toEqual([
      ["due", "2026-10-08", true],
      ["soon", "2026-11-15", false],
      ["later", "2026-11-16", false],
    ]);
  });

  it("puts the other redos in moreRedos without the hero", () => {
    const result = pick({ problems: catalog.filter((p) => p.id !== "hld-new" && p.id !== "hld-other") });
    expect(result.hero).toMatchObject({ problem: { id: "hld-redo" } });
    expect(result.moreRedos.map((e) => e.problem.id)).toEqual(["lld-redo"]);
  });
});

describe("redo due dates from the server", () => {
  it("sorts and labels a tracker-only redo by the date the server sent", () => {
    const trackerOnly = problem("tracker-only", "hld", { trackerMark: "[~]", badge: "redo", lastAttempt: null, redoDueOn: "2026-11-01" });
    const withAttempt = redoProblem("with-attempt", "hld", "2026-10-20");
    const queue = redoQueue([withAttempt, trackerOnly], []);
    expect(queue.map((e) => [e.problem.id, e.dueOn, e.due])).toEqual([
      ["with-attempt", "2026-10-27", true],
      ["tracker-only", "2026-11-01", true],
    ]);
  });

  it("offers a due tracker-only redo as the hero with its due date", () => {
    const trackerOnly = problem("tracker-only", "hld", { trackerMark: "[~]", badge: "redo", lastAttempt: null, redoDueOn: "2026-11-03" });
    expect(pick({ problems: [trackerOnly] }).hero).toMatchObject({ kind: "problem", reason: "redo", dueOn: "2026-11-03", problem: { id: "tracker-only" } });
  });

  it("puts a redo with no known date after the dated ones", () => {
    const undated = problem("undated", "hld", { trackerMark: "[~]", badge: null, lastAttempt: null, redoDueOn: null });
    const dated = problem("dated", "hld", { trackerMark: "[~]", badge: null, lastAttempt: null, redoDueOn: "2026-12-01" });
    expect(redoQueue([undated, dated], []).map((e) => e.problem.id)).toEqual(["dated", "undated"]);
  });
});

describe("a new problem is a fresh one", () => {
  it("needs the tracker open mark and no attempt, the same rule as the library", () => {
    expect(isFresh({ trackerMark: "[ ]", lastAttempt: null })).toBe(true);
    expect(isFresh({ trackerMark: "[ ]", lastAttempt: { sessionId: "s", date: "2026-11-01", mode: "interview", verdict: null } })).toBe(false);
    expect(isFresh({ trackerMark: "[~]", lastAttempt: null })).toBe(false);
    expect(isFresh({ trackerMark: "[x]", lastAttempt: null })).toBe(false);
  });

  it("does not offer a tried problem whose tracker mark is still open", () => {
    const tried = problem("tried", "hld", { badge: "next", lastAttempt: { sessionId: "s", date: "2026-11-09", mode: "interview", verdict: null } });
    const result = pick({ problems: [tried, problem("fresh", "hld")] });
    expect(result.hero).toMatchObject({ reason: "new", problem: { id: "fresh" } });
  });
});

describe("gap rounds are not attempts", () => {
  it("leaves them out of the Redo day track count", () => {
    const gap = (id: string, track: Track) => round(id, `p-${id}`, track, { createdAt: at(8).toISOString(), focus: true });
    const history = [gap("a", "lld"), gap("b", "lld"), round("c", "x", "hld", { createdAt: at(8).toISOString() })];
    const result = pick({ now: at(15), problems: [problem("hld-new", "hld"), problem("lld-new", "lld")], history });
    expect(result.hero).toMatchObject({ problem: { id: "lld-new" } });
  });

  it("does not offer a gap from a gap round on a DSA day", () => {
    const history = [round("g", "p", "hld", { createdAt: at(8).toISOString(), focus: true, gaps: [{ title: "G", goodLooksLike: "x", severity: "high", done: false }] })];
    expect(pick({ now: at(9), problems: catalog, history }).hero).toEqual({ kind: "dsa", gap: null });
  });
});

describe("clock and overrun helpers", () => {
  it("counts the clock used for a paused and for a live round", () => {
    const start = at(10, 9).getTime();
    const item = round("x", "p", "hld", {
      clock: { startedAt: new Date(start).toISOString(), pausedMs: 5 * 60_000, pauseStartedAt: new Date(start + 30 * 60_000).toISOString(), durationMs: 45 * 60_000 },
    });
    expect(clockUsedMs(item, start + 99 * HOUR)).toBe(25 * 60_000);
    const live = { ...item, clock: { ...item.clock!, pauseStartedAt: null } };
    expect(clockUsedMs(live, start + 20 * 60_000)).toBe(15 * 60_000);
    expect(clockUsedMs({ ...item, clock: undefined }, start)).toBeNull();
  });

  it("finds the step that ran clearly over, and ignores small slips", () => {
    const timing = [
      { phase: "requirements", label: "Requirements", plannedMinutes: 5, actualMinutes: 8 },
      { phase: "capacity", label: "Capacity math", plannedMinutes: 4, actualMinutes: 22 },
      { phase: "api", label: "API", plannedMinutes: 4, actualMinutes: 15 },
    ];
    expect(largestOverrun(timing)).toEqual({ phase: "capacity", label: "Capacity math", actualMinutes: 22, plannedMinutes: 4 });
    expect(largestOverrun([{ phase: "api", label: "API", plannedMinutes: 10, actualMinutes: 12 }])).toBeNull();
    expect(largestOverrun([{ phase: "api", label: "API", plannedMinutes: 1, actualMinutes: 3 }])).toBeNull();
    expect(largestOverrun(undefined)).toBeNull();
  });

  it("states the plan for the coming round when given one", () => {
    const timing = [{ phase: "capacity", label: "Capacity math", plannedMinutes: 4, actualMinutes: 22 }];
    expect(largestOverrun(timing, new Map([["capacity", 3]]))?.plannedMinutes).toBe(3);
  });
});

describe("redo interval", () => {
  const scored = (id: string, day: number, scores: number[], extra: Partial<SessionHistoryItem> = {}) =>
    round(id, "p", "hld", { createdAt: at(day).toISOString(), scores: scores.map((score, i) => ({ id: `s${i}`, name: `S${i}`, score })), ...extra });

  it("is 7 days with no scored attempt", () => {
    expect(redoIntervalDays([])).toBe(7);
    expect(redoIntervalDays([round("a", "p", "hld")])).toBe(7);
    expect(redoIntervalDays([scored("a", 1, [])])).toBe(7);
  });

  it("is 7 days with one scored attempt", () => {
    expect(redoIntervalDays([scored("a", 1, [2, 3])])).toBe(7);
  });

  it("doubles after each attempt that beats the one before", () => {
    expect(redoIntervalDays([scored("a", 1, [2]), scored("b", 2, [3])])).toBe(14);
    expect(redoIntervalDays([scored("a", 1, [2]), scored("b", 2, [3]), scored("c", 3, [4])])).toBe(28);
  });

  it("orders attempts by start time, not by list order", () => {
    expect(redoIntervalDays([scored("b", 2, [3]), scored("a", 1, [2])])).toBe(14);
  });

  it("compares the mean of the scores", () => {
    expect(redoIntervalDays([scored("a", 1, [1, 5]), scored("b", 2, [3, 4])])).toBe(14);
    expect(redoIntervalDays([scored("a", 1, [1, 5]), scored("b", 2, [2, 3])])).toBe(7);
  });

  it("resets to 7 days after a lower score", () => {
    expect(redoIntervalDays([scored("a", 1, [2]), scored("b", 2, [3]), scored("c", 3, [4]), scored("d", 4, [3])])).toBe(7);
  });

  it("keeps the gap after an equal score", () => {
    expect(redoIntervalDays([scored("a", 1, [2]), scored("b", 2, [3]), scored("c", 3, [3])])).toBe(14);
  });

  it("stops at 56 days", () => {
    const rising = [1, 2, 3, 4, 5, 6, 7].map((n) => scored(`r${n}`, n, [n]));
    expect(redoIntervalDays(rising)).toBe(56);
  });

  it("ignores gap rounds and rounds that were not debriefed", () => {
    const history = [scored("a", 1, [2]), scored("f", 2, [1], { focus: true }), scored("x", 3, [1], { status: "failed" }), scored("b", 4, [3])];
    expect(redoIntervalDays(history)).toBe(14);
  });
});
