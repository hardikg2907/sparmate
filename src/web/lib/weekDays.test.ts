import { describe, expect, it } from "vitest";
import { emptyDsa, type DsaResponse } from "../../shared/dsa";
import type { SessionHistoryItem } from "../../shared/types";
import type { DayKind } from "../../shared/week";
import { weekDays } from "./weekDays";

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
  return {
    ...emptyDsa("u", "ok", 3),
    recent: solves.map((s, i) => ({ title: `t${i}`, slug: `t${i}`, difficulty: s.difficulty, solvedAt: new Date(2026, 10, s.day, 9, 0).toISOString() })),
  };
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
