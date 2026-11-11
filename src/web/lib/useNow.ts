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
 * Calls `onTick` when the local day turns and each time the page comes back to the user. A sleeping machine can fire
 * the midnight timer hours late and may never mark the window hidden, so focus and a restore from the page cache
 * count as coming back too.
 */
function onClockTick(onTick: () => void): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, msToNextDay(new Date()));
  };
  const refresh = () => {
    onTick();
    arm();
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") refresh();
  };
  arm();
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", refresh);
  window.addEventListener("pageshow", refresh);
  return () => {
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", refresh);
    window.removeEventListener("pageshow", refresh);
  };
}

/**
 * The current time, refreshed when the page comes back to the user and when the local day changes. A page left open
 * overnight then shows the right day and applies the 24-hour rules to the right moment.
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => onClockTick(() => setNow(new Date())), []);
  return now;
}

/**
 * The local day, which changes only at midnight. The server works out what is due for the day it is asked on, so a
 * list read yesterday must be read again when this changes. It holds the day as text, so a tick on the same day
 * renders nothing.
 */
export function useLocalDay(): string {
  const [day, setDay] = useState(() => dayKey(new Date()));
  useEffect(() => onClockTick(() => setDay(dayKey(new Date()))), []);
  return day;
}
