/**
 * The "Count solves from" day after an edit of its date box. A browser reports a half-typed date as an empty value,
 * so an empty value from a box that still holds part of a date keeps the day that was there. Only a box the user
 * emptied completely clears the day.
 */
export function nextCountFrom(typed: string, partial: boolean, current: string | undefined): string | undefined {
  if (typed !== "") return typed;
  return partial ? current : undefined;
}
