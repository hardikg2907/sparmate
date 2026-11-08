import { describe, expect, it } from "vitest";
import {
  DRILL_INFO,
  DRILL_TYPES,
  DrillSubmitSchema,
  DrillTargetSchema,
  PASSES_TO_CLOSE,
  addDays,
  applyVerdict,
  drillForGap,
  drillsForTrack,
  firstDueDay,
  isDue,
  localDay,
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

  it("a first pass comes back in 3 days", () => {
    expect(applyVerdict({ passes: 0 }, "pass", today)).toEqual({ passes: 1, dueOn: "2026-11-13", status: "open" });
  });

  it("a second pass comes back in 7 days", () => {
    expect(applyVerdict({ passes: 1 }, "pass", today)).toEqual({ passes: 2, dueOn: "2026-11-17", status: "open" });
  });

  it("three passes in a row close the gap", () => {
    const closed = applyVerdict({ passes: 2 }, "pass", today);
    expect(closed.passes).toBe(PASSES_TO_CLOSE);
    expect(closed.status).toBe("closed");
  });

  it.each([0, 1, 2])("a Not yet after %s passes resets the count and returns tomorrow", (passes) => {
    expect(applyVerdict({ passes }, "not_yet", today)).toEqual({ passes: 0, dueOn: "2026-11-11", status: "open" });
  });

  it("counts from the day of the attempt, in local time, across a month end", () => {
    expect(applyVerdict({ passes: 0 }, "pass", "2026-10-30").dueOn).toBe("2026-11-02");
    expect(applyVerdict({ passes: 1 }, "pass", "2026-12-28").dueOn).toBe("2027-01-04");
    expect(applyVerdict({ passes: 0 }, "not_yet", "2026-12-31").dueOn).toBe("2027-01-01");
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
  ] as const)("maps the HLD gap %j to %s", (title, drill) => {
    expect(drillForGap({ title }, "hld")).toBe(drill);
  });

  it("reads the good-looks-like text only when the title says nothing", () => {
    expect(drillForGap({ title: "Weak opening", goodLooksLike: "Ask about scale, then estimate the QPS and storage." }, "hld")).toBe("capacity");
    expect(drillForGap({ title: "Capacity math", goodLooksLike: "Walk a request through every box." }, "hld")).toBe("capacity");
  });

  it("returns null when nothing fits", () => {
    expect(drillForGap({ title: "Communication was hard to follow", goodLooksLike: "Speak in short, clear steps." }, "hld")).toBeNull();
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
  it("counts passed of attempted in the local week, Monday first", () => {
    const attempts = [
      { day: "2026-11-08", verdict: "pass" as const }, // Sunday before
      { day: "2026-11-09", verdict: "pass" as const },
      { day: "2026-11-10", verdict: "not_yet" as const },
      { day: "2026-11-15", verdict: "pass" as const },
      { day: "2026-11-16", verdict: "pass" as const }, // next Monday
    ];
    expect(weekDrillStats(attempts, now)).toEqual({ passed: 2, attempted: 3 });
  });
  it("is zero with no attempts", () => {
    expect(weekDrillStats([], now)).toEqual({ passed: 0, attempted: 0 });
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
