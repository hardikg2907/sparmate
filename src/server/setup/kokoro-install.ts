import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { KOKORO_ASSETS, KOKORO_MIN_PYTHON, KOKORO_PIP_PINS, type KokoroAsset } from "../tts/kokoro-assets";
import type { SetupDeps } from "./checks";

/** Newest first, so the best interpreter wins; plain `python3` is last because it is often too old on macOS. */
const PYTHON_CANDIDATES = ["python3.13", "python3.12", "python3.11", "python3"] as const;
export const PYTHON_INSTALL_HINT = "brew install python@3.12";

const VERSION_PROBE = "import sys; print('%d.%d' % sys.version_info[:2])";
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;

export function parsePythonVersion(text: string): { major: number; minor: number } | null {
  const match = /^(\d+)\.(\d+)$/.exec(text.trim());
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : null;
}

export function versionAtLeast(version: { major: number; minor: number }, min: { major: number; minor: number }): boolean {
  return version.major > min.major || (version.major === min.major && version.minor >= min.minor);
}

/** The first Python on the PATH that is new enough for onnxruntime, or null. */
export async function findQualifyingPython(spawn: SetupDeps["spawn"]): Promise<string | null> {
  for (const command of PYTHON_CANDIDATES) {
    const probe = await spawn(command, ["-c", VERSION_PROBE], 10_000);
    if (!probe.finished || probe.exitCode !== 0) continue;
    const version = parsePythonVersion(probe.stdout);
    if (version && versionAtLeast(version, KOKORO_MIN_PYTHON)) return command;
  }
  return null;
}

export async function sha256OfFile(path: string): Promise<string | null> {
  try {
    await stat(path);
  } catch {
    return null;
  }
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

export interface DownloadOptions {
  url: string;
  dest: string;
  sha256: string;
  onProgress?: (receivedBytes: number, totalBytes: number | null) => void;
  /** Tests only: lets a local server stand in for the real host. */
  allowHttp?: boolean;
  fetchImpl?: typeof fetch;
}

function isSecure(url: string, allowHttp: boolean): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || (allowHttp && protocol === "http:");
  } catch {
    return false;
  }
}

/** Streams to `<dest>.part` while hashing, and renames only after the hash matches. */
export async function downloadVerified(options: DownloadOptions): Promise<void> {
  const { url, dest, sha256, onProgress, allowHttp = false } = options;
  if (!isSecure(url, allowHttp)) throw new Error("The download address is not HTTPS.");
  const partial = `${dest}.part`;
  const response = await (options.fetchImpl ?? fetch)(url, { redirect: "follow", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  // A redirect can lead anywhere, so the address that actually answered is checked before the body is read.
  if (!isSecure(response.url || url, allowHttp)) {
    await response.body?.cancel();
    throw new Error("The download was redirected to an address that is not HTTPS.");
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`The download failed with status ${response.status}.`);
  }
  const lengthHeader = Number(response.headers.get("content-length"));
  const total = Number.isFinite(lengthHeader) && lengthHeader > 0 ? lengthHeader : null;
  const hash = createHash("sha256");
  let received = 0;
  try {
    const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    body.on("data", (chunk: Buffer) => {
      hash.update(chunk);
      received += chunk.length;
      onProgress?.(received, total);
    });
    await pipeline(body, createWriteStream(partial, { mode: 0o600 }));
    if (hash.digest("hex") !== sha256) throw new Error("The downloaded file does not match its checksum, so it was discarded.");
    await rename(partial, dest);
  } catch (err) {
    await rm(partial, { force: true });
    throw err;
  }
}

export interface KokoroInstallOptions {
  kokoroHome: string;
  /** Prints a progress line. */
  log: (line: string) => void;
  /** Runs a program with its output shown to the user and resolves with its exit code. */
  runVisible: (command: string, args: readonly string[]) => Promise<number>;
  python: string;
  onProgress?: (asset: KokoroAsset, receivedBytes: number, totalBytes: number | null) => void;
  assets?: readonly KokoroAsset[];
  allowHttp?: boolean;
}

/** Creates the venv, installs the pinned packages and fetches whichever model files are missing or wrong. Throws on a real failure. */
export async function installKokoro(options: KokoroInstallOptions): Promise<void> {
  const { kokoroHome, log, runVisible } = options;
  const venv = join(kokoroHome, ".venv");
  await mkdir(kokoroHome, { recursive: true, mode: 0o700 });

  if (
    await access(join(venv, "bin", "python")).then(
      () => true,
      () => false,
    )
  ) {
    log("The Kokoro Python environment already exists.");
  } else {
    log("Creating the Kokoro Python environment...");
    if ((await runVisible(options.python, ["-m", "venv", venv])) !== 0) throw new Error("Creating the Python environment failed.");
  }
  log("Installing the Kokoro Python packages...");
  if ((await runVisible(join(venv, "bin", "pip"), ["install", ...KOKORO_PIP_PINS])) !== 0) throw new Error("Installing the Kokoro Python packages failed.");

  for (const asset of options.assets ?? KOKORO_ASSETS) {
    const dest = join(kokoroHome, asset.fileName);
    if ((await sha256OfFile(dest)) === asset.sha256) {
      log(`${asset.fileName} is already downloaded.`);
      continue;
    }
    log(`Downloading ${asset.fileName}...`);
    await downloadVerified({
      url: asset.url,
      dest,
      sha256: asset.sha256,
      allowHttp: options.allowHttp,
      onProgress: (received, total) => options.onProgress?.(asset, received, total),
    });
    log(`${asset.fileName} is verified.`);
  }
}
