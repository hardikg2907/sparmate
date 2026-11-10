import { describe, expect, it } from "vitest";
import type { PublicSession } from "../../shared/types";
import { clockOffset, debriefClockText, finalRoundMs, phaseSpentMs, roundMsAt } from "./timing";

const MIN = 60_000;
const T0 = Date.parse("2026-10-30T10:00:00.000Z");

function clock(overrides: Partial<PublicSession["clock"]> = {}): PublicSession["clock"] {
  return {
    startedAt: new Date(T0).toISOString(),
    pausedMs: 0,
    pauseStartedAt: null,
    durationMs: 45 * MIN,
    serverNow: new Date(T0 + 10 * MIN).toISOString(),
    ...overrides,
  };
}

describe("roundMsAt", () => {
  it("counts wall time since the start", () => {
    expect(roundMsAt(clock(), T0 + 12 * MIN)).toBe(12 * MIN);
  });

  it("leaves out finished pauses", () => {
    expect(roundMsAt(clock({ pausedMs: 3 * MIN }), T0 + 12 * MIN)).toBe(9 * MIN);
  });

  it("stops while a pause is running", () => {
    const paused = clock({ pausedMs: MIN, pauseStartedAt: new Date(T0 + 8 * MIN).toISOString() });
    expect(roundMsAt(paused, T0 + 8 * MIN)).toBe(7 * MIN);
    expect(roundMsAt(paused, T0 + 20 * MIN)).toBe(7 * MIN);
  });

  it("never goes below zero", () => {
    expect(roundMsAt(clock(), T0 - 5 * MIN)).toBe(0);
  });
});

describe("clockOffset", () => {
  it("measures how far the local clock is from the server's", () => {
    // The server says it is 10:10 while this browser thinks it is 10:07.
    expect(clockOffset(clock(), T0 + 7 * MIN)).toBe(3 * MIN);
  });

  it("falls back to no offset when the server time is unreadable", () => {
    expect(clockOffset(clock({ serverNow: "not a date" }), T0)).toBe(0);
  });
});

describe("finalRoundMs", () => {
  it("is null while the round is open", () => {
    expect(finalRoundMs({ clock: clock(), endedAt: null })).toBeNull();
  });

  it("freezes at the end time", () => {
    expect(finalRoundMs({ clock: clock({ pausedMs: MIN }), endedAt: new Date(T0 + 30 * MIN).toISOString() })).toBe(29 * MIN);
  });
});

describe("phaseSpentMs", () => {
  const history = [
    { phase: "requirements", at: 0, by: "candidate" as const },
    { phase: "entities", at: 4 * MIN, by: "candidate" as const },
    { phase: "api", at: 7 * MIN, by: "interviewer" as const },
  ];

  it("splits round time by phase", () => {
    expect(phaseSpentMs(history, "requirements", "api", 11 * MIN)).toEqual({ requirements: 4 * MIN, entities: 3 * MIN, api: 4 * MIN });
  });

  it("adds up a phase visited twice", () => {
    const back = [...history, { phase: "entities", at: 9 * MIN, by: "candidate" as const }];
    expect(phaseSpentMs(back, "requirements", "entities", 10 * MIN)).toEqual({ requirements: 4 * MIN, entities: 4 * MIN, api: 2 * MIN });
  });

  it("puts everything in the first phase when nothing was recorded", () => {
    expect(phaseSpentMs([], "requirements", "requirements", 5 * MIN)).toEqual({ requirements: 5 * MIN });
  });

  it("lets the live phase take the open segment when history lags a click", () => {
    expect(phaseSpentMs(history.slice(0, 2), "requirements", "api", 6 * MIN)).toEqual({ requirements: 4 * MIN, api: 2 * MIN });
  });

  it("does not count time past the end of the round", () => {
    const spent = phaseSpentMs(history, "requirements", "api", 5 * MIN);
    expect(spent.requirements).toBe(4 * MIN);
    expect(spent.entities).toBe(MIN);
  });
});

describe("debriefClockText", () => {
  const hour = 60 * 60_000;
  it("shows an interview round against its limit", () => {
    expect(debriefClockText("interview", 44 * 60_000 + 5_000, hour)).toBe("44:05 of 60:00");
  });
  it("never reads past the limit when the round ended a little late", () => {
    expect(debriefClockText("interview", 63 * 60_000 + 7_000, hour)).toBe("60:00 of 60:00");
  });
  it("shows only the time spent for a guided round", () => {
    expect(debriefClockText("guided", 8 * 60_000 + 44_000, hour)).toBe("08:44 spent");
  });
});
