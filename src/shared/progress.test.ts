import { describe, expect, it } from "vitest";
import type { DrillAttempt, DrillPoint } from "./drills";
import { drillKindRows, drillPoints, focusFigure, focusSkill, gapForSkill, skillLevel, skillRows, stepRows, weekStats } from "./progress";
import type { Mode } from "./phases";
import type { SessionHistoryItem } from "./types";

const NOW = new Date(2026, 10, 20, 12);
const iso = (day: number) => new Date(2026, 10, day, 10).toISOString();

function scored(id: string, day: number, scores: Record<string, number>, extra: Partial<SessionHistoryItem> = {}, mode: Mode = "interview"): SessionHistoryItem {
  return {
    id,
    problemId: `p-${id}`,
    title: id,
    track: "hld",
    mode,
    createdAt: iso(day),
    status: "debriefed",
    verdict: "lean_no_hire",
    pause: null,
    notesSaved: false,
    scores: Object.entries(scores).map(([key, score]) => ({ id: key, name: key[0]!.toUpperCase() + key.slice(1).replace(/_/g, " "), score })),
    ...extra,
  };
}

describe("focusSkill", () => {
  it("is null with no scored round", () => {
    expect(focusSkill([])).toBeNull();
    expect(focusSkill([{ ...scored("a", 1, {}), scores: undefined }])).toBeNull();
  });

  it("takes the lowest average over the newest three interview rounds", () => {
    const history = [
      scored("old", 1, { depth: 1, driving: 4 }),
      scored("a", 5, { depth: 3, driving: 2 }),
      scored("b", 6, { depth: 3, driving: 2 }),
      scored("c", 7, { depth: 2, driving: 1 }),
    ];
    const focus = focusSkill(history);
    expect(focus).toMatchObject({ id: "driving", name: "Driving", score: 1.7, roundsCounted: 3, mode: "interview" });
  });

  it("prefers interview rounds over newer guided ones", () => {
    const history = [scored("i", 2, { depth: 3, driving: 2 }), scored("g", 8, { depth: 1, driving: 4 }, {}, "guided")];
    expect(focusSkill(history)).toMatchObject({ id: "driving", mode: "interview" });
  });

  it("falls back to guided rounds when there is no interview round", () => {
    expect(focusSkill([scored("g", 8, { depth: 1, driving: 4 }, {}, "guided")])).toMatchObject({ id: "depth", mode: "guided" });
  });

  it("breaks a tie by the order on the newest scorecard", () => {
    expect(focusSkill([scored("a", 5, { depth: 2, driving: 2 })])?.id).toBe("depth");
  });

  it("ignores rounds that are not debriefed", () => {
    expect(focusSkill([scored("a", 5, { depth: 1 }, { status: "failed" })])).toBeNull();
  });

  it("carries the step timing of the newest counted round that has it, and names that round", () => {
    const timing = [
      { phase: "requirements", label: "Requirements", plannedMinutes: 5, actualMinutes: 7.4 },
      { phase: "capacity", label: "Capacity math", plannedMinutes: 4, actualMinutes: 3 },
    ];
    const focus = focusSkill([scored("new", 7, { driving: 1 }), scored("with", 5, { driving: 2 }, { phaseTiming: timing })]);
    expect(focus?.timing).toEqual(timing);
    expect(focus?.timingRound).toEqual({ title: "with", createdAt: iso(5) });
  });

  it("has no timing for rounds saved without it", () => {
    expect(focusSkill([scored("a", 5, { driving: 1 })])).toMatchObject({ timing: null, timingRound: null });
  });
});

describe("gapForSkill", () => {
  const gap = (title: string, goodLooksLike: string, done = false) => ({ title, goodLooksLike, severity: "high" as const, done });

  it("finds the newest open gap that names the skill", () => {
    const history = [
      scored("old", 1, {}, { gaps: [gap("Driving the interview", "Name the next step")] }),
      scored("new", 6, {}, { gaps: [gap("Capacity math", "Numbers end in which means"), gap("Time driving", "Moves on at the plan time")] }),
    ];
    expect(gapForSkill(history, { id: "driving_time", name: "Driving" })?.gap.title).toBe("Time driving");
  });

  it("skips finished gaps and answers null when none matches", () => {
    const history = [scored("a", 6, {}, { gaps: [gap("Driving the interview", "x", true)] })];
    expect(gapForSkill(history, { id: "driving", name: "Driving" })).toBeNull();
    expect(gapForSkill([], { id: "driving", name: "Driving" })).toBeNull();
  });
});

