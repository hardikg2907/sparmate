import type { Track } from "./phases";

/** A labelled frame on the board that holds one step's answer. */
export interface StepFrameDef {
  /** The phase whose answer the frame holds. Stored on the frame as `customData.step`. */
  step: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Three short steps in a row above the two long ones, so the eye reads the answer in method order. No frame
// starts at 0 on either axis, because Excalidraw's skeleton converter reads a 0 there as "not given".
const HLD_FRAMES: readonly StepFrameDef[] = [
  { step: "requirements", name: "Requirements", x: 40, y: 40, width: 1000, height: 640 },
  { step: "capacity", name: "Capacity", x: 1080, y: 40, width: 1000, height: 640 },
  { step: "api", name: "API", x: 2120, y: 40, width: 1000, height: 640 },
  { step: "design", name: "High-level design", x: 40, y: 740, width: 2040, height: 1040 },
  { step: "deep_dives", name: "Deep dives", x: 2120, y: 740, width: 1000, height: 1040 },
];

// The code editor holds most of a machine-coding answer; the board keeps the two parts that are drawn.
const LLD_FRAMES: readonly StepFrameDef[] = [
  { step: "entities", name: "Entities", x: 40, y: 40, width: 1400, height: 1040 },
  { step: "behaviour", name: "States", x: 1500, y: 40, width: 1160, height: 1040 },
];

/**
 * Steps without a frame of their own that are read from another step's frame: the bottleneck and the curveball
 * are argued on the high-level design.
 */
const BORROWED: Record<string, string> = { wrap_up: "design" };

export function stepFramesFor(track: Track): readonly StepFrameDef[] {
  return track === "hld" ? HLD_FRAMES : LLD_FRAMES;
}

/** The step whose frame holds the board evidence for `phase`, or null when the step lives in the code. */
export function evidenceStepFor(track: Track, phase: string): string | null {
  const frames = stepFramesFor(track);
  if (frames.some((f) => f.step === phase)) return phase;
  const borrowed = BORROWED[phase];
  return borrowed !== undefined && frames.some((f) => f.step === borrowed) ? borrowed : null;
}
