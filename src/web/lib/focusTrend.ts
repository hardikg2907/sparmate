import { scoredRounds } from "../../shared/progress";
import type { SessionHistoryItem } from "../../shared/types";

/** The skill's score in each of the newest scored rounds, oldest first, for a small trend line. */
export function focusTrend(history: readonly SessionHistoryItem[], skillId: string, count = 5): number[] {
  const { rounds } = scoredRounds(history);
  return rounds
    .slice(0, count)
    .map((r) => r.scores?.find((s) => s.id === skillId)?.score)
    .filter((s): s is number => s !== undefined)
    .reverse();
}