describe("skillRows", () => {
  it("keeps the modes apart and orders dots oldest to newest", () => {
    const history = [scored("a", 1, { depth: 1, driving: 2 }), scored("b", 3, { depth: 2, driving: 2 }), scored("g", 4, { depth: 4, driving: 4 }, {}, "guided")];
    const interview = skillRows(history, "interview", [], NOW);
    expect(interview.rounds).toBe(2);
    expect(interview.rows.find((r) => r.id === "depth")).toMatchObject({ scores: [1, 2], latest: 2 });
    expect(skillRows(history, "guided", [], NOW).rows[0]).toMatchObject({ scores: [4], latest: 4 });
  });

  it("is empty with no scored round", () => {
    expect(skillRows([], "interview", [], NOW)).toEqual({ rows: [], rounds: 0 });
  });

  it("draws at most six rounds", () => {
    const history = Array.from({ length: 9 }, (_, i) => scored(`r${i}`, i + 1, { depth: (i % 4) + 1 }));
    expect(skillRows(history, "interview", [], NOW).rows[0]?.scores).toHaveLength(6);
  });
});

describe("gap rounds are not attempts", () => {
  it("leaves them out of the focus skill and the skill rows", () => {
    const history = [scored("real", 5, { depth: 3, driving: 2 }), scored("gap", 8, { depth: 1, driving: 1 }, { focus: true })];
    expect(focusSkill(history)).toMatchObject({ id: "driving", score: 2, roundsCounted: 1 });
    expect(skillRows(history, "interview", [], NOW).rounds).toBe(1);
  });

  it("does not take a gap from a gap round", () => {
    const gap = { title: "Driving the clock", goodLooksLike: "x", severity: "high" as const, done: false };
    expect(gapForSkill([scored("gap", 8, {}, { focus: true, gaps: [gap] })], { id: "driving", name: "Driving" })).toBeNull();
  });
});

describe("weekStats", () => {
  const plan = ["dsa", "hld", "dsa", "hld", "dsa", "lld", "redo"] as const;
  const now = new Date(2026, 10, 12, 9);

  it("counts planned rounds and redos from the plan", () => {
    expect(weekStats([], plan, now)).toEqual({ rounds: { done: 0, planned: 3 }, redos: { done: 0, planned: 1 } });
  });

  it("counts finished rounds this week, and a repeat of an earlier problem as a redo", () => {
    const history = [
      scored("first", 9, {}, { problemId: "url" }),
      scored("again", 11, {}, { problemId: "url" }),
      scored("other", 10, {}, { problemId: "cache" }),
      scored("last-week", 3, {}, { problemId: "feed" }),
      scored("open", 11, {}, { problemId: "chat", status: "paused" }),
      scored("failed", 11, {}, { problemId: "crawler", status: "failed" }),
    ];
    expect(weekStats(history, plan, now)).toEqual({ rounds: { done: 2, planned: 3 }, redos: { done: 1, planned: 1 } });
  });

  it("counts a repeat as a redo only when the earlier round was debriefed", () => {
    for (const status of ["paused", "live", "failed", "ended"] as const) {
      const history = [scored("early", 3, {}, { problemId: "url", status }), scored("later", 11, {}, { problemId: "url" })];
      expect(weekStats(history, plan, now)).toEqual({ rounds: { done: 1, planned: 3 }, redos: { done: 0, planned: 1 } });
    }
    const done = [scored("early", 3, {}, { problemId: "url" }), scored("later", 11, {}, { problemId: "url" })];
    expect(weekStats(done, plan, now).redos.done).toBe(1);
  });

  it("does not count a gap round, nor let one make a later round a redo", () => {
    const history = [scored("gap", 9, {}, { problemId: "url", focus: true }), scored("real", 11, {}, { problemId: "url" })];
    expect(weekStats(history, plan, now)).toEqual({ rounds: { done: 1, planned: 3 }, redos: { done: 0, planned: 1 } });
  });
});

