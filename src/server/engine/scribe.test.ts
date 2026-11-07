import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readStudyFile, reviewHeaderAndLastEntry } from "./scribe";

describe("reviewHeaderAndLastEntry", () => {
  const review = [
    "# Spaced Repetition",
    "",
    "```",
    "## <Topic ID> — <name> · taught YYYY-MM-DD",
    "```",
    "",
    "---",
    "",
    "<!-- append below -->",
    "",
    "## A4 — first · taught 2026-08-27",
    "1. q",
    "",
    "---",
    "",
    "## B3 — last · taught 2026-10-25",
    "1. q",
    "Result: not yet asked.",
  ].join("\n");

  it("splits at the append marker and takes the last real entry", () => {
    const { header, lastEntry } = reviewHeaderAndLastEntry(review);
    expect(header.endsWith("<!-- append below -->")).toBe(true);
    expect(header).toContain("## <Topic ID>");
    expect(lastEntry.startsWith("## B3 — last")).toBe(true);
    expect(lastEntry).toContain("Result: not yet asked.");
  });

  it("skips headings inside fences when there is no marker", () => {
    const { header, lastEntry } = reviewHeaderAndLastEntry("# H\n```\n## fenced\n```\n## Real · taught x\nbody");
    expect(header).toBe("# H\n```\n## fenced\n```");
    expect(lastEntry).toBe("## Real · taught x\nbody");
  });
});

describe("readStudyFile", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("reads allowed files, returns null when missing and refuses other paths and links out", async () => {
    dir = await mkdtemp(join(tmpdir(), "ir-study-"));
    await mkdir(join(dir, "notes"));
    await writeFile(join(dir, "TRACKER.md"), "t");
    await writeFile(join(tmpdir(), "ir-outside.md"), "secret");
    await symlink(join(tmpdir(), "ir-outside.md"), join(dir, "notes", "evil.md"));
    expect(await readStudyFile(dir, "TRACKER.md")).toBe("t");
    expect(await readStudyFile(dir, "notes/missing.md")).toBeNull();
    await expect(readStudyFile(dir, "../etc/passwd")).rejects.toThrow();
    await expect(readStudyFile(dir, "notes/evil.md")).rejects.toThrow(/outside/);
  });
});
