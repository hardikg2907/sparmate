import { useEffect, useState } from "react";

/**
 * A soft countdown: it keeps counting past zero as overtime and never stops anything. `startedAt` is a browser
 * timestamp, or null before the clock starts.
 */
export function useCountdown(startedAt: number | null, totalMs: number): { remainingMs: number; over: boolean } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [startedAt]);
  const remainingMs = startedAt === null ? totalMs : totalMs - (now - startedAt);
  return { remainingMs, over: remainingMs < 0 };
}

/** "9:42" while time remains, "+0:23" in overtime. */
export function countdownText(remainingMs: number): string {
  const seconds = Math.ceil(Math.abs(remainingMs) / 1000);
  const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return remainingMs < 0 ? `+${text}` : text;
}
