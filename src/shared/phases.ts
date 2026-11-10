export type Track = "hld" | "lld";
export type Mode = "interview" | "guided";

export interface PhaseDef {
  id: string;
  label: string;
  /** Planned minutes when the round runs at its base length (45 for HLD, 90 for LLD). Scaled for other lengths. */
  baseMinutes: number;
  /** One line shown under the phase on the rail. */
  goal: string;
  /**
   * How many checklist items a guided pass needs covered. Most steps need half, so a pass means what the debrief's
   * step card will show; a step whose level bar asks for one of several items needs one.
   */
  passNeeds?: "one";
}

// The five-step HLD delivery order: requirements first, numbers only inside the deep dives where one decides something.
export const HLD_PHASES: readonly PhaseDef[] = [
  { id: "requirements", label: "Requirements", baseMinutes: 5, goal: "3 core functional requirements; non-functional ones each with a number or a rule; scale as numbers" },
  { id: "entities", label: "Core entities", baseMinutes: 2, goal: "The few nouns the API and the storage revolve around" },
  { id: "api", label: "API", baseMinutes: 5, goal: "The external endpoints with request, response and status codes" },
  {
    id: "design",
    label: "High-level design",
    baseMinutes: 13,
    goal: "Boxes and arrows that meet the functional requirements; walk one request through every box, cache miss included",
  },
  {
    id: "deep_dives",
    label: "Deep dives",
    baseMinutes: 20,
    goal: "One per hard non-functional requirement; math only where a number decides something; then the curveball",
    passNeeds: "one",
  },
];

// The candidate's own seven-step machine-coding method.
export const LLD_PHASES: readonly PhaseDef[] = [
  { id: "clarify", label: "Clarify", baseMinutes: 5, goal: "Requirements, failure and ordering questions, what is out of scope" },
  { id: "entities", label: "Entities", baseMinutes: 10, goal: "Nouns sorted into class, enum, field or not stored; find the hidden noun" },
  { id: "behaviour", label: "Behaviour", baseMinutes: 10, goal: "Methods, states and the transition table" },
  { id: "skeleton", label: "Skeleton", baseMinutes: 10, goal: "Classes and signatures that compile" },
  { id: "thin_slice", label: "Thin slice", baseMinutes: 15, goal: "One happy path running end to end from main()" },
  { id: "fill_out", label: "Fill out", baseMinutes: 25, goal: "Every requirement and edge case, with scenarios in main()" },
  { id: "extend", label: "Extension", baseMinutes: 15, goal: "The new requirement, then the demo" },
];

export const BASE_MINUTES: Record<Track, number> = { hld: 45, lld: 90 };

/** Minutes before the end at which the interviewer introduces the extension. */
export const EXTENSION_LEAD_MINUTES: Record<Track, number> = { hld: 10, lld: 15 };

export function phasesFor(track: Track): readonly PhaseDef[] {
  return track === "hld" ? HLD_PHASES : LLD_PHASES;
}

/**
 * Planned minutes per phase, scaled to the round's real length. The minutes are whole numbers that add up to the round
 * length: each step gets the whole part of its share, and the minutes left over go to the steps with the largest
 * fractions, longer steps first on a tie. Rounding each step on its own would add up to 61 for a 60-minute round. It
 * holds for any round long enough to give every step a minute; the shortest round is 20 minutes.
 */
export function phasePlan(track: Track, durationMin: number): { id: string; label: string; minutes: number }[] {
  const phases = phasesFor(track);
  const total = Math.round(durationMin);
  const base = BASE_MINUTES[track];
  // Integer remainders keep equal fractions equal; in floating point 20 * 60 / 45 and 5 * 60 / 45 differ in the last bit.
  const shares = phases.map((p, i) => ({ i, whole: Math.floor((p.baseMinutes * total) / base), rest: (p.baseMinutes * total) % base, base: p.baseMinutes }));
  const minutes = shares.map((s) => Math.max(1, s.whole));
  let left = total - minutes.reduce((a, b) => a + b, 0);
  // A step already lifted to its one-minute floor holds more than its share, so it takes no leftover minute.
  const byRest = shares.filter((s) => s.whole >= 1).sort((a, b) => b.rest - a.rest || b.base - a.base || a.i - b.i);
  for (let k = 0; left > 0 && byRest.length > 0; k = (k + 1) % byRest.length, left -= 1) minutes[byRest[k]!.i]! += 1;
  return phases.map((p, i) => ({ id: p.id, label: p.label, minutes: minutes[i] ?? 1 }));
}

export function isPhaseOf(track: Track, phase: string): boolean {
  return phasesFor(track).some((p) => p.id === phase);
}

/**
 * A round's saved step timing with the plan of today's rule. A round scored before the plan added up to the round
 * length keeps its real times but would otherwise show the old planned minutes, so every reader gets the same plan
 * that a new round of that length has. A step the plan does not list keeps what was saved.
 */
export function withCurrentPlan<T extends { phase: string; plannedMinutes: number }>(timing: readonly T[], track: Track, durationMin: number): T[] {
  const planned = new Map(phasePlan(track, durationMin).map((p) => [p.id, p.minutes]));
  return timing.map((row) => ({ ...row, plannedMinutes: planned.get(row.phase) ?? row.plannedMinutes }));
}
