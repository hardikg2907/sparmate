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

/** A calendar day such as "2026-11-02". */
export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Local calendar day of `date`, as "YYYY-MM-DD". */
export function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The local midnight that starts `day`. */
export function parseDayLocal(day: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/** True for a day that exists on the calendar and is not after today, so "2026-02-31" and tomorrow both fail. */
export function isPastOrToday(day: string, now: Date = new Date()): boolean {
  if (!DAY_PATTERN.test(day)) return false;
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const date = parseDayLocal(day);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return false;
  return day <= localDay(now);
}

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
