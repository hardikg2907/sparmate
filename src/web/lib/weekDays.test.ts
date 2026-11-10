import { describe, expect, it } from "vitest";
import { emptyDsa, type DsaResponse } from "../../shared/dsa";
import type { SessionHistoryItem } from "../../shared/types";
import type { DayKind } from "../../shared/week";
import { weekStats } from "../../shared/progress";
import { selectToday } from "../../shared/today";
import type { ProblemSummary } from "../../shared/types";
import { daysUntilNextPlanned, weekDays } from "./weekDays";

// Thursday 12 November 2026; the week starts Monday 9 November.
const NOW = new Date(2026, 10, 12, 10, 0);
const PLAN: DayKind[] = ["hld", "dsa", "lld", "hld", "dsa", "lld", "rest"];

function round(day: number, over: Partial<SessionHistoryItem> = {}): SessionHistoryItem {
  const at = new Date(2026, 10, day, 11, 0).toISOString();
  return {
    id: `r${day}-${over.track ?? "hld"}`,
    problemId: `p${day}`,
    title: "t",
    track: "hld",
    mode: "interview",
    createdAt: at,
    endedAt: at,
    status: "debriefed",
    verdict: null,
    pause: null,
    notesSaved: false,
    ...over,
  };
}

function dsaWith(...solves: { day: number; difficulty: "Easy" | "Medium" }[]): DsaResponse {
  const base = emptyDsa("u", "ok", 3);
  const mediumsPerDay = [0, 0, 0, 0, 0, 0, 0];
  for (const s of solves) if (s.difficulty === "Medium") mediumsPerDay[s.day - 9] = (mediumsPerDay[s.day - 9] ?? 0) + 1;
  return { ...base, week: { ...base.week, mediumsPerDay } };
}

const states = (h: SessionHistoryItem[], dsa: DsaResponse | null = null) => weekDays(PLAN, h, dsa, NOW).days.map((d) => d.state);

describe("weekDays", () => {
  it("marks a past round day done when a round of that kind ended that day, and missed when none did", () => {
    expect(states([round(9)]).slice(0, 3)).toEqual(["done", "planned", "missed"]);
  });

  it("does not count a round of the other kind", () => {
    expect(states([round(9, { track: "lld" })])[0]).toBe("missed");
  });

  it("ignores open, failed and gap rounds", () => {
    const rounds = [round(9, { status: "paused" }), round(9, { id: "f", status: "failed" }), round(9, { id: "g", focus: true })];
    expect(states(rounds)[0]).toBe("missed");
  });

  it("dates a round by the day it ended, not the day it started", () => {
    const overnight = round(9, { endedAt: new Date(2026, 10, 10, 0, 30).toISOString() });
    expect(states([overnight]).slice(0, 2)).toEqual(["missed", "planned"]);
  });

  it("leaves a DSA day planned without data, and done only with a medium solved that day", () => {
    expect(states([])[1]).toBe("planned");
    expect(states([], dsaWith({ day: 10, difficulty: "Easy" }))[1]).toBe("planned");
    expect(states([], dsaWith({ day: 10, difficulty: "Medium" }))[1]).toBe("done");
  });

  it("reads the week's medium count, not the recent list, so it agrees with the ring", () => {
    const base = emptyDsa("u", "ok", 3);
    const dsa: DsaResponse = { ...base, recent: [], week: { ...base.week, mediumsPerDay: [0, 2, 0, 0, 0, 0, 0] } };
    expect(states([], dsa)[1]).toBe("done");
  });

  it("ignores DSA solves when the data is not usable", () => {
    const failed = { ...dsaWith({ day: 10, difficulty: "Medium" }), status: "error" as const };
    expect(states([], failed)[1]).toBe("planned");
  });

  it("treats a redo day as done only for a round on a problem tried before", () => {
    const plan: DayKind[] = ["redo", "rest", "rest", "rest", "rest", "rest", "rest"];
    const first = round(9, { id: "a", problemId: "same", createdAt: new Date(2026, 10, 2, 9).toISOString(), endedAt: new Date(2026, 10, 2, 10).toISOString() });
    const again = round(9, { id: "b", problemId: "same" });
    expect(weekDays(plan, [first], null, NOW).days[0]?.state).toBe("missed");
    expect(weekDays(plan, [first, again], null, NOW).days[0]?.state).toBe("done");
  });

  it("marks today, rest and later days", () => {
    expect(states([])).toEqual(["missed", "planned", "missed", "today", "planned", "planned", "rest"]);
  });

  it("flags today done without changing its state", () => {
    const today = weekDays(PLAN, [round(12)], null, NOW).days[3];
    expect(today).toMatchObject({ state: "today", isToday: true, done: true });
  });

  it("counts only days whose outcome is known", () => {
    const summary = weekDays(PLAN, [round(9), round(12)], null, NOW);
    // Mon done, Tue DSA unknown, Wed missed, Thu today done.
    expect(summary).toMatchObject({ known: 3, done: 2 });
    expect(weekDays(PLAN, [round(9)], null, NOW)).toMatchObject({ known: 2, done: 1 });
  });

  it("counts a DSA day once the data confirms it", () => {
    expect(weekDays(PLAN, [round(9)], dsaWith({ day: 10, difficulty: "Medium" }), NOW)).toMatchObject({ known: 3, done: 2 });
  });

  it("works on Sunday, the last day of the week", () => {
    const sunday = new Date(2026, 10, 15, 10, 0);
    const days = weekDays(PLAN, [], null, sunday).days;
    expect(days[6]).toMatchObject({ state: "today", kind: "rest", day: "2026-11-15" });
    expect(days[0]?.day).toBe("2026-11-09");
  });
});

