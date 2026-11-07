import { useEffect, useRef, useState } from "react";
import { testHooksEnabled } from "../session/testHooks";

/** Ease-out cubic: fast at first, settling softly on the final value. */
export function countUpValue(target: number, progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  const eased = 1 - (1 - t) ** 3;
  const value = target * eased;
  return Number.isInteger(target) ? Math.round(value) : value;
}

/**
 * The final value at once when motion is reduced, in scripted test runs, and where there is no animation frame
 * (server or unit-test code), so nothing ever waits on the count.
 */
function countsUp(): boolean {
  if (typeof window === "undefined" || typeof requestAnimationFrame !== "function" || typeof matchMedia !== "function") return false;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  return !testHooksEnabled();
}

/**
 * Counts a number up from zero once, when the component first shows it. A later change of the target shows the new
 * value at once, so live data never replays the count.
 */
export function useCountUp(target: number, { duration = 900, delay = 150 }: { duration?: number; delay?: number } = {}): number {
  const [value, setValue] = useState(() => (countsUp() ? 0 : target));
  const played = useRef(false);

  useEffect(() => {
    if (played.current || !countsUp()) {
      played.current = true;
      setValue(target);
      return;
    }
    let frame = 0;
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      const progress = (now - start - delay) / duration;
      setValue(countUpValue(target, progress));
      if (progress < 1) frame = requestAnimationFrame(step);
      else played.current = true;
    };
    frame = requestAnimationFrame(step);
    // StrictMode runs the effect twice; the first run is cancelled here before it can mark the count as played.
    return () => cancelAnimationFrame(frame);
  }, [target, duration, delay]);

  return value;
}
