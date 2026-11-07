import { teachMessage } from "../../shared/gaps";
import type { GapProgress, Scorecard } from "../../shared/types";
import type { Tone } from "./format";

type Gap = Pick<Scorecard["gaps"][number], "title">;

/** A gap's standing on the debrief page: the coach's record, or "sent" for a round saved before records existed. */
export type GapMark = GapProgress | "sent";

/**
 * What each gap has with the coach. A round with any record is read from the records alone. An older round has
 * none, so the only signal it holds is a "Teach me this" message in the coach chat.
 */
export function gapMarks(gaps: readonly Gap[], progress: Readonly<Record<string, GapProgress>>, candidateTexts: readonly string[]): Map<string, GapMark> {
  const marks = new Map<string, GapMark>();
  const recorded = gaps.filter((gap) => Object.hasOwn(progress, gap.title));
  if (recorded.length > 0) {
    for (const gap of recorded) marks.set(gap.title, progress[gap.title]!);
    return marks;
  }
  const asked = new Set(candidateTexts.map((text) => text.trim()));
  for (const gap of gaps) if (asked.has(teachMessage(gap))) marks.set(gap.title, "sent");
  return marks;
}

export function gapBadge(mark: GapMark | undefined): { label: string; tone: Tone } | null {
  if (mark === undefined) return null;
  if (mark === "sent") return { label: "Sent to the coach", tone: "good" };
  if (mark.state === "taught") return { label: "Taught", tone: "good" };
  if (mark.state === "core_only") return { label: "Core idea only, topic session later", tone: "warn" };
  return mark.by === "coach" ? { label: "Started by the coach", tone: "accent" } : { label: "Sent to the coach", tone: "good" };
}

export function teachLabel(mark: GapMark | undefined): string {
  return mark === undefined ? "Teach me this" : "Ask again";
}

/** The first gap, most serious first, that the coach has not touched. */
export function startHere<T extends Gap>(sorted: readonly T[], marks: ReadonlyMap<string, GapMark>): T | undefined {
  return sorted.find((gap) => !marks.has(gap.title));
}

export function workedText(worked: number, total: number): string {
  return `${worked} of ${total} worked with the coach`;
}