const row = (phase: string, planned: number, actual: number) => ({ phase, label: phase, plannedMinutes: planned, actualMinutes: actual });

describe("focusFigure", () => {
  it("shows no number without timing, and never a zero", () => {
    expect(focusFigure(undefined)).toBeNull();
    expect(focusFigure(null)).toBeNull();
    expect(focusFigure([])).toBeNull();
    expect(focusFigure([row("a", 5, 0), row("b", 5, 0)])).toBeNull();
  });

  it("says where a round that ended early stopped, and how many steps were never reached", () => {
    const timing = [row("a", 5, 6), row("b", 10, 4), row("c", 10, 0), row("d", 10, 0), row("e", 10, 0)];
    expect(focusFigure(timing)).toMatchObject({ value: "10", unit: "of 45 min", note: "3 steps never reached", text: "Ended at 10 of 45 min. 3 steps never reached" });
    expect(focusFigure([row("a", 5, 6), row("b", 10, 4), row("c", 10, 0)])?.note).toBe("1 step never reached");
  });

  it("uses the mockup wording when the steps that ran went over their plan", () => {
    const timing = [row("a", 5, 20), row("b", 4, 21.8), row("c", 7, 12.2), row("d", 10, 0)];
    expect(focusFigure(timing)).toMatchObject({ value: "54", unit: "min", caption: "on the first 3 steps, plan 16", note: null });
  });

  it("says all steps when every step ran over", () => {
    expect(focusFigure([row("a", 5, 9), row("b", 5, 9)])?.caption).toBe("on all 2 steps, plan 10");
  });

  it("shows a plain figure for a round on plan", () => {
    expect(focusFigure([row("a", 5, 5), row("b", 5, 4.5)])).toMatchObject({ value: "9.5", caption: "used, plan 10" });
  });

  it("always pairs the value with words from the same case", () => {
    const cases = [
      [row("a", 5, 6), row("b", 10, 0)],
      [row("a", 5, 20), row("b", 10, 0)],
      [row("a", 5, 5), row("b", 10, 10)],
    ];
    for (const timing of cases) {
      const figure = focusFigure(timing)!;
      expect(Number(figure.value)).toBeGreaterThan(0);
      expect(figure.text).toContain(figure.value);
      expect(figure.text.startsWith("Ended at")).toBe(figure.note !== null);
    }
  });
});

describe("stepRows", () => {
  it("marks a step with no time as not reached, and flags only clear overruns", () => {
    const rows = stepRows([row("a", 5, 5.5), row("b", 4, 21.8), row("c", 5, 0)]);
    expect(rows.map((r) => [r.reached, r.over])).toEqual([
      [true, 0],
      [true, 17.8],
      [false, 0],
    ]);
  });
});

const point = (day: string, skill: string, score: number, extra: Partial<DrillPoint> = {}): DrillPoint => ({
  day,
  kind: "capacity",
  skill,
  score,
  outcome: "getting_there",
  firstTry: false,
  ...extra,
});

