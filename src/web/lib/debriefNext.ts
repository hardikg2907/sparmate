import type { Mode } from "../../shared/phases";
import type { Readiness, Scorecard } from "../../shared/types";
import { currentGap, gapState, gapsComplete, type GapMark } from "./gapMarks";

type Gap = Scorecard["gaps"][number];

export type NextAction =
  | { kind: "answer_coach"; gap: Gap; label: string; button: string }
  | { kind: "start_gap"; gap: Gap; label: string; button: string }
  | { kind: "draft_notes"; label: string; button: string }
  | { kind: "try_interview"; label: string; button: string }
  | { kind: "practise_gap"; gap: Gap; label: string; button: string }
  | { kind: "home"; label: string; button: string };

export interface NextInput {
  /** The gaps, most serious first. */
  gaps: readonly Gap[];
  marks: ReadonlyMap<string, GapMark>;
  notesSaved: boolean;
  mode: Mode;
  /** The readiness call of a guided round; null for an interview round or a guided round saved before the call existed. */
  readiness: Readiness["call"] | null;
}

/**
 * The one thing the debrief points at. A gap that is with the coach or not started comes first, then the study
 * notes, then the step that follows the round: interview mode after a guided "ready", a practice round on the top
 * gap after "not yet", and home otherwise.
 */
export function nextAction({ gaps, marks, notesSaved, mode, readiness }: NextInput): NextAction {
  const gap = gapsComplete(gaps, marks) ? undefined : currentGap(gaps, marks);
  if (gap) {
    return gapState(marks.get(gap.title)) === "with_coach"
      ? { kind: "answer_coach", gap, label: `Answer the coach: ${gap.title}`, button: "Go to chat" }
      : { kind: "start_gap", gap, label: `Start: ${gap.title}`, button: "Teach me this" };
  }
  if (!notesSaved) return { kind: "draft_notes", label: "Draft your study notes", button: "Go to study notes" };
  if (mode === "guided" && readiness === "ready") return { kind: "try_interview", label: "Try interview mode", button: "Start interview" };
  const top = gaps[0];
  if (mode === "guided" && readiness === "not_yet" && top) return { kind: "practise_gap", gap: top, label: "Practise the top gap", button: "Practise this gap" };
  return { kind: "home", label: "Back to home", button: "Back to home" };
}
