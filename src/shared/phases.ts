export type Track = "hld" | "lld";
export type Mode = "interview" | "guided";

export interface PhaseDef {
  id: string;
  label: string;
  /** Planned minutes when the round runs at its base length (45 for HLD, 90 for LLD). Scaled for other lengths. */
  baseMinutes: number;
  /** One line shown under the phase on the rail. */
  goal: string;
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
  { id: "deep_dives", label: "Deep dives", baseMinutes: 20, goal: "One per hard non-functional requirement; math only where a number decides something; then the curveball" },
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

/** Planned minutes per phase, scaled to the round's real length. */
export function phasePlan(track: Track, durationMin: number): { id: string; label: string; minutes: number }[] {
  const scale = durationMin / BASE_MINUTES[track];
  return phasesFor(track).map((p) => ({ id: p.id, label: p.label, minutes: Math.max(1, Math.round(p.baseMinutes * scale)) }));
}

export function isPhaseOf(track: Track, phase: string): boolean {
  return phasesFor(track).some((p) => p.id === phase);
}
