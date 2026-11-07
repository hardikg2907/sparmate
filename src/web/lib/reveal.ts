import type { Track } from "../../shared/phases";
import { evidenceStepFor } from "../../shared/stepFrames";

export type Reveal = { view: "code" } | { view: "board"; step: string | null };

/**
 * Where a step's answer lives: in the code when a machine-coding step has no frame, otherwise on the board, whose
 * view moves to the step's frame (the whole board when the step has none).
 */
export function revealFor(track: Track, phase: string): Reveal {
  const step = evidenceStepFor(track, phase);
  return track === "lld" && step === null ? { view: "code" } : { view: "board", step };
}
