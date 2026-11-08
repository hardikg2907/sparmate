const LONG_DATE = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" });
const SHORT_DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "long" });

/** "Tuesday 10 November". */
export function longDate(date: Date): string {
  return LONG_DATE.format(date).replace(",", "");
}

/** Parses a local calendar day, "2026-11-10", without the time zone shifting it. */
export function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** "Sat 7 Nov". */
export function shortDay(value: Date | string): string {
  return SHORT_DAY.format(typeof value === "string" ? new Date(value) : value).replace(",", "");
}

/** "8 Nov". */
export function dayMonth(day: string): string {
  return DAY_MONTH.format(parseDay(day));
}

export function weekday(date: Date): string {
  return WEEKDAY.format(date);
}

/** Minutes shown to the nearest whole number, at least 1 once any time has passed. */
export function wholeMinutes(ms: number): number {
  return ms <= 0 ? 0 : Math.max(1, Math.round(ms / 60_000));
}
