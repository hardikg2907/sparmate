import { addDays } from "../../shared/drills";
import { parseDay, shortDay } from "./dates";

/** What a try before the due day means: it is graded, and the schedule does not move. */
export function earlyNote(dueOn: string, today: string): string {
  const due = dueOn === addDays(today, 1) ? "Due tomorrow" : `Due ${shortDay(parseDay(dueOn))}`;
  return `${due}. An early try is practice only.`;
}

/** A new answer's clock starts with its first change, so reading the task costs no time. Blank text starts nothing. */
export function clockStart(held: number | null, text: string, now: number): number | null {
  return held ?? (text.trim() === "" ? null : now);
}
