export const DAY_KINDS = ["hld", "lld", "dsa", "redo", "rest"] as const;
export type DayKind = (typeof DAY_KINDS)[number];

/** Monday first, to match the weekly plan array. */
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export const DEFAULT_WEEKLY_PLAN: readonly DayKind[] = ["dsa", "hld", "dsa", "hld", "dsa", "lld", "redo"];

export const DSA_GOAL_MIN = 1;
export const DSA_GOAL_MAX = 30;
export const DEFAULT_DSA_GOAL = 3;

/** A public LeetCode handle: letters, digits, underscore and hyphen. It is stored only, never sent anywhere. */
export const LEETCODE_USERNAME_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

/** Index into the weekly plan: Monday is 0 and Sunday is 6. */
export function planIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/** The Monday at local midnight of the week that holds `date`. */
export function weekStart(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - planIndex(date));
  return start;
}
