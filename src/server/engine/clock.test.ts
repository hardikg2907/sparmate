import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { phasePlan } from "../../shared/phases";
import {
  CheckpointScheduler,
  dueCheckpoints,
  formatClock,
  formatStamp,
  phaseOverCheckpoint,
  phaseWindows,
  planCheckpoints,
  roundTimeMs,
  timeInPhase,
  type Checkpoint,
} from "./clock";

const MIN = 60_000;

describe("roundTimeMs", () => {
  const start = "2026-10-29T10:00:00.000Z";
  const t = (s: number) => Date.parse(start) + s * 1000;

  it("counts wall time minus finished pauses", () => {
    expect(roundTimeMs({ startedAt: start, pausedMs: 30_000, pauseStartedAt: null, endedAt: null }, t(100))).toBe(70_000);
  });

  it("stops while a pause is running", () => {
    const clock = { startedAt: start, pausedMs: 0, pauseStartedAt: new Date(t(60)).toISOString(), endedAt: null };
    expect(roundTimeMs(clock, t(90))).toBe(60_000);
    expect(roundTimeMs(clock, t(500))).toBe(60_000);
  });

  it("freezes at the end", () => {
    const clock = { startedAt: start, pausedMs: 0, pauseStartedAt: null, endedAt: new Date(t(120)).toISOString() };
    expect(roundTimeMs(clock, t(9999))).toBe(120_000);
  });
});

describe("planCheckpoints", () => {
  it("plans phase nudges, the extension, five minutes and time-up for a 45-minute HLD round", () => {
    const cps = planCheckpoints("hld", "interview", 45 * MIN, phasePlan("hld", 45));
    expect(cps.map((c) => [c.id, c.atMs / MIN])).toEqual([
      ["phase_end:requirements", 5],
      ["phase_end:entities", 7],
      ["phase_end:api", 12],
      ["phase_end:design", 25],
      ["extension", 35],
      ["five_minutes", 40],
      ["time_up", 45],
    ]);
  });

  it("puts the LLD extension 15 minutes before the end", () => {
    const cps = planCheckpoints("lld", "interview", 120 * MIN, phasePlan("lld", 120));
    expect(cps.find((c) => c.kind === "extension")?.atMs).toBe(105 * MIN);
    expect(cps.at(-1)?.kind).toBe("time_up");
  });

  it("keeps only the phase_end nudges in guided mode, and none of the move-on offers", () => {
    const cps = planCheckpoints("hld", "guided", 45 * MIN, phasePlan("hld", 45));
    expect(cps.every((c) => c.kind === "phase_end")).toBe(true);
    expect(cps).toHaveLength(4);
  });

  it("ends the last planned window exactly at time-up for every round length", () => {
    for (const [track, minutes] of [
      ["hld", 45],
      ["hld", 60],
      ["lld", 90],
      ["lld", 120],
      ["hld", 20],
      ["lld", 20],
    ] as const) {
      expect(phaseWindows(phasePlan(track, minutes)).at(-1)?.endMs).toBe(minutes * MIN);
    }
  });

  it("keeps every phase nudge before the extension in the 60-minute and 120-minute rounds", () => {
    for (const [track, minutes] of [
      ["hld", 60],
      ["lld", 120],
    ] as const) {
      const cps = planCheckpoints(track, "interview", minutes * MIN, phasePlan(track, minutes));
      const extension = cps.find((c) => c.kind === "extension")?.atMs ?? 0;
      expect(cps.filter((c) => c.kind === "phase_end").every((c) => c.atMs < extension)).toBe(true);
    }
  });

  it("computes planned windows from the scaled plan", () => {
    const w = phaseWindows(phasePlan("hld", 45));
    expect(w[2]).toEqual({ id: "api", startMs: 7 * MIN, endMs: 12 * MIN });
  });
});

describe("dueCheckpoints", () => {
  const cps: Checkpoint[] = [
    { id: "a", kind: "phase_end", atMs: 1000, phase: "x" },
    { id: "b", kind: "five_minutes", atMs: 2000 },
    { id: "c", kind: "time_up", atMs: 3000 },
  ];
  it("returns due ones not fired yet and the next time", () => {
    expect(dueCheckpoints(cps, new Set(["a"]), 2500)).toEqual({ due: [cps[1]], nextAtMs: 3000 });
    expect(dueCheckpoints(cps, new Set(), 10)).toEqual({ due: [], nextAtMs: 1000 });
    expect(dueCheckpoints(cps, new Set(["a", "b", "c"]), 9999)).toEqual({ due: [], nextAtMs: null });
  });
});

