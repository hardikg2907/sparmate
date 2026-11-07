import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { initStudyKit, isDirectoryEmpty } from "./kit";

const here = dirname(fileURLToPath(import.meta.url));
const templateDir = resolve(here, "..", "..", "..", "study-kit");

describe("study kit creation", () => {
  it("populates an empty study directory with required template files", async () => {
    const studyRoot = await mkdtemp(join(tmpdir(), "ir-kit-empty-"));
    try {
      expect(await isDirectoryEmpty(studyRoot)).toBe(true);
      const res = await initStudyKit({ studyRoot, templateDir });
      expect(res.created).toEqual(["TRACKER.md", "REVIEW.md", "TEACHING.md", "ABOUT_ME.md", "notes/_TEMPLATE.md", "lld/compile_flags.txt"]);
      expect(existsSync(join(studyRoot, "TRACKER.md"))).toBe(true);
      expect(existsSync(join(studyRoot, "REVIEW.md"))).toBe(true);
      expect(existsSync(join(studyRoot, "TEACHING.md"))).toBe(true);
      expect(existsSync(join(studyRoot, "ABOUT_ME.md"))).toBe(true);
      expect(existsSync(join(studyRoot, "notes", "_TEMPLATE.md"))).toBe(true);
      expect(existsSync(join(studyRoot, "lld", "compile_flags.txt"))).toBe(true);

      const aboutMe = await readFile(join(studyRoot, "ABOUT_ME.md"), "utf8");
      expect(aboutMe).toContain("# Candidate Profile");
    } finally {
      await rm(studyRoot, { recursive: true, force: true });
    }
  });

  it("does not overwrite or create files if directory is not empty", async () => {
    const studyRoot = await mkdtemp(join(tmpdir(), "ir-kit-nonempty-"));
    try {
      const existingFile = join(studyRoot, "MY_NOTES.md");
      await writeFile(existingFile, "already here\n");
      const res = await initStudyKit({ studyRoot, templateDir });
      expect(res.created).toEqual([]);
      expect(existsSync(join(studyRoot, "TRACKER.md"))).toBe(false);
    } finally {
      await rm(studyRoot, { recursive: true, force: true });
    }
  });
});
