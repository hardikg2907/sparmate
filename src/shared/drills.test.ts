import { describe, expect, it } from "vitest";
import {
  DRILL_INFO,
  dueStatus,
  DRILL_TYPES,
  DrillAbandonSchema,
  DrillReplySchema,
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
  drillSkill,
  drillServesTrack,
  MAX_FOLLOW_UPS,
  MAX_TOPIC_CHARS,
  drillsForTrack,
  firstDueDay,
  isDue,
  localDay,
  proofKey,
  weekDrillStats,
} from "./drills";
import { DEFAULT_SETTINGS, ScorecardSchema, SettingsSchema } from "./types";

describe("drill catalogue", () => {
  it("has the six fixed kinds with their lengths", () => {
    expect(DRILL_TYPES).toEqual(["capacity", "walk", "requirements", "deep_dive", "tradeoff", "lld_skeleton"]);
    expect(DRILL_TYPES.map((d) => DRILL_INFO[d].minutes)).toEqual([10, 10, 10, 15, 15, 15]);
  });

  it("lists the kinds of each track, and the trade-off serves both", () => {
    expect(drillsForTrack("hld")).toEqual(["capacity", "walk", "requirements", "deep_dive", "tradeoff"]);
    expect(drillsForTrack("lld")).toEqual(["tradeoff", "lld_skeleton"]);
    expect(DRILL_INFO.tradeoff).toMatchObject({ title: "Defend a trade-off", tracks: ["hld", "lld"], about: "Pick a side of one design choice and hold it under questions." });
    expect(drillServesTrack("tradeoff", "lld")).toBe(true);
    expect(drillServesTrack("capacity", "lld")).toBe(false);
  });

  it("runs the deep dive and the trade-off as a dialogue, and nothing else", () => {
    expect(DRILL_TYPES.filter((d) => DRILL_INFO[d].dialogue)).toEqual(["deep_dive", "tradeoff"]);
    expect(MAX_FOLLOW_UPS).toBe(2);
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
    expect(drillForGap({ title: "Something vague" }, "hld")).toBeNull();
    expect(drillForGap({ title: "Something vague" }, "lld")).toBeNull();
  });

  it.each([
    ["Trade-offs between a queue and a direct call were not discussed", "tradeoff"],
    ["Picked a database without justification", "tradeoff"],
    ["No alternatives were weighed for the id scheme", "tradeoff"],
    ["Chose the storage engine without a reason", "tradeoff"],
    ["Design choice made with no reason given", "tradeoff"],
    ["Trade-off on caching the redirect", "tradeoff"],
  ] as const)("maps the HLD gap %j to the trade-off drill", (title, drill) => {
    expect(drillForGap({ title }, "hld")).toBe(drill);
  });

  it("keeps the deep-dive rule for gaps about a mechanism, not a choice", () => {
    expect(drillForGap({ title: "Cache stampede on a viral link" }, "hld")).toBe("deep_dive");
    expect(drillForGap({ title: "Retry storms after a failover" }, "hld")).toBe("deep_dive");
  });

  it.each([
    ["Communication was hard to follow", "hld"],
    ["Communication was hard to follow", "lld"],
    ["Did not explain the design clearly", "hld"],
    ["Explaining the design in plain words", "lld"],
  ] as const)("maps the communication gap %j on %s to the trade-off drill", (title, track) => {
    expect(drillForGap({ title }, track)).toBe("tradeoff");
  });

  it.each([
    ["Explaining capacity math out loud", "hld", "capacity"],
    ["Could not explain the read path", "hld", "walk"],
    ["Requirements not explained before designing", "hld", "requirements"],
    ["Did not explain how the cache stays consistent", "hld", "deep_dive"],
    ["No explanation of failure handling", "hld", "deep_dive"],
    ["Did not explain the class relationships", "lld", "lld_skeleton"],
    ["Explain the entities before coding", "lld", "lld_skeleton"],
  ] as const)("keeps the topic of %j on %s: the communication rule is the last resort", (title, track, drill) => {
    expect(drillForGap({ title }, track)).toBe(drill);
  });

  it.each(["communicate", "communication", "articulate", "explain", "explaining", "explanation"])("treats the word %s alike as a communication gap", (word) => {
    expect(drillForGap({ title: `Weak ${word} of the design` }, "hld")).toBe("tradeoff");
    expect(drillForGap({ title: `Weak ${word} of the design` }, "lld")).toBe("tradeoff");
  });

  it("reads a communication gap by its title only, and the trade-off rule by its title only", () => {
    expect(drillForGap({ title: "Surface-level design", whyItMatters: "You did not explain the choice." }, "hld")).toBeNull();
    expect(drillForGap({ title: "Stopping at the first answer", whyItMatters: "You need to justify the cache." }, "hld")).toBe("deep_dive");
    expect(drillForGap({ title: "Hand-waving on the hard part", whyItMatters: "Without a trade-off discussion, the sharding choice looks arbitrary." }, "hld")).toBe("deep_dive");
    expect(drillForGap({ title: "Weak design of vehicle types", whyItMatters: "A new vehicle type needs a new pattern or strategy." }, "lld")).toBeNull();
  });

  it("still queues nothing for pacing, time or driving the round, even with communication words", () => {
    expect(drillForGap({ title: "Pacing and communication in the middle phases" }, "hld")).toBeNull();
    expect(drillForGap({ title: "Time management" }, "lld")).toBeNull();
    expect(drillForGap({ title: "Did not drive the interview" }, "hld")).toBeNull();
    expect(drillForGap({ title: "Spent too long on requirements: pacing" }, "hld")).toBeNull();
  });

  it.each([
    ["Freezing for ten minutes, then staying in the round when stuck", "walk"],
    ["Staying on the question that was asked", "tradeoff"],
    ["Leaving spare minutes unspent: using the round's time", "tradeoff"],
    ["Holding the scoping step to its time box", "requirements"],
    ["Spending the remaining minutes well after the demo", "deep_dive"],
    ["Unused round time after the extension", "walk"],
  ] as const)("queues no drill for the round-running gap %s, even when the judge chose %s", (title, drill) => {
    expect(drillForGap({ title, drill }, "hld")).toBeNull();
    expect(drillForGap({ title, drill: "tradeoff" }, "lld")).toBeNull();
  });

  it.each([
    ["Replying to half of a two-part question, and staying on the question", "Splitting the reply between the cache and the queue left the latency question open.", null],
    ["A clear job for each box, then the slowest bottleneck", "The worker box had no job and the queue latency was never named.", "walk"],
    ["Payment intake with a durable accept path", "A crash after the reply loses the order, because nothing durable holds it before the queue.", "walk"],
    ["Answering all three probes before the clock ran out", "The failover question and the cache question got no answer.", null],
  ] as const)("never sends %s to a deep dive the judge did not choose", (title, whyItMatters, drill) => {
    expect(drillForGap({ title, whyItMatters }, "hld")).toBe(drill);
  });

  it("queues nothing for a gap the judge marked as about the round, whatever else it says", () => {
    expect(drillForGap({ title: "Cache stampede on a viral link", drill: "deep_dive", aboutTheRound: true }, "hld")).toBeNull();
    expect(drillForGap({ title: "Cache stampede on a viral link", aboutTheRound: false }, "hld")).toBe("deep_dive");
  });

  it.each([
    "Ran out of time before the deep dive",
    "Ran long on requirements",
    "Twenty minutes on requirements",
    "Spending too long on capacity math",
    "Setting a steady pace through the middle steps",
  ])("queues nothing for the round-running gap %s when the judge chose no drill", (title) => {
    expect(drillForGap({ title }, "hld")).toBeNull();
  });

  it.each(["Left the curveball unanswered", "Leaving fifteen minutes unused", "Finished with time to spare", "Stayed on the question only after a nudge"])(
    "overrules the judge's drill for the round-running gap %s",
    (title) => {
      expect(drillForGap({ title, drill: "deep_dive" }, "hld")).toBeNull();
    },
  );

  it.each([
    "Broadcast with no pacing or cancel",
    "Per-host crawl pace and politeness",
    "Recovering workers when stuck on a lock",
    "Answering every read from the cache",
    "Reclaiming unused time slots in the calendar",
    "Refresh using remaining time-to-live",
    "Matching the producer to the consumer's pace",
    "Time-boxed leases for the lock",
  ])("keeps the judge's drill for the design gap %s, which shares words with round-running gaps", (title) => {
    expect(drillForGap({ title, drill: "deep_dive" }, "hld")).toBe("deep_dive");
  });

  it.each([
    "Jobs running long past their timeout",
    "Driver offers left unanswered",
    "Provider calls that go unanswered",
    "Requests that spend too long in the queue",
    "Authorisation holds that run out of time before capture",
    "Election rounds time out under partition",
    "Counting requests inside a time box per key",
    "Reserved minutes unused at checkout",
    "Stalled consumers on a hot partition",
  ])("keeps the judge's drill for the design gap %s", (title) => {
    expect(drillForGap({ title, drill: "deep_dive" }, "hld")).toBe("deep_dive");
  });

  it.each([
    "Twenty minutes on requirements",
    "Spent 20 minutes on capacity",
    "Rushed the deep dive",
    "Never got to the deep dive",
    "Timed out before the deep dive",
    "Too much time on requirements",
    "Requirements step ran over",
    "Ran over time on capacity",
    "Capacity math took half of the round",
    "Didn't get to the extension",
  ])("overrules the judge's drill for the step-timing gap %s", (title) => {
    expect(drillForGap({ title, drill: "deep_dive" }, "hld")).toBeNull();
    expect(drillForGap({ title, drill: "tradeoff" }, "lld")).toBeNull();
  });

  it.each(["Stalled when pushed on sharding", "Out of time before failure handling", "Over-long capacity step"])(
    "queues nothing for the likely round gap %s when the judge chose no drill",
    (title) => {
      expect(drillForGap({ title }, "hld")).toBeNull();
    },
  );

  it("reads the capacity verbs in any tense, in the title only", () => {
    for (const title of ["Numbers that decided nothing", "Numbers that shaped nothing", "Numbers that drove no decision"]) {
      expect(drillForGap({ title }, "hld"), title).toBe("capacity");
    }
    expect(drillForGap({ title: "Order number generation", whyItMatters: "Numbers must be unique and decide ordering." }, "hld")).toBeNull();
  });

  it("reads the capacity words as whole words", () => {
    expect(drillForGap({ title: "Matching riders to nearby drivers", whyItMatters: "A number of drivers move at once." }, "hld")).toBeNull();
    expect(drillForGap({ title: "Response data shape for the feed" }, "hld")).toBeNull();
    expect(drillForGap({ title: "Naming the numbers that drive the shard count" }, "hld")).toBe("capacity");
  });

  it("reads the broad deep-dive words in the title only", () => {
    expect(drillForGap({ title: "Short reasons for the schema", whyItMatters: "The cache and the shard key were never tied to a number." }, "hld")).toBeNull();
    expect(drillForGap({ title: "Duplicate sends across a slow provider" }, "hld")).toBe("deep_dive");
    expect(drillForGap({ title: "Exactly-once billing across a remote call" }, "hld")).toBe("deep_dive");
  });

  it.each([
    ["Every box with a purpose in the order flow", "walk"],
    ["Seat holds and the missing-key path", "walk"],
    ["Payment intake with a durable accept path", "walk"],
    ["Asking for the numbers that shape the store", "capacity"],
    ["Choosing the eviction policy with a reason", "tradeoff"],
    ["Choosing the matching algorithm by its slowest hour", "tradeoff"],
  ] as const)("maps %s to %s on system design", (title, drill) => {
    expect(drillForGap({ title }, "hld")).toBe(drill);
  });

  it("maps a machine coding gap about the extension or a choice to the trade-off drill", () => {
    expect(drillForGap({ title: "Refund design choice settled only once the interviewer listed both" }, "lld")).toBe("tradeoff");
    expect(drillForGap({ title: "Extensibility of the fee rules" }, "lld")).toBe("tradeoff");
    expect(drillForGap({ title: "Extension handled by a new branch in every method" }, "lld")).toBe("tradeoff");
    expect(drillForGap({ title: "Never reached the extension" }, "lld")).toBeNull();
    expect(drillForGap({ title: "Ran out of time before the extension", drill: "tradeoff" }, "lld")).toBeNull();
  });

  it.each(["Using time windows instead of a sliding log", "Use time-to-live on the dedup key", "Using the clock of one server to order events"])(
    "keeps the judge's drill for the design gap %s, where time is the topic",
    (title) => {
      expect(drillForGap({ title, drill: "deep_dive" }, "hld")).toBe("deep_dive");
    },
  );

  it("takes the judge's trade-off on both tracks", () => {
    expect(drillForGap({ title: "Anything at all", drill: "tradeoff" }, "hld")).toBe("tradeoff");
    expect(drillForGap({ title: "Anything at all", drill: "tradeoff" }, "lld")).toBe("tradeoff");
  });

  it.each([
    ["Spot and Ticket entities were hidden in nested maps", "lld_skeleton"],
    ["Parking spot class holds the whole relationship model", "lld_skeleton"],
    ["Pricing is not a separate strategy class", "tradeoff"],
    ["No design pattern for the pricing rules", "tradeoff"],
    ["The design is hard to extend: extensibility was missing", "tradeoff"],
    ["Trade-off between inheritance and composition", "tradeoff"],
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
  it("takes a topic of up to the cap, and rejects an empty, long or non-text one", () => {
    for (const topic of [undefined, "Storage", "x".repeat(MAX_TOPIC_CHARS)]) expect(DrillSubmitSchema.safeParse({ ...good, answer: "ok", topic }).success).toBe(true);
    for (const topic of ["", "x".repeat(MAX_TOPIC_CHARS + 1), 3, null]) expect(DrillSubmitSchema.safeParse({ ...good, answer: "ok", topic }).success, String(topic)).toBe(false);
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
      ["depth", 4, 3],
      ["depth", 4, 3],
      ["design", 5, 3],
    ]);
    expect(OUTCOME_LABEL).toEqual({ ready: "Interview-ready", getting_there: "Getting there", needs_work: "Needs work" });
  });

  it("names the trade-off criteria, and trains depth on system design and design on machine coding", () => {
    expect(DRILL_RUBRIC.tradeoff.criteria.map((k) => [k.id, k.core])).toEqual([
      ["position", true],
      ["reason", true],
      ["other_side", false],
      ["holds", true],
    ]);
    expect(drillSkill("tradeoff", "hld")).toBe("depth");
    expect(drillSkill("tradeoff", "lld")).toBe("design");
    expect(drillSkill("lld_skeleton", "lld")).toBe("design");
    expect(drillSkill("capacity", "hld")).toBe("scale_reliability");
  });

  it("gives the deep dive a core follow-up criterion", () => {
    expect(DRILL_RUBRIC.deep_dive.criteria.map((k) => [k.id, k.core])).toEqual([
      ["naive", true],
      ["mechanism", true],
      ["cost", false],
      ["follow_up", true],
    ]);
  });

  it("still reads a deep-dive row saved with three scores", () => {
    const saved = (change: Record<string, number>) => ["naive", "mechanism", "cost"].map((id) => ({ id, score: change[id] ?? 3 }));
    expect(outcomeFor("deep_dive", saved({}))).toBe("ready");
    expect(outcomeFor("deep_dive", saved({ naive: 2 }))).toBe("getting_there");
    expect(outcomeFor("deep_dive", saved({ naive: 1 }))).toBe("needs_work");
    // A new grade that scores the follow-up low still counts against the deep dive.
    expect(outcomeFor("deep_dive", [...saved({}), { id: "follow_up", score: 1 }])).toBe("needs_work");
    expect(outcomeFor("deep_dive", [...saved({}), { id: "follow_up", score: 2 }])).toBe("getting_there");
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

describe("dialogue request schemas", () => {
  const id = "a1b2c3d4e5f60708";

  it("accepts a reply with an optional time", () => {
    expect(DrillReplySchema.safeParse({ attemptId: id, asked: 1, answer: "Because writes are rare." }).success).toBe(true);
    expect(DrillReplySchema.safeParse({ attemptId: id, asked: MAX_FOLLOW_UPS, answer: "x", elapsedSeconds: 90 }).success).toBe(true);
  });

  it.each([
    ["an unknown key", { attemptId: id, asked: 1, answer: "x", drill: "tradeoff" }],
    ["a path in the id", { attemptId: "../../x", asked: 1, answer: "x" }],
    ["a blank answer", { attemptId: id, asked: 1, answer: "   " }],
    ["an answer over 8000 characters", { attemptId: id, asked: 1, answer: "x".repeat(8001) }],
    ["a negative time", { attemptId: id, asked: 1, answer: "x", elapsedSeconds: -1 }],
    ["a time over two hours", { attemptId: id, asked: 1, answer: "x", elapsedSeconds: 7201 }],
    ["a missing id", { asked: 1, answer: "x" }],
    ["no question number", { attemptId: id, answer: "x" }],
    ["question number 0", { attemptId: id, asked: 0, answer: "x" }],
    [`a question number over ${MAX_FOLLOW_UPS}`, { attemptId: id, asked: MAX_FOLLOW_UPS + 1, answer: "x" }],
    ["a fractional question number", { attemptId: id, asked: 1.5, answer: "x" }],
    ["a question number as text", { attemptId: id, asked: "1", answer: "x" }],
  ])("rejects a reply with %s", (_n, body) => {
    expect(DrillReplySchema.safeParse(body).success).toBe(false);
  });

  it("takes only an attempt id to abandon", () => {
    expect(DrillAbandonSchema.safeParse({ attemptId: id }).success).toBe(true);
    expect(DrillAbandonSchema.safeParse({ attemptId: id, extra: 1 }).success).toBe(false);
    expect(DrillAbandonSchema.safeParse({ attemptId: "short" }).success).toBe(false);
    expect(DrillAbandonSchema.safeParse({}).success).toBe(false);
  });
});
