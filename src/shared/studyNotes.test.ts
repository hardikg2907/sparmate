import { describe, expect, it } from "vitest";
import { draftCountText, notesWereSaved } from "./studyNotes";

describe("notesWereSaved", () => {
  it("stays true after a new draft resets the applied count", () => {
    expect(notesWereSaved({ proposalId: "p2", status: "draft", appliedCount: 0, savedAt: "2026-10-30T10:00:00.000Z" })).toBe(true);
    expect(notesWereSaved({ proposalId: "p1", status: "applied", appliedCount: 3, savedAt: null })).toBe(true);
    expect(notesWereSaved({ proposalId: "p1", status: "draft", appliedCount: 0, savedAt: null })).toBe(false);
    expect(notesWereSaved(null)).toBe(false);
  });
});

describe("draftCountText", () => {
  const op = (file: string, blocked: string | null = null) => ({ file, blocked });
  it("counts only the changes that can be saved, and their files", () => {
    expect(draftCountText([op("TRACKER.md"), op("TRACKER.md"), op("REVIEW.md")])).toBe("This draft has 3 changes in 2 files.");
    expect(draftCountText([op("TRACKER.md"), op("(invalid)", "The operation is not valid")])).toBe("This draft has 1 change in 1 file, and 1 that cannot be applied.");
    expect(draftCountText([op("TRACKER.md", "blocked")])).toBe("Nothing in this draft can be saved.");
  });
});
