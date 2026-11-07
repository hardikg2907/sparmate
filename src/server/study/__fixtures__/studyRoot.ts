import { readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// Exact-value tests run on this frozen set of study files, so a change to the starter kit never shifts their expectations.
export const SNAPSHOT_DIR = join(HERE, "study");

export function snapshotText(relative: string): string {
  return readFileSync(join(SNAPSHOT_DIR, relative), "utf8");
}

export const NOTES_FILE = "notes/b3-parking-lot.md";

export interface TempStudyRoot {
  root: string;
  read(relative: string): Promise<string>;
  write(relative: string, content: string): Promise<void>;
  cleanup(): Promise<void>;
}

/** A fresh temp study root holding copies of the frozen TRACKER.md, REVIEW.md, notes/_TEMPLATE.md and one notes file. */
export async function makeStudyRoot(): Promise<TempStudyRoot> {
  const root = await mkdtemp(join(tmpdir(), "ir-study-"));
  await mkdir(join(root, "notes"));
  await mkdir(join(root, "lld"));
  for (const file of ["TRACKER.md", "REVIEW.md", "notes/_TEMPLATE.md", NOTES_FILE]) {
    await copyFile(join(SNAPSHOT_DIR, file), join(root, file));
  }
  return {
    root,
    read: (relative) => readFile(join(root, relative), "utf8"),
    write: (relative, content) => writeFile(join(root, relative), content, "utf8"),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

/** A temp study root with hand-written TRACKER.md and REVIEW.md, for cases the real files cannot show. */
export async function makeCustomRoot(files: Record<string, string>): Promise<TempStudyRoot> {
  const root = await mkdtemp(join(tmpdir(), "ir-study-custom-"));
  await mkdir(join(root, "notes"));
  for (const [relative, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, relative)), { recursive: true });
    await writeFile(join(root, relative), content, "utf8");
  }
  return {
    root,
    read: (relative) => readFile(join(root, relative), "utf8"),
    write: (relative, content) => writeFile(join(root, relative), content, "utf8"),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
