import { describe, expect, it } from "vitest";
import type { Session } from "../../shared/types";
import { computeReadiness } from "./readiness";

const MIN = 60_000;
const PLAN = [
  { id: "requirements", label: "Requirements" },
  { id: "entities", label: "Core entities" },
  { id: "api", label: "API" },
];
const START = Date.parse("2026-11-01T10:00:00.000Z");

type Input = Parameters<typeof computeReadiness>[0];

/** A guided round that ran `minutes` of a 45-minute plan, with every step passed. */
function round(over: Partial<Input> = {}, minutes = 40): Input {
  return {
    stepVerdicts: Object.fromEntries(PLAN.map((p, i) => [p.id, { verdict: "pass", at: i }])) as Session["stepVerdicts"],
    assists: [],
    hints: [],
    startedAt: new Date(START).toISOString(),
    pausedMs: 0,
    pauseStartedAt: null,
    endedAt: new Date(START + minutes * MIN).toISOString(),
    durationMs: 45 * MIN,
    ...over,
  };
}

describe("computeReadiness", () => {
  it("is ready when every step passed unaided inside the plan", () => {
    expect(computeReadiness(round(), PLAN)).toEqual({ call: "ready", reasons: [] });
  });

  it("allows hints below level 3", () => {
    const hints = [
      { at: 1, level: 1 as const, topic: "a" },
      { at: 2, level: 2 as const, topic: "b" },
    ];
    expect(computeReadiness(round({ hints }), PLAN).call).toBe("ready");
  });

  it("names steps that did not pass by their labels", () => {
    const out = computeReadiness(round({ stepVerdicts: { requirements: { verdict: "pass", at: 1 }, entities: { verdict: "not_yet", gap: "x", at: 2 } } }), PLAN);
    expect(out.call).toBe("not_yet");
    expect(out.reasons).toEqual(["These steps did not pass: Core entities and API."]);
  });

  it("treats a round with no verdicts at all as nothing passed", () => {
    const out = computeReadiness(round({ stepVerdicts: undefined, assists: undefined }), PLAN);
    expect(out.reasons).toEqual(["These steps did not pass: Requirements, Core entities and API."]);
  });

  it("names a single step in the singular", () => {
    const out = computeReadiness(round({ stepVerdicts: { requirements: { verdict: "pass", at: 1 }, entities: { verdict: "pass", at: 2 } } }), PLAN);
    expect(out.reasons).toEqual(["This step did not pass: API."]);
  });

  it("names assisted steps, even when the step passed afterwards", () => {
    const out = computeReadiness(
      round({
        assists: [
          { at: 5, phase: "entities" },
          { at: 6, phase: "entities" },
        ],
      }),
      PLAN,
    );
    expect(out).toEqual({ call: "not_yet", reasons: ["Core entities was assisted."] });
    const two = computeReadiness(
      round({
        assists: [
          { at: 5, phase: "entities" },
          { at: 6, phase: "api" },
        ],
      }),
      PLAN,
    );
    expect(two.reasons).toEqual(["Core entities and API were assisted."]);
  });

  it("counts every hint and the ones that offered two options", () => {
    const hints = [
      { at: 1, level: 1 as const, topic: "a" },
      { at: 2, level: 2 as const, topic: "b" },
      { at: 3, level: 3 as const, topic: "c" },
    ];
    expect(computeReadiness(round({ hints }), PLAN).reasons).toEqual(["3 hints, and 1 of them gave you two options to pick from."]);
    expect(computeReadiness(round({ hints: [hints[2]!] }), PLAN).reasons).toEqual(["1 hint, and it gave you two options to pick from."]);
    expect(computeReadiness(round({ hints: [hints[2]!, { ...hints[2]!, at: 4 }] }), PLAN).reasons).toEqual(["2 hints, and each of them gave you two options to pick from."]);
  });

  it("flags active time above 1.5 times the plan, and not before", () => {
    expect(computeReadiness(round({}, 67), PLAN).call).toBe("ready");
    expect(computeReadiness(round({}, 80), PLAN).reasons).toEqual(["The round took 80 minutes against a 45-minute plan."]);
  });

  it("does not count paused time as active time", () => {
    expect(computeReadiness(round({ pausedMs: 40 * MIN }, 80), PLAN).call).toBe("ready");
  });

  it("lists one reason per failed condition", () => {
    const out = computeReadiness(round({ stepVerdicts: {}, assists: [{ at: 1, phase: "api" }], hints: [{ at: 2, level: 3, topic: "x" }] }, 90), PLAN);
    expect(out.reasons).toHaveLength(4);
    expect(out.call).toBe("not_yet");
  });
});
