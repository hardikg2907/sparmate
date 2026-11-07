/** How close to the end the log must be for a downward scroll to resume following new text. */
export const FOLLOW_ZONE_PX = 24;

/** At the very end the log keeps following, even when a shrinking reply nudged it upward. */
const END_PX = 2;

export interface ScrollReading {
  prevTop: number;
  top: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * Whether the chat should keep following new text after a scroll event. Direction decides, not distance alone: a
 * small upward scroll near the end means he wants to read, and a distance rule would snap him straight back while a
 * reply streams in.
 */
export function followAfterScroll(following: boolean, r: ScrollReading): boolean {
  const fromEnd = r.scrollHeight - r.top - r.clientHeight;
  if (fromEnd <= END_PX) return true;
  if (r.top < r.prevTop) return false;
  if (r.top > r.prevTop && fromEnd < FOLLOW_ZONE_PX) return true;
  return following;
}

const READ_BACK_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);

/** A key that scrolls the log back toward older messages. */
export function scrollsBack(key: string): boolean {
  return READ_BACK_KEYS.has(key);
}
