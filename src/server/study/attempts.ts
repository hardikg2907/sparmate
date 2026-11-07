import { lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { resolveInside } from "./files";

const FOLDER = /^[a-z0-9][a-z0-9-]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TITLE_CHARS = 120;
const MAX_ATTEMPTS_PER_DAY = 999;
const ATTEMPT_FILE = /^lld\/([a-z0-9][a-z0-9-]*)\/(attempt-(\d{4}-\d{2}-\d{2})(?:-\d+)?\.cpp)$/;

/** The only content an attempt file has until the candidate writes code into it. */
export function attemptHeader(title: string, date: string): string {
  return `// ${oneLine(title)} — ${date}\n`;
}

/** Creates lld/<folder>/attempt-YYYY-MM-DD[-n].cpp with a one-line header; returns the path relative to the study root. */
export async function createAttemptFile(studyRoot: string, folder: string, title: string, date: string): Promise<string> {
  if (!FOLDER.test(folder)) throw new Error("Invalid problem folder");
  if (!DATE.test(date)) throw new Error("Invalid date");

  const header = attemptHeader(title, date);
  const folderPath = await resolveInside(studyRoot, `lld/${folder}`);
  await mkdir(folderPath, { recursive: true });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_DAY; attempt++) {
    const name = attempt === 1 ? `attempt-${date}.cpp` : `attempt-${date}-${attempt}.cpp`;
    // Re-resolve per candidate so a symlink planted at the file name cannot lead out of the study root.
    const path = await resolveInside(studyRoot, `lld/${folder}/${name}`);
    if (dirname(path) !== folderPath || basename(path) !== name) throw new Error("Path is outside the allowed folder");
    try {
      // "wx" makes creation and the existence check one step, so two rounds never share a file.
      const handle = await open(path, "wx", 0o644);
      try {
        await handle.writeFile(header, "utf8");
      } finally {
        await handle.close();
      }
      return `lld/${folder}/${name}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
  }
  throw new Error("Too many attempt files for one day");
}

/** The title goes into a // comment, so a line break would end the comment and turn the rest into code. */
function oneLine(title: string): string {
  const flat = title.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\s]+/gu, " ").trim();
  const chars = [...flat];
  return chars.length <= MAX_TITLE_CHARS ? flat : `${chars.slice(0, MAX_TITLE_CHARS - 1).join("")}…`;
}

export type AttemptRemoval = "removed" | "kept" | "missing";

/**
 * Deletes the attempt file of a discarded round, but only while it still holds just the header it was created
 * with. Anything else in it is the candidate's code and stays.
 */
export async function removeAttemptIfUntouched(studyRoot: string, relPath: string, title: string): Promise<AttemptRemoval> {
  const match = ATTEMPT_FILE.exec(relPath);
  const folder = match?.[1];
  const name = match?.[2];
  const date = match?.[3];
  if (!folder || !name || !date) throw new Error("Invalid attempt file path");

  const folderPath = await resolveInside(studyRoot, `lld/${folder}`);
  const path = await resolveInside(studyRoot, relPath);
  // A symlink at the file name would make the real path something else; never delete through one.
  if (dirname(path) !== folderPath || basename(path) !== name) return "kept";

  let size: number;
  try {
    const info = await lstat(path);
    if (!info.isFile()) return "kept";
    size = info.size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
  const header = attemptHeader(title, date);
  // The size check keeps a large file of real code from being read just to be compared.
  if (size !== Buffer.byteLength(header)) return "kept";
  if ((await readFile(path, "utf8")) !== header) return "kept";
  await unlink(path);
  return "removed";
}
