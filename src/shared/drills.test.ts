import { describe, expect, it } from "vitest";
import {
  DRILL_INFO,
  dueStatus,
  DRILL_TYPES,
  DrillReviseSchema,
  DrillSubmitSchema,
  DrillTargetSchema,
  DRILL_RUBRIC,
  OUTCOME_LABEL,
  READY_TO_CLOSE,
  betterOutcome,
  outcomeFor,
  addDays,
  applyOutcome,
  drillForGap,
  drillsForTrack,
  firstDueDay,
  isDue,
  localDay,
  proofKey,
  weekDrillStats,
} from "./drills";
import { DEFAULT_SETTINGS, ScorecardSchema, SettingsSchema } from "./types";

describe("drill catalogue", () => {
  it("has the five fixed kinds with their lengths", () => {
    expect(DRILL_TYPES).toEqual(["capacity", "walk", "requirements", "deep_dive", "lld_skeleton"]);
    expect(DRILL_TYPES.map((d) => DRILL_INFO[d].minutes)).toEqual([10, 10, 10, 15, 15]);
    expect(drillsForTrack("hld")).toEqual(["capacity", "walk", "requirements", "deep_dive"]);
    expect(drillsForTrack("lld")).toEqual(["lld_skeleton"]);
  });
});

describe("local days", () => {
  it("names the local calendar day, not the UTC one", () => {
    expect(localDay(new Date(2026, 10, 8, 23, 59, 59))).toBe("2026-11-08");
    expect(localDay(new Date(2026, 10, 9, 0, 0, 1))).toBe("2026-11-09");
  });

  it("adds days across month, year and leap boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2028-02-27", 3)).toBe("2028-03-01");
    expect(addDays("2026-11-08", 7)).toBe("2026-11-15");
  });

  it("never loses or gains a day when the clocks change", () => {
    // These spans hold a spring-forward and a fall-back in the zones that observe one.
    for (const [from, days] of [
      ["2026-03-07", 3],
      ["2026-03-28", 3],
      ["2026-10-24", 3],
      ["2026-10-31", 7],
      ["2026-11-01", 7],
    ] as const) {
      const out = addDays(from, days);
      const a = new Date(`${from}T12:00:00Z`).getTime();
      const b = new Date(`${out}T12:00:00Z`).getTime();
      expect((b - a) / 86_400_000).toBe(days);
    }
  });
});

