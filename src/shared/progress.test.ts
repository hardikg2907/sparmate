import { describe, expect, it } from "vitest";
import { focusSkill, gapForSkill, skillRows, weekStats } from "./progress";
import type { Mode } from "./phases";
import type { SessionHistoryItem } from "./types";

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

  it("carries the step timing of the newest counted round that has it, and the minutes over plan", () => {
    const timing = [
      { phase: "requirements", label: "Requirements", plannedMinutes: 5, actualMinutes: 7.4 },
      { phase: "capacity", label: "Capacity math", plannedMinutes: 4, actualMinutes: 3 },
    ];
    const focus = focusSkill([scored("new", 7, { driving: 1 }), scored("with", 5, { driving: 2 }, { phaseTiming: timing })]);
    expect(focus?.timing).toEqual(timing);
    expect(focus?.minutesOver).toBe(2);
  });

  it("has no timing for rounds saved without it", () => {
    expect(focusSkill([scored("a", 5, { driving: 1 })])).toMatchObject({ timing: null, minutesOver: null });
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
    const interview = skillRows(history, "interview");
    expect(interview.rounds).toBe(2);
    expect(interview.rows.find((r) => r.id === "depth")).toMatchObject({ scores: [1, 2], latest: 2 });
    expect(skillRows(history, "guided").rows[0]).toMatchObject({ scores: [4], latest: 4 });
  });

  it("is empty with no scored round", () => {
    expect(skillRows([], "interview")).toEqual({ rows: [], rounds: 0 });
  });

  it("draws at most six rounds", () => {
    const history = Array.from({ length: 9 }, (_, i) => scored(`r${i}`, i + 1, { depth: (i % 4) + 1 }));
    expect(skillRows(history, "interview").rows[0]?.scores).toHaveLength(6);
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
});
