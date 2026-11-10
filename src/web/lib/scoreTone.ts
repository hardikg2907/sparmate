import { BAR_SCORE } from "../../shared/progress";

/**
 * The fill colour of a 1 to 4 score: success at the target bar or above, warning one step below it, destructive
 * below that. Progress skill rows and every drill criterion meter share it so the two pages never disagree.
 */
export function scoreFill(score: number): string {
  if (score >= BAR_SCORE) return "bg-success-fill";
  if (score >= 2) return "bg-warning-fill";
  return "bg-destructive-fill";
}