describe("skill level", () => {
  const rounds = [scored("a", 5, { depth: 2 }), scored("b", 6, { depth: 3 }), scored("c", 7, { depth: 3 }), scored("d", 8, { depth: 4 })];
  const level = (history: SessionHistoryItem[], points: DrillPoint[] = [], skill = "depth", mode: Mode = "interview") =>
    skillRows(history, mode, points, NOW).rows.find((r) => r.id === skill)?.level;

  it("is the mean of the newest three rounds when there is no drill", () => {
    expect(level(rounds)).toBe(3.3);
    expect(skillRows(rounds, "interview", [], NOW).rows[0]?.drills).toEqual([]);
  });

  it("adds each drill at a quarter of a round", () => {
    expect(skillLevel([3, 3, 3], [4, 4])).toBe(3.1);
    expect(level(rounds, [point("2026-11-19", "depth", 4), point("2026-11-19", "depth", 4)])).toBe(3.4);
  });

  it("weighs all drills as one round together once they pass the cap", () => {
    expect(skillLevel([2, 2, 2], [4, 4, 4, 4])).toBe(2.5);
    expect(skillLevel([2, 2, 2], [4, 4, 4, 4, 4, 4, 4, 4])).toBe(2.5);
    expect(skillLevel([2, 2, 2], [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4])).toBe(2.5);
    expect(skillLevel([2, 2, 2], [4, 4, 4])).toBe(2.4);
  });

  it("counts only drills of the last 30 days, today included", () => {
    const inside = point("2026-10-22", "depth", 4);
    const outside = point("2026-10-21", "depth", 1);
    expect(level(rounds, [inside])).toBe(3.4);
    expect(level(rounds, [outside])).toBe(3.3);
    expect(level(rounds, [inside, outside])).toBe(3.4);
  });

  it("reads only the newest three rounds that scored the skill", () => {
    const other = scored("e", 9, { driving: 1 });
    expect(level([...rounds, other])).toBe(3.3);
    expect(level([...rounds, other], [], "driving")).toBe(1);
    expect(level([scored("x", 2, { depth: 1 }), ...rounds])).toBe(3.3);
  });

  it("rounds to one decimal", () => {
    expect(level([scored("a", 5, { depth: 1 }), scored("b", 6, { depth: 1 }), scored("c", 7, { depth: 2 })])).toBe(1.3);
  });

  it("gives no row to a skill that has drills and no scored round", () => {
    const rows = skillRows(rounds, "interview", [point("2026-11-19", "navigation", 4)], NOW).rows;
    expect(rows.map((r) => r.id)).toEqual(["depth"]);
  });

  it("keeps the last eight drills of the skill, oldest first", () => {
    const points = Array.from({ length: 10 }, (_, i) => point(`2026-11-${String(i + 5).padStart(2, "0")}`, "depth", 3, { score: (i % 4) + 1 }));
    const drills = skillRows(rounds, "interview", points, NOW).rows[0]?.drills ?? [];
    expect(drills).toHaveLength(8);
    expect(drills[0]).toMatchObject({ day: "2026-11-07" });
    expect(drills.at(-1)).toMatchObject({ day: "2026-11-14", kind: "capacity", outcome: "getting_there" });
  });

  it("joins drills to interview rows only, and leaves guided rows rounds only", () => {
    const history = [...rounds, scored("g1", 9, { depth: 1 }, {}, "guided"), scored("g2", 10, { depth: 1 }, {}, "guided")];
    const drills = [point("2026-11-19", "depth", 4), point("2026-11-19", "depth", 4)];
    const interview = skillRows(history, "interview", drills, NOW).rows[0];
    const guided = skillRows(history, "guided", drills, NOW).rows[0];
    expect(interview).toMatchObject({ level: 3.4 });
    expect(interview?.drills).toHaveLength(2);
    expect(guided).toMatchObject({ level: 1, drills: [] });
  });

  it("joins drills to guided rows when there is no interview round", () => {
    const guided = [scored("g1", 9, { depth: 2 }, {}, "guided")];
    expect(level(guided, [point("2026-11-19", "depth", 4)], "depth", "guided")).toBe(2.4);
  });
});

