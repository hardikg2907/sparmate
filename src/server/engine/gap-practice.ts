import type { GapPractice, Session } from "../../shared/types";

/**
 * Sets or clears the practised mark of one gap on a debriefed round. A mark is set only for a gap its scorecard
 * holds, and cleared only by the gap round that set it, so a later round's mark is never removed by an older one.
 * Returns whether the session changed.
 */
export function applyGapPractice(session: Session, title: string, mark: GapPractice | null, roundId: string): boolean {
  const held = session.gapPractice?.[title];
  if (mark === null) {
    if (held?.sessionId !== roundId) return false;
    const rest = { ...session.gapPractice };
    delete rest[title];
    session.gapPractice = rest;
    return true;
  }
  if (!session.scorecard?.gaps.some((g) => g.title === title)) return false;
  if (held?.sessionId === mark.sessionId) return false;
  session.gapPractice = { ...session.gapPractice, [title]: mark };
  return true;
}