describe("daysUntilNextPlanned", () => {
  it("finds the next day that is not a rest day", () => {
    expect(daysUntilNextPlanned(PLAN, NOW)).toEqual({ days: 1, kind: "dsa" });
  });

  it("wraps past Sunday into the next week", () => {
    expect(daysUntilNextPlanned(PLAN, new Date(2026, 10, 15))).toEqual({ days: 1, kind: "hld" });
  });

  it("skips consecutive rest days and gives null for an all-rest plan", () => {
    expect(daysUntilNextPlanned(["rest", "rest", "rest", "hld", "rest", "rest", "rest"], new Date(2026, 10, 9))).toEqual({ days: 3, kind: "hld" });
    expect(daysUntilNextPlanned(Array<DayKind>(7).fill("rest"), NOW)).toBeNull();
  });
});

describe("the week strip and the weekly counts", () => {
  it("place a round that began in one week and ended in the next in the same week", () => {
    const long = round(8, { track: "lld", endedAt: new Date(2026, 10, 11, 9).toISOString() });
    const strip = weekDays(PLAN, [long], null, NOW);
    expect(strip.days.map((d) => d.done)).toEqual([false, false, true, false, false, false, false]);
    expect(weekStats([long], PLAN, NOW).rounds.done).toBe(1);
    expect(weekStats([long], PLAN, new Date(2026, 10, 8, 12)).rounds.done).toBe(0);
  });
});

describe("a machine coding round on a system design day", () => {
  const problem = (id: string, track: "hld" | "lld", extra: Partial<ProblemSummary> = {}): ProblemSummary => ({
    id,
    track,
    title: id,
    difficulty: "medium",
    tags: [],
    trackerMark: "[ ]",
    lastAttempt: null,
    summary: "",
    badge: null,
    custom: false,
    ...extra,
  });
  const problems = [
    problem("parking-lot", "lld", { trackerMark: "[~]", lastAttempt: { sessionId: "r12-lld", date: "2026-11-12", mode: "interview", verdict: "hire" }, redoDueOn: "2026-11-19" }),
    problem("elevator", "lld"),
    problem("url-shortener", "hld", { badge: "next" }),
  ];
  const history = [round(12, { track: "lld", problemId: "parking-lot" })];

  it("keeps the day an HLD day: the hero is a system design problem although a fresh machine coding one exists, and the redo of the round just played only waits", () => {
    const pick = selectToday({ now: NOW, plan: PLAN, problems, history });
    expect(pick.dayKind).toBe("hld");
    expect(pick.hero).toMatchObject({ kind: "problem", reason: "new", problem: { id: "url-shortener" } });
    expect(pick.moreRedos.map((e) => [e.problem.id, e.due])).toEqual([["parking-lot", false]]);
  });

  it("leaves the day open on the strip and out of the count, because only a round of the day's kind finishes it", () => {
    const week = weekDays(PLAN, history, null, NOW);
    expect(week.days[3]).toMatchObject({ kind: "hld", state: "today", done: false });
    const withHld = weekDays(PLAN, [...history, round(12, { id: "hld-12", track: "hld", problemId: "url-shortener" })], null, NOW);
    expect(withHld.days[3]).toMatchObject({ state: "today", done: true });
    expect(withHld.known).toBe(week.known + 1);
    expect(withHld.done).toBe(week.done + 1);
  });

  it("finishes a machine coding day only with a machine coding round that ended that day", () => {
    const week = weekDays(PLAN, [round(12, { track: "lld" })], null, new Date(2026, 10, 14, 10));
    expect(week.days[5]).toMatchObject({ kind: "lld", state: "today", done: false });
    const later = weekDays(PLAN, [round(14, { track: "lld" })], null, new Date(2026, 10, 14, 15));
    expect(later.days[5]).toMatchObject({ kind: "lld", state: "today", done: true });
  });
});