describe("schedule", () => {
  const today = "2026-11-10";

  it("falls due the day after the debrief", () => {
    expect(firstDueDay("2026-11-09")).toBe("2026-11-10");
    expect(firstDueDay("2026-12-31")).toBe("2027-01-01");
  });

  const base = { passes: 0, readyOn: [] as string[], proof: "p1", canVary: true, today };

  it("a first-try ready result comes back in 3 days", () => {
    expect(applyOutcome({ ...base, outcome: "ready", revised: false })).toEqual({ passes: 1, readyOn: ["p1"], dueOn: "2026-11-13", status: "open" });
  });

  it("a second first-try ready result comes back in 7 days", () => {
    expect(applyOutcome({ ...base, passes: 1, readyOn: ["p1"], outcome: "ready", revised: false })).toEqual({ passes: 2, readyOn: ["p1"], dueOn: "2026-11-17", status: "open" });
  });

  it("the third first-try ready result closes the gap when two different proofs gave ready results", () => {
    const closed = applyOutcome({ ...base, passes: 2, readyOn: ["p0", "p1"], outcome: "ready", revised: false });
    expect(closed.passes).toBe(READY_TO_CLOSE);
    expect(closed.status).toBe("closed");
    expect(applyOutcome({ ...base, passes: 2, readyOn: ["p0"], outcome: "ready", revised: false })).toMatchObject({ passes: 3, status: "closed" });
  });

  it("the third ready result on one proof only holds the count at 2 and comes back in 3 days", () => {
    expect(applyOutcome({ ...base, passes: 2, readyOn: ["p1"], outcome: "ready", revised: false })).toEqual({ passes: 2, readyOn: ["p1"], dueOn: "2026-11-13", status: "open" });
  });

  it("closes on one proof when the picker has nothing else to offer", () => {
    expect(applyOutcome({ ...base, passes: 2, readyOn: ["p1"], canVary: false, outcome: "ready", revised: false })).toMatchObject({ passes: 3, status: "closed" });
  });

  it("counts a changed-constraint proof as different from its problem", () => {
    const next = applyOutcome({ ...base, passes: 2, readyOn: ["p1"], proof: proofKey("p1", "hot-link"), outcome: "ready", revised: false });
    expect(next).toMatchObject({ passes: 3, status: "closed", readyOn: ["p1", "p1#hot-link"] });
  });

  it("builds a proof key from the problem and the variant", () => {
    expect(proofKey("p1", null)).toBe("p1");
    expect(proofKey("p1", "hot-link")).toBe("p1#hot-link");
  });

  it("remembers each problem once on the ready list", () => {
    expect(applyOutcome({ ...base, passes: 1, readyOn: ["p0"], outcome: "ready", revised: false }).readyOn).toEqual(["p0", "p1"]);
    expect(applyOutcome({ ...base, passes: 1, readyOn: ["p1"], outcome: "ready", revised: false }).readyOn).toEqual(["p1"]);
  });

  it("a ready result after a revision counts, comes back in 2 days and stops at 2", () => {
    expect(applyOutcome({ ...base, outcome: "ready", revised: true })).toEqual({ passes: 1, readyOn: ["p1"], dueOn: "2026-11-12", status: "open" });
    expect(applyOutcome({ ...base, passes: 1, outcome: "ready", revised: true }).passes).toBe(2);
    expect(applyOutcome({ ...base, passes: 2, outcome: "ready", revised: true })).toMatchObject({ passes: 2, status: "open", dueOn: "2026-11-12" });
  });

  it.each([0, 1, 2])("getting there after %s ready results keeps the count and returns in 2 days", (passes) => {
    expect(applyOutcome({ ...base, passes, readyOn: ["p0"], outcome: "getting_there", revised: false })).toEqual({ passes, readyOn: ["p0"], dueOn: "2026-11-12", status: "open" });
  });

  it.each([0, 1, 2])("needs work after %s ready results resets the count, empties the list and returns tomorrow", (passes) => {
    expect(applyOutcome({ ...base, passes, readyOn: ["p0"], outcome: "needs_work", revised: false })).toEqual({ passes: 0, readyOn: [], dueOn: "2026-11-11", status: "open" });
  });

  it("counts from the day of the attempt, in local time, across a month end", () => {
    expect(applyOutcome({ ...base, today: "2026-10-30", outcome: "ready", revised: false }).dueOn).toBe("2026-11-02");
    expect(applyOutcome({ ...base, today: "2026-12-28", passes: 1, outcome: "ready", revised: false }).dueOn).toBe("2027-01-04");
    expect(applyOutcome({ ...base, today: "2026-12-31", outcome: "needs_work", revised: false }).dueOn).toBe("2027-01-01");
  });

  it("a drill is due on its day and after, never when closed", () => {
    expect(isDue({ dueOn: "2026-11-10", status: "open" }, "2026-11-10")).toBe(true);
    expect(isDue({ dueOn: "2026-11-09", status: "open" }, "2026-11-10")).toBe(true);
    expect(isDue({ dueOn: "2026-11-11", status: "open" }, "2026-11-10")).toBe(false);
    expect(isDue({ dueOn: "2026-11-09", status: "closed" }, "2026-11-10")).toBe(false);
  });
});

