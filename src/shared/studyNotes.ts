import type { ProposalOp, Session } from "./types";

/**
 * Whether study notes were ever saved for the round. A new draft resets the applied count but keeps the save time,
 * so "saved" does not flip back when the candidate drafts again.
 */
export function notesWereSaved(saved: Session["studyNotes"]): boolean {
  return saved !== null && saved !== undefined && (saved.appliedCount > 0 || saved.savedAt !== null);
}

/** The line above a draft: what can be saved, and what cannot. */
export function draftCountText(ops: readonly Pick<ProposalOp, "file" | "blocked">[]): string {
  const savable = ops.filter((op) => !op.blocked);
  const cannot = ops.length - savable.length;
  if (savable.length === 0) return "Nothing in this draft can be saved.";
  const files = new Set(savable.map((op) => op.file)).size;
  const counted = `This draft has ${savable.length} ${savable.length === 1 ? "change" : "changes"} in ${files} ${files === 1 ? "file" : "files"}`;
  return cannot > 0 ? `${counted}, and ${cannot} that cannot be applied.` : `${counted}.`;
}
