export interface PlanPhase {
  id: string;
  label: string;
  minutes: number;
}

const MIN = 60_000;

/** Round time, in milliseconds, at which each phase is planned to start and end. */
export function planWindows(plan: readonly PlanPhase[]): { id: string; startMs: number; endMs: number }[] {
  let at = 0;
  return plan.map((phase) => {
    const startMs = at;
    at += phase.minutes * MIN;
    return { id: phase.id, startMs, endMs: at };
  });
}

/**
 * How far the round has run past the planned end of the phase the candidate is in. Zero while on plan.
 * Measured against the current phase rather than the needle, because a candidate who skips ahead is not late.
 */
export function behindPlanMs(plan: readonly PlanPhase[], currentPhase: string, roundMs: number): number {
  const window = planWindows(plan).find((w) => w.id === currentPhase);
  if (!window) return 0;
  return Math.max(0, roundMs - window.endMs);
}

/** What the top bar says about pace: how far past the plan, or on it. */
export type PlanDelta = { kind: "behind"; ms: number } | { kind: "on" };

/**
 * The pace chip's content, or null when the round has no time plan to be behind: an empty plan, a phase the plan
 * does not list, or a round that is not timed. Less than a second past the planned end still counts as on plan.
 */
export function planDelta(plan: readonly PlanPhase[], currentPhase: string, roundMs: number, timed = true): PlanDelta | null {
  if (!timed || !plan.some((p) => p.id === currentPhase)) return null;
  const ms = behindPlanMs(plan, currentPhase, roundMs);
  return ms >= 1000 ? { kind: "behind", ms } : { kind: "on" };
}

/** The phase the plan says the candidate should be in at this round time, or the last one once past the plan. */
export function plannedPhaseAt(plan: readonly PlanPhase[], roundMs: number): string | null {
  const windows = planWindows(plan);
  return (windows.find((w) => roundMs < w.endMs) ?? windows[windows.length - 1])?.id ?? null;
}

/** No step gets less than this share of the rail, so a two-minute step still shows its name. */
export const MIN_RAIL_SHARE = 0.15;

/** Each phase's width weight on the rail: its planned minutes, raised to the floor share of the whole plan. */
export function railWeights(plan: readonly PlanPhase[]): number[] {
  const total = plan.reduce((sum, p) => sum + p.minutes, 0);
  return plan.map((p) => Math.max(p.minutes, total * MIN_RAIL_SHARE));
}

/**
 * Where "now" sits on the rail, from 0 to 1. Widths are not strictly to scale, so the needle moves through each
 * phase's own segment at that phase's planned pace and always points into the phase the plan expects.
 */
export function railPosition(plan: readonly PlanPhase[], roundMs: number): number {
  const weights = railWeights(plan);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return 0;
  let before = 0;
  for (const [i, w] of planWindows(plan).entries()) {
    const weight = weights[i] ?? 0;
    if (roundMs < w.endMs) {
      const span = w.endMs - w.startMs;
      const into = span > 0 ? Math.max(0, roundMs - w.startMs) / span : 0;
      return (before + into * weight) / sum;
    }
    before += weight;
  }
  return 1;
}