describe("gap to drill", () => {
  it("takes the judge's drill when it fits the track", () => {
    expect(drillForGap({ title: "Anything at all", drill: "walk" }, "hld")).toBe("walk");
    expect(drillForGap({ title: "Anything at all", drill: "lld_skeleton" }, "lld")).toBe("lld_skeleton");
  });

  it("ignores a judge drill that does not fit the track and falls back to the words", () => {
    expect(drillForGap({ title: "Capacity math that changes the design", drill: "lld_skeleton" }, "hld")).toBe("capacity");
    expect(drillForGap({ title: "Nothing relevant here", drill: "capacity" }, "lld")).toBeNull();
  });

  it.each([
    ["Capacity math that changes the design", "capacity"],
    ["No back-of-the-envelope estimate of QPS", "capacity"],
    ["Deep dive on the hardest requirement", "deep_dive"],
    ["Skipped clarifying requirements", "requirements"],
    ["Scope and non-functional requirements were never settled", "requirements"],
    ["Never walked one request end to end", "walk"],
    ["Cache stampede on a viral link", "deep_dive"],
    ["Replica lag and consistency for new writes", "deep_dive"],
    ["Capacity math done without prompting, each number ending in a design consequence", "capacity"],
    ["Walking one request through every box, including the miss path", "walk"],
    ["Caching a viral link: TTLs, hot keys and stampede", "deep_dive"],
    ["Batching click counts off the redirect path", "deep_dive"],
  ] as const)("maps the HLD gap %j to %s", (title, drill) => {
    expect(drillForGap({ title }, "hld")).toBe(drill);
  });

  it("queues nothing for a gap about pacing or leading the round, whatever its reason says", () => {
    expect(drillForGap({ title: "Phase pacing and leading the round", whyItMatters: "Capacity took 22 minutes and requirements 17." }, "hld")).toBeNull();
    expect(drillForGap({ title: "Time management in the demo" }, "lld")).toBeNull();
  });

  it("reads the reason only when the title says nothing", () => {
    expect(drillForGap({ title: "Weak opening", whyItMatters: "You never estimated the QPS or the storage." }, "hld")).toBe("capacity");
    expect(drillForGap({ title: "Capacity math", whyItMatters: "Walk a request through every box." }, "hld")).toBe("capacity");
  });

  it("returns null when nothing fits", () => {
    expect(drillForGap({ title: "Communication was hard to follow", whyItMatters: "Speak in short, clear steps." }, "hld")).toBeNull();
    expect(drillForGap({ title: "Something vague" }, "hld")).toBeNull();
  });

  it.each([
    ["Spot and Ticket entities were hidden in nested maps", "lld_skeleton"],
    ["Pricing is not a separate strategy class", "lld_skeleton"],
  ] as const)("maps the LLD gap %j to %s", (title, drill) => {
    expect(drillForGap({ title }, "lld")).toBe(drill);
  });

  it("gives an LLD gap with no design words no drill", () => {
    expect(drillForGap({ title: "Ran out of time before the demo" }, "lld")).toBeNull();
    expect(drillForGap({ title: "Missed the data race on exit" }, "lld")).toBeNull();
  });
});

describe("week stats", () => {
  const now = new Date(2026, 10, 11, 10, 0, 0); // Wednesday
  it("counts interview-ready of attempted in the local week, Monday first", () => {
    const attempts = [
      { day: "2026-11-08", status: "done" as const, outcome: "ready" as const }, // Sunday before
      { day: "2026-11-09", status: "done" as const, outcome: "ready" as const },
      { day: "2026-11-10", status: "done" as const, outcome: "needs_work" as const },
      { day: "2026-11-10", status: "open" as const, outcome: null },
      { day: "2026-11-15", status: "done" as const, outcome: "ready" as const },
      { day: "2026-11-16", status: "done" as const, outcome: "ready" as const }, // next Monday
    ];
    expect(weekDrillStats(attempts, now)).toEqual({ ready: 2, attempted: 3 });
  });
  it("is zero with no attempts", () => {
    expect(weekDrillStats([], now)).toEqual({ ready: 0, attempted: 0 });
  });
});

