import { createHash, randomBytes } from "node:crypto";
import { chmod, lstat, open, realpath, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

const OUTSIDE_MESSAGE = "Path is outside the allowed folder";

/** Resolves `relative` under `root` and throws unless the real path stays inside `root`. */
export async function resolveInside(root: string, relative: string): Promise<string> {
  if (typeof relative !== "string" || relative === "" || relative.includes("\0") || isAbsolute(relative)) {
    throw new Error(OUTSIDE_MESSAGE);
  }
  const realRoot = await realpath(root);
  const target = resolve(realRoot, relative);
  if (!isInside(realRoot, target)) throw new Error(OUTSIDE_MESSAGE);

  // The target usually does not exist yet. Its closest existing ancestor decides where it would really land,
  // and a symlink anywhere on the way must not lead out of the root.
  let existing = target;
  const missing: string[] = [];
  for (;;) {
    try {
      const real = await realpath(existing);
      if (!isInside(realRoot, real)) throw new Error(OUTSIDE_MESSAGE);
      return missing.length === 0 ? real : join(real, ...missing.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    // A dangling symlink looks missing to realpath but would be followed by a write.
    if (await isSymlink(existing)) throw new Error(OUTSIDE_MESSAGE);
    const parent = dirname(existing);
    if (parent === existing || !isInside(realRoot, parent)) throw new Error(OUTSIDE_MESSAGE);
    missing.push(basename(existing));
    existing = parent;
  }
}

/** Writes through a temp file in the same folder, then renames, so readers never see a half-written file. */
export async function atomicWrite(path: string, content: string): Promise<void> {
  const temp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  const mode = await existingMode(path);
  let created = false;
  try {
    const handle = await open(temp, "wx", mode ?? 0o644);
    created = true;
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (mode !== null) await chmod(temp, mode);
    await rename(temp, path);
    created = false;
  } finally {
    if (created) await unlink(temp).catch(() => undefined);
  }
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function isInside(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

async function isSymlink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch {
    return false;
  }
}

async function existingMode(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mode & 0o7777;
  } catch {
    return null;
  }
}
