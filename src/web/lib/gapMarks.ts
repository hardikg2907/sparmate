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

/** Where a gap stands on the page. Only a "taught" record is done; a round that merely opened the gap is still with the coach. */
export type GapState = "not_started" | "with_coach" | "done" | "later";

export function gapState(mark: GapMark | undefined): GapState {
  if (mark === undefined) return "not_started";
  // A "sent" mark comes from a round saved before records existed and never gets a later one, so it must not hold the page.
  if (mark === "sent") return "done";
  if (mark.state === "taught") return "done";
  if (mark.state === "core_only") return "later";
  return "with_coach";
}

export const GAP_STATE_LABEL: Record<GapState, string> = {
  not_started: "Not started",
  with_coach: "With the coach",
  done: "Done",
  later: "Core idea done, rest later",
};

/** The badge for a gap that has started; a gap that has not started shows none. */
export function gapBadge(state: GapState, mark?: GapMark): { label: string; tone: Tone } | null {
  if (state === "not_started") return null;
  if (mark === "sent") return { label: "Sent to the coach", tone: "good" };
  return { label: GAP_STATE_LABEL[state], tone: state === "with_coach" ? "accent" : state === "done" ? "good" : "warn" };
}

function recordTime(mark: GapMark | undefined): number {
  if (mark === undefined || mark === "sent") return Number.NEGATIVE_INFINITY;
  const time = Date.parse(mark.at);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/**
 * The gap to work on now. A gap that is with the coach always wins, the newest record first, so the coach opening
 * a gap by itself is never skipped. Without one, it is the first gap not started, most serious first.
 */
export function currentGap<T extends Gap>(sorted: readonly T[], marks: ReadonlyMap<string, GapMark>): T | undefined {
  let best: T | undefined;
  for (const gap of sorted) {
    const mark = marks.get(gap.title);
    if (gapState(mark) !== "with_coach") continue;
    if (best === undefined || recordTime(mark) > recordTime(marks.get(best.title))) best = gap;
  }
  return best ?? sorted.find((gap) => gapState(marks.get(gap.title)) === "not_started");
}

export interface GapCounts {
  total: number;
  /** Done, or the core idea taught with the rest for a later session. */
  done: number;
  withCoach: number;
}

export function gapCounts(gaps: readonly Gap[], marks: ReadonlyMap<string, GapMark>): GapCounts {
  const states = gaps.map((gap) => gapState(marks.get(gap.title)));
  return {
    total: gaps.length,
    done: states.filter((state) => state === "done" || state === "later").length,
    withCoach: states.filter((state) => state === "with_coach").length,
  };
}

/** The gaps step is complete only when no gap is left to start or to finish with the coach. */
export function gapsComplete(gaps: readonly Gap[], marks: ReadonlyMap<string, GapMark>): boolean {
  const { total, done } = gapCounts(gaps, marks);
  return done === total;
}

export function progressText({ total, done, withCoach }: GapCounts): string {
  return `Gaps: ${done} of ${total} done${withCoach > 0 ? ` · ${withCoach} with the coach` : ""}`;
}

/** A severity badge only helps when it tells gaps apart. */
export function severitiesDiffer(gaps: readonly { severity: string }[]): boolean {
  return new Set(gaps.map((gap) => gap.severity)).size > 1;
}