describe("CheckpointScheduler with fake timers", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(checkpoints: Checkpoint[]) {
    let paused = false;
    let pausedTotal = 0;
    let pauseAt = 0;
    const start = Date.now();
    const fired: string[] = [];
    const sched = new CheckpointScheduler({
      checkpoints,
      fired: new Set(),
      roundTime: () => (paused ? pauseAt : Date.now()) - start - pausedTotal,
      running: () => !paused,
      onDue: (cp) => fired.push(cp.id),
    });
    return {
      sched,
      fired,
      pause() {
        paused = true;
        pauseAt = Date.now();
        sched.stop();
      },
      resume() {
        pausedTotal += Date.now() - pauseAt;
        paused = false;
        sched.reschedule();
      },
    };
  }

  it("fires each checkpoint once, in order, at its time", () => {
    const s = setup([
      { id: "one", kind: "phase_end", atMs: 5 * MIN, phase: "p" },
      { id: "two", kind: "time_up", atMs: 10 * MIN },
    ]);
    s.sched.reschedule();
    vi.advanceTimersByTime(5 * MIN - 1);
    expect(s.fired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(s.fired).toEqual(["one"]);
    vi.advanceTimersByTime(5 * MIN);
    expect(s.fired).toEqual(["one", "two"]);
    vi.advanceTimersByTime(60 * MIN);
    expect(s.fired).toEqual(["one", "two"]);
  });

  it("does not fire while paused and shifts by the pause length", () => {
    const s = setup([{ id: "one", kind: "five_minutes", atMs: 5 * MIN }]);
    s.sched.reschedule();
    vi.advanceTimersByTime(2 * MIN);
    s.pause();
    vi.advanceTimersByTime(30 * MIN);
    expect(s.fired).toEqual([]);
    s.resume();
    vi.advanceTimersByTime(3 * MIN - 1);
    expect(s.fired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(s.fired).toEqual(["one"]);
  });

  it("restores past checkpoints as fired except an undelivered extension and time-up", () => {
    const cps = planCheckpoints("hld", "interview", 45 * MIN, phasePlan("hld", 45));
    const fired = CheckpointScheduler.restoreFired(cps, 36 * MIN, false);
    expect(fired.has("phase_end:design")).toBe(true);
    expect(fired.has("extension")).toBe(false);
    expect(CheckpointScheduler.restoreFired(cps, 36 * MIN, true).has("extension")).toBe(true);
  });
});

describe("clock formats", () => {
  it("formats envelope times and judge stamps", () => {
    expect(formatClock(5_000)).toBe("0:05");
    expect(formatClock(754_000)).toBe("12:34");
    expect(formatClock(120 * MIN)).toBe("120:00");
    expect(formatStamp(65_000)).toBe("01:05");
    expect(formatStamp(112 * MIN + 40_000)).toBe("112:40");
  });
});

describe("time in a step and the move-on offer", () => {
  const plan = phasePlan("hld", 45);
  const first = plan[0]?.id;

  it("sums every visit to a step and counts the open visit up to now", () => {
    const history = [
      { phase: "requirements", at: 0 },
      { phase: "entities", at: 4 * MIN },
      { phase: "requirements", at: 6 * MIN },
      { phase: "entities", at: 7 * MIN },
    ];
    expect(timeInPhase(history, first, "requirements", 10 * MIN)).toBe(5 * MIN);
    expect(timeInPhase(history, first, "entities", 10 * MIN)).toBe(5 * MIN);
    expect(timeInPhase(history, first, "api", 10 * MIN)).toBe(0);
  });

  it("times the offer at twice the plan from now, less the time already spent", () => {
    // Requirements is planned for 5 minutes, so the offer falls after 10 minutes in the step.
    expect(phaseOverCheckpoint(plan, [{ phase: "requirements", at: 0 }], "requirements", 0)).toMatchObject({ id: "phase_over:requirements", kind: "phase_over", atMs: 10 * MIN });
    const history = [
      { phase: "requirements", at: 0 },
      { phase: "entities", at: 4 * MIN },
      { phase: "requirements", at: 20 * MIN },
    ];
    // 4 minutes were spent before he left, so 6 are left when he comes back at 20:00.
    expect(phaseOverCheckpoint(plan, history, "requirements", 20 * MIN)?.atMs).toBe(26 * MIN);
  });

  it("gives a step entered late its full time, whatever the round clock says", () => {
    const history = [
      { phase: "requirements", at: 0 },
      { phase: "entities", at: 12 * MIN },
    ];
    // Core entities is planned for 2 minutes, so the offer falls 4 minutes after he entered it.
    expect(phaseOverCheckpoint(plan, history, "entities", 12 * MIN)?.atMs).toBe(16 * MIN);
  });

  it("is due now once the time in the step already passed twice its plan", () => {
    expect(phaseOverCheckpoint(plan, [{ phase: "requirements", at: 0 }], "requirements", 30 * MIN)?.atMs).toBe(30 * MIN);
  });

  it("makes no offer for the last step", () => {
    expect(phaseOverCheckpoint(plan, [{ phase: "deep_dives", at: 0 }], "deep_dives", 0)).toBeNull();
  });
});
