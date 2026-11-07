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
