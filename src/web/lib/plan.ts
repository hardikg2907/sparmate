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

/** The phase the plan says the candidate should be in at this round time, or the last one once past the plan. */
export function plannedPhaseAt(plan: readonly PlanPhase[], roundMs: number): string | null {
  const windows = planWindows(plan);
  return (windows.find((w) => roundMs < w.endMs) ?? windows[windows.length - 1])?.id ?? null;
}