describe("request schemas", () => {
  const good = { drill: "capacity", problemId: "c2-url-shortener" };
  it("accepts a free target and a queued one", () => {
    expect(DrillTargetSchema.safeParse(good).success).toBe(true);
    expect(DrillTargetSchema.safeParse({ ...good, drillId: "0123456789abcdef" }).success).toBe(true);
  });
  it.each([
    ["an unknown key", { ...good, extra: 1 }],
    ["an unknown drill", { ...good, drill: "juggling" }],
    ["a problem id with a slash", { ...good, problemId: "../etc/passwd" }],
    ["a problem id in capitals", { ...good, problemId: "C2" }],
    ["a short drill id", { ...good, drillId: "abc" }],
    ["a drill id with a path", { ...good, drillId: "../../session.jsn" }],
  ])("rejects %s", (_n, body) => {
    expect(DrillTargetSchema.safeParse(body).success).toBe(false);
  });
  it("rejects an empty, blank or oversized answer and unknown keys", () => {
    expect(DrillSubmitSchema.safeParse({ ...good, answer: "ok" }).success).toBe(true);
    expect(DrillSubmitSchema.safeParse({ ...good, answer: "" }).success).toBe(false);
    expect(DrillSubmitSchema.safeParse({ ...good, answer: "  \n " }).success).toBe(false);
    expect(DrillSubmitSchema.safeParse({ ...good, answer: "x".repeat(8001) }).success).toBe(false);
    expect(DrillSubmitSchema.safeParse({ ...good, answer: "ok", extra: 1 }).success).toBe(false);
  });
  it("takes a changed-constraint id, null or nothing, and rejects anything else", () => {
    for (const variant of [undefined, null, "global-latency", "a"]) expect(DrillSubmitSchema.safeParse({ ...good, answer: "ok", variant }).success).toBe(true);
    for (const variant of ["", "Global Latency", "-x", "../x", "a/b", "a".repeat(81), 3])
      expect(DrillSubmitSchema.safeParse({ ...good, answer: "ok", variant }).success, String(variant)).toBe(false);
  });
});

describe("grader setting", () => {
  it("loads a settings file saved before the grader existed, with Sonnet and medium effort", () => {
    const { grader: _m, ...models } = DEFAULT_SETTINGS.models;
    const { grader: _e, ...effort } = DEFAULT_SETTINGS.effort;
    const parsed = SettingsSchema.parse({ ...DEFAULT_SETTINGS, models, effort });
    expect(parsed.models.grader).toBe("claude-sonnet-5-5");
    expect(parsed.effort.grader).toBe("medium");
  });
});

describe("scorecard gap drill field", () => {
  const gap = { title: "t", severity: "high" as const, whyItMatters: "w", whatGoodLooksLike: "g", teachMinutes: 5 };
  const gapSchema = ScorecardSchema.shape.gaps.element;
  it("is optional, so scorecards without it still load", () => {
    expect(gapSchema.safeParse(gap).success).toBe(true);
  });
  it("accepts each drill kind and nothing else", () => {
    for (const drill of DRILL_TYPES) expect(gapSchema.safeParse({ ...gap, drill }).success).toBe(true);
    expect(gapSchema.safeParse({ ...gap, drill: "juggling" }).success).toBe(false);
    expect(gapSchema.safeParse({ ...gap, drill: null }).success).toBe(false);
  });
});

describe("due wording", () => {
  const today = "2026-11-08";
  it("reads as a status, not a past date", () => {
    expect(dueStatus("2026-11-08", today)).toEqual({ label: "Due today", tone: "due" });
    expect(dueStatus("2026-11-02", today)).toEqual({ label: "Overdue", since: "2026-11-02", tone: "overdue" });
    expect(dueStatus("2026-11-09", today)).toEqual({ label: "Tomorrow", tone: "later" });
    expect(dueStatus("2026-11-12", today)).toEqual({ label: "2026-11-12", tone: "later" });
    expect(dueStatus("2027-01-01", "2026-12-31").label).toBe("Tomorrow");
  });
});