describe("drillPoints", () => {
  const attempt = (extra: Partial<DrillAttempt> = {}): DrillAttempt => ({
    id: "0123456789abcdef",
    at: "2026-11-19T10:00:00.000Z",
    day: "2026-11-19",
    drill: "capacity",
    problemId: "c2-url-shortener",
    variant: null,
    drillId: null,
    status: "done",
    outcome: "ready",
    firstOutcome: null,
    revised: false,
    scores: [
      { id: "a", score: 4 },
      { id: "b", score: 3 },
      { id: "c", score: 3 },
      { id: "d", score: 2 },
    ],
    seconds: 60,
    legacy: false,
    ...extra,
  });
  const track = () => "hld" as const;

  it("takes the mean of the scores and the skill of the kind", () => {
    expect(drillPoints([attempt()], "2026-11-20", track)).toEqual([
      { day: "2026-11-19", kind: "capacity", skill: "scale_reliability", score: 3, outcome: "ready", firstTry: true },
    ]);
  });

  it("is not a first try after a revision, or when the result is not ready", () => {
    const [revised, notReady] = drillPoints([attempt({ revised: true }), attempt({ outcome: "getting_there" })], "2026-11-20", track);
    expect(revised?.firstTry).toBe(false);
    expect(notReady?.firstTry).toBe(false);
  });

  it("skips legacy, open and unscored rows", () => {
    const rows = [attempt({ legacy: true, scores: [] }), attempt({ status: "open", outcome: null, scores: [] }), attempt({ scores: [] })];
    expect(drillPoints(rows, "2026-11-20", track)).toEqual([]);
  });

  it("reads an old deep-dive row with three scores", () => {
    const old = attempt({
      drill: "deep_dive",
      scores: [
        { id: "naive", score: 3 },
        { id: "mechanism", score: 3 },
        { id: "cost", score: 2 },
      ],
    });
    expect(drillPoints([old], "2026-11-20", track)[0]).toMatchObject({ skill: "depth", score: 8 / 3 });
  });

  it("takes the track of the problem for the trade-off, and skips an attempt whose problem is gone", () => {
    const rows = [attempt({ drill: "tradeoff", problemId: "lld-1" }), attempt({ drill: "tradeoff", problemId: "hld-1" }), attempt({ drill: "tradeoff", problemId: "gone" })];
    const of = (id: string) => (id === "lld-1" ? ("lld" as const) : id === "hld-1" ? ("hld" as const) : null);
    expect(drillPoints(rows, "2026-11-20", of).map((p) => p.skill)).toEqual(["design", "depth"]);
  });

  it("keeps the last 90 days, at most 500, oldest first", () => {
    const rows = [attempt({ day: "2026-08-23" }), attempt({ day: "2026-08-22" }), attempt({ day: "2026-11-19" }), attempt({ day: "2026-10-01" })];
    expect(drillPoints(rows, "2026-11-20", track).map((p) => p.day)).toEqual(["2026-08-23", "2026-10-01", "2026-11-19"]);
    const many = Array.from({ length: 600 }, (_, i) => attempt({ day: i < 100 ? "2026-10-01" : "2026-11-19" }));
    const points = drillPoints(many, "2026-11-20", track);
    expect(points).toHaveLength(500);
    expect(points.every((p) => p.day === "2026-11-19")).toBe(true);
  });
});

describe("drillKindRows", () => {
  it("has a row for each kind that has attempts, in the order of the kinds", () => {
    const points = [point("2026-11-19", "design", 3, { kind: "walk" }), point("2026-11-19", "depth", 3, { kind: "capacity" })];
    expect(drillKindRows(points, "2026-11-20").map((r) => r.kind)).toEqual(["capacity", "walk"]);
    expect(drillKindRows([], "2026-11-20")).toEqual([]);
  });

  it("lists the last eight outcomes, oldest first, and counts the last 30 days", () => {
    const outcomes = ["needs_work", "getting_there", "ready"] as const;
    const points = Array.from({ length: 10 }, (_, i) =>
      point(`2026-11-${String(i + 5).padStart(2, "0")}`, "depth", 3, { outcome: outcomes[i % 3] ?? "ready", firstTry: i % 3 === 2 }),
    );
    const row = drillKindRows([point("2026-09-01", "depth", 3, { firstTry: true, outcome: "ready" }), ...points], "2026-11-20")[0];
    expect(row?.outcomes).toEqual(points.slice(-8).map((p) => p.outcome));
    expect(row?.recent).toBe(10);
    expect(row?.share).toBeCloseTo(0.3);
  });

  it("has no share when nothing is recent", () => {
    expect(drillKindRows([point("2026-09-01", "depth", 3)], "2026-11-20")[0]).toMatchObject({ recent: 0, share: null });
  });
});
