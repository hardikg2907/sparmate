import { createHash, randomBytes } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";

/** Temp file plus rename in the same folder, so a crash never leaves a half-written file behind. */
export async function writeFileAtomic(path: string, data: string | Uint8Array, mode = 0o600): Promise<void> {
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, data, { mode });
  try {
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

export async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function randomId(bytes = 6): string {
  return randomBytes(bytes).toString("hex");
}

/** Local calendar date, because the study files date everything in the user's own time zone. */
export function localDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Decodes base64 and returns the bytes only when they really are a PNG. */
export function decodePng(base64: string): Buffer | null {
  if (base64.length < 12 || base64.length % 4 !== 0 || !BASE64.test(base64)) return null;
  const buf = Buffer.from(base64, "base64");
  if (buf.length < PNG_SIGNATURE.length) return null;
  return PNG_SIGNATURE.every((b, i) => buf[i] === b) ? buf : null;
}
