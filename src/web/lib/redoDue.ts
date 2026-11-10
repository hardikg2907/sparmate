import { addDays } from "../../shared/drills";
import { REDO_AFTER_DAYS } from "../../shared/today";
import type { ProblemSummary } from "../../shared/types";
import { dayMonth, parseDay, shortDay, weekday } from "./dates";

/** Days from `day` to the local day of `now`. Negative when `day` is still ahead. */
function daysSince(day: string, now: Date): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today.getTime() - parseDay(day).getTime()) / 86_400_000);
}

/**
 * The one wording for when a redo falls due, on Today, Practice and Progress. An overdue redo names the day it fell
 * due, so a redo that waited ten days does not read like one that is due today.
 */
export function redoDueText(dueOn: string | null, now: Date): string {
  if (!dueOn) return "Due now";
  const days = daysSince(dueOn, now);
  if (days < 0) return `Due ${shortDay(parseDay(dueOn))}`;
  if (days === 0) return "Due today";
  return days < 7 ? `Due since ${weekday(parseDay(dueOn))}` : `Due since ${dayMonth(dueOn)}`;
}

/** The plan panel's line for a problem with no saved round. A redo then comes from the tracker, and the line says so. */
export function untriedText(problem: Pick<ProblemSummary, "trackerMark" | "redoDueOn">): string {
  if (problem.trackerMark !== "[~]") return "No earlier try of this problem.";
  const marked = problem.redoDueOn ? addDays(problem.redoDueOn, -REDO_AFTER_DAYS) : null;
  return `No round of it is saved here. Your tracker marks it partly done${marked ? `, last on ${dayMonth(marked)}` : ""}.`;
}
