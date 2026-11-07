import { isPinTargetId, pinTargets } from "../../shared/graph/frames";
import { LIMITS } from "../../shared/protocol";
import type { BoardPin } from "../../shared/types";

/** Enough to mark every box worth a remark; a model stuck in a loop must not bury the board. */
// Control characters are stripped on purpose so a note cannot smuggle line breaks or escapes into a prompt.
// eslint-disable-next-line no-control-regex
const NOTE_CONTROL_CHARS = /[\u0000-\u001f\u007f\u2028\u2029]+/g;

export const MAX_PINS: Record<BoardPin["by"], number> = { guide: 30, judge: 12 };

export interface PinRequest {
  elementId: string;
  note: string;
  tone: BoardPin["tone"];
  by: BoardPin["by"];
  at: number;
}

/**
 * Checks a pin a model asked for against the board as it is now. The id must name a box or an arrow that exists,
 * and the note is reduced to one plain line, because the browser shows it as text next to his drawing.
 */
export function validatePin(
  elements: readonly Record<string, unknown>[],
  existing: readonly BoardPin[],
  req: PinRequest,
  newId: () => string,
): { pin: BoardPin; replaces: string | null } | { error: string } {
  if (!isPinTargetId(req.elementId)) return { error: "That is not an element id. Use an id from the pin targets list." };
  const target = pinTargets(elements).find((t) => t.id === req.elementId);
  if (!target) return { error: "No box or arrow on the board has that id. Use an id from the pin targets list." };
  const note = req.note.replace(NOTE_CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  if (note === "") return { error: "The note is empty." };
  if (note.length > LIMITS.pinNoteChars) return { error: `Keep the note under ${LIMITS.pinNoteChars} characters.` };
  // One pin per element and author: a second note on the same box replaces the first.
  const same = existing.find((p) => p.by === req.by && p.elementId === req.elementId);
  if (!same && existing.filter((p) => p.by === req.by).length >= MAX_PINS[req.by]) {
    return { error: "No more pins are allowed in this round." };
  }
  return {
    pin: { id: same?.id ?? newId(), elementId: req.elementId, phase: target.step, note, tone: req.tone, by: req.by, at: req.at },
    replaces: same?.id ?? null,
  };
}

export function withPin(pins: readonly BoardPin[], pin: BoardPin, replaces: string | null): BoardPin[] {
  return replaces === null ? [...pins, pin] : pins.map((p) => (p.id === replaces ? pin : p));
}