describe("revise schema", () => {
  const good = { attemptId: "0123456789abcdef", answer: "better" };
  it("accepts a revision with or without the time", () => {
    expect(DrillReviseSchema.safeParse(good).success).toBe(true);
    expect(DrillReviseSchema.safeParse({ ...good, elapsedSeconds: 30 }).success).toBe(true);
  });
  it.each([
    ["an unknown key", { ...good, extra: 1 }],
    ["a path in the id", { ...good, attemptId: "../../x" }],
    ["a short id", { ...good, attemptId: "abc" }],
    ["a blank answer", { ...good, answer: "  " }],
    ["an answer over 8000 characters", { ...good, answer: "x".repeat(8001) }],
    ["a negative time", { ...good, elapsedSeconds: -1 }],
    ["a time over two hours", { ...good, elapsedSeconds: 7201 }],
    ["a missing id", { answer: "x" }],
  ])("rejects %s", (_n, body) => {
    expect(DrillReviseSchema.safeParse(body).success).toBe(false);
  });
});

describe("rubric and outcome", () => {
  it("names the criteria and the skill of every kind", () => {
    expect(DRILL_TYPES.map((d) => [DRILL_RUBRIC[d].skill, DRILL_RUBRIC[d].criteria.length, DRILL_RUBRIC[d].criteria.filter((k) => k.core).length])).toEqual([
      ["scale_reliability", 4, 3],
      ["design", 4, 2],
      ["navigation", 4, 3],
      ["depth", 3, 2],
      ["design", 5, 3],
    ]);
    expect(OUTCOME_LABEL).toEqual({ ready: "Interview-ready", getting_there: "Getting there", needs_work: "Needs work" });
  });

  describe.each(DRILL_TYPES)("%s", (drill) => {
    const criteria = DRILL_RUBRIC[drill].criteria;
    const core = criteria.filter((k) => k.core);
    const noncore = criteria.filter((k) => !k.core);
    const set = (base: number, change: Record<string, number>) => criteria.map((k) => ({ id: k.id, score: change[k.id] ?? base }));
    const c0 = core[0]?.id ?? "";
    const c1 = core[1]?.id ?? "";

    it("is ready when every core criterion is 3 or more and none is 1", () => {
      expect(outcomeFor(drill, set(3, {}))).toBe("ready");
      expect(outcomeFor(drill, set(4, {}))).toBe("ready");
      for (const k of noncore) expect(outcomeFor(drill, set(3, { [k.id]: 2 }))).toBe("ready");
    });

    it("is getting there when a non-core criterion is 1 and the core ones are fine", () => {
      for (const k of noncore) expect(outcomeFor(drill, set(3, { [k.id]: 1 }))).toBe("getting_there");
    });

    it("is getting there when exactly one core criterion is 2", () => {
      expect(outcomeFor(drill, set(3, { [c0]: 2 }))).toBe("getting_there");
    });

    it("needs work when a core criterion is 1", () => {
      expect(outcomeFor(drill, set(4, { [c0]: 1 }))).toBe("needs_work");
    });

    it("needs work when two core criteria are below 3", () => {
      expect(outcomeFor(drill, set(4, { [c0]: 2, [c1]: 2 }))).toBe("needs_work");
    });

    it("counts a missing score as 1", () => {
      expect(outcomeFor(drill, [])).toBe("needs_work");
    });
  });

  it("picks the better outcome and keeps the first on a tie", () => {
    expect(betterOutcome("needs_work", "getting_there")).toBe("getting_there");
    expect(betterOutcome("ready", "needs_work")).toBe("ready");
    expect(betterOutcome("getting_there", "getting_there")).toBe("getting_there");
  });
});
