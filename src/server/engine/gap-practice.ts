import type { GapPractice, Session } from "../../shared/types";

/** Whether a gap round has practised its source gap: it passed the gap's step with no "I'm stuck" on that step. */
export function practisesGap(round: Pick<Session, "focus" | "stepVerdicts" | "assists">): boolean {
  const step = round.focus?.source?.step;
  if (!step) return false;
  return round.stepVerdicts?.[step]?.verdict === "pass" && !(round.assists ?? []).some((a) => a.phase === step);
}

/**
 * Sets or clears the practised mark of one gap on a debriefed round. A mark is set only for a gap its scorecard
 * holds and only when none is held, so the first gap round that practised the gap keeps its link; a mark is cleared
 * only by the gap round that set it. Returns whether the session changed.
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
  if (held) return false;
  session.gapPractice = { ...session.gapPractice, [title]: mark };
  return true;
}
