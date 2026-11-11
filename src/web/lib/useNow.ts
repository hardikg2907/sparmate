import { useEffect, useState } from "react";

/** Milliseconds from `now` to the next local midnight, plus a second so the new day has surely begun. */
export function msToNextDay(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime() + 1000;
}

/** The local calendar day of `date` as YYYY-MM-DD. */
export function dayKey(date: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/**
 * The current time, refreshed when the tab becomes visible again and when the local day changes. A page left open
 * overnight then shows the right day and applies the 24-hour rules to the right moment.
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, msToNextDay(new Date()));
    };
    const refresh = () => {
      setNow(new Date());
      arm();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    arm();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return now;
}

/**
 * The local day, which changes only at midnight. The server works out what is due for the day it is asked on, so a
 * list read yesterday must be read again when this changes.
 */
export function useLocalDay(): string {
  return dayKey(useNow());
}
