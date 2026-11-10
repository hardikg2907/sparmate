import type { DrillType } from "./drills";
import { phasesFor, type Track } from "./phases";
import type { Scorecard } from "./types";

type Gap = Scorecard["gaps"][number];

/**
 * The message a gap card's "Teach me this" button sends. The server matches it against the scorecard to record
 * the gap, so the browser and the server must build it from this one function.
 */
export function teachMessage(gap: Pick<Gap, "title">): string {
  return `Teach me this gap: ${gap.title}`;
}

/** The scorecard gap a coach message asks about, if the message is exactly a "Teach me this" message. */
export function gapForTeachMessage(gaps: readonly Pick<Gap, "title">[], text: string): string | null {
  const trimmed = text.trim();
  return gaps.find((gap) => teachMessage(gap) === trimmed)?.title ?? null;
}

/** The divider the coach chat shows when a gap becomes the one being taught. */
export function gapDividerText(title: string): string {
  return `Now on: ${title}`;
}

/** The step each drill kind trains, for a gap the judge did not tag with a step. */
const DRILL_STEP: Record<Track, Partial<Record<DrillType, string>>> = {
  hld: { requirements: "requirements", walk: "design", capacity: "deep_dives", deep_dive: "deep_dives", tradeoff: "deep_dives" },
  lld: { requirements: "clarify", lld_skeleton: "skeleton" },
};

/**
 * The step a gap belongs to: the judge's tag (when it names a step of the track) and the step its drill trains, when
 * they agree or only one of them is known. When they disagree there is no step, because a wrong step would mark a
 * gap practised that the round never touched. A gap with no step is never marked practised.
 */
export function gapStep(track: Track, gap: { step?: string | undefined; drill?: DrillType | undefined; aboutTheRound?: boolean | undefined }): string | null {
  // A gap about how the round was run is never closed by one step's answer.
  if (gap.aboutTheRound) return null;
  const steps = phasesFor(track).map((p) => p.id);
  const tagged = gap.step && steps.includes(gap.step) ? gap.step : null;
  const byDrill = (gap.drill ? DRILL_STEP[track][gap.drill] : undefined) ?? null;
  if (tagged && byDrill && tagged !== byDrill) return null;
  return tagged ?? byDrill;
}
