import { spawn } from "node:child_process";

export interface ProcessOptions {
  command: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
}

export interface ProcessResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  /** True when more output was produced than the cap allowed; the head was kept. */
  stdoutCut: boolean;
  stderrCut: boolean;
  timedOut: boolean;
  durationMs: number;
  /** Set when the process could not be started at all, for example because the compiler is missing. */
  spawnError: string | null;
}

/** After the process ends, wait this long for its pipes to drain before giving up on stragglers that kept them open. */
const DRAIN_GRACE_MS = 1000;

const liveGroups = new Set<number>();

export function killLiveProcessGroups(): void {
  for (const pid of liveGroups) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // The group is already gone.
    }
  }
  liveGroups.clear();
}

/**
 * Runs one program with an argument array (never a shell), no stdin, capped output and a hard timeout.
 * The child leads its own process group so a timeout, or an exit that leaves children behind, kills them all.
 */
export function runProcess(options: ProcessOptions): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const started = performance.now();
    const stdout = new Capture(options.maxStdoutBytes);
    const stderr = new Capture(options.maxStderrBytes);
    let timedOut = false;
    let exitCode: number | null = null;
    let signal: string | null = null;
    let finished = false;
    let timeout: NodeJS.Timeout | undefined;
    let grace: NodeJS.Timeout | undefined;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(options.command, [...options.args], {
        cwd: options.cwd,
        env: { ...options.env },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
        windowsHide: true,
      });
      if (child.pid !== undefined) liveGroups.add(child.pid);
    } catch (error) {
      resolve(failedToStart(started, error));
      return;
    }

    const killGroup = (): void => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // The group is already gone.
      }
    };

    const finish = (spawnError: string | null): void => {
      if (child.pid !== undefined) liveGroups.delete(child.pid);
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      clearTimeout(grace);
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve({
        exitCode,
        signal,
        stdout: stdout.text(),
        stderr: stderr.text(),
        stdoutCut: stdout.cut,
        stderrCut: stderr.cut,
        timedOut,
        durationMs: Math.round(performance.now() - started),
        spawnError,
      });
    };

    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => finish(describeSpawnError(error)));
    child.on("exit", (code, sig) => {
      exitCode = code;
      signal = sig;
      killGroup();
      grace = setTimeout(() => finish(null), DRAIN_GRACE_MS);
    });
    child.on("close", () => finish(null));

    timeout = setTimeout(() => {
      timedOut = true;
      killGroup();
      grace ??= setTimeout(() => finish(null), DRAIN_GRACE_MS);
    }, options.timeoutMs);
  });
}

/** Keeps the first `maxBytes` bytes of `text`, cutting on a character boundary. */
export function truncateUtf8(text: string, maxBytes: number): { text: string; cut: boolean } {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) return { text, cut: false };
  return { text: dropIncompleteUtf8(bytes.subarray(0, maxBytes)).toString("utf8"), cut: true };
}

class Capture {
  private readonly chunks: Buffer[] = [];
  private kept = 0;
  cut = false;

  constructor(private readonly max: number) {}

  push(chunk: Buffer): void {
    const room = this.max - this.kept;
    if (room <= 0) {
      this.cut = true;
      return;
    }
    if (chunk.length > room) {
      this.chunks.push(chunk.subarray(0, room));
      this.kept = this.max;
      this.cut = true;
      return;
    }
    this.chunks.push(chunk);
    this.kept += chunk.length;
  }

  text(): string {
    const joined = Buffer.concat(this.chunks);
    return (this.cut ? dropIncompleteUtf8(joined) : joined).toString("utf8");
  }
}

/** A cut in the middle of a multi-byte character would otherwise end the text with a replacement character. */
function dropIncompleteUtf8(buffer: Buffer): Buffer {
  let index = buffer.length - 1;
  let continuation = 0;
  while (index >= 0 && continuation < 3 && (buffer[index]! & 0xc0) === 0x80) {
    index--;
    continuation++;
  }
  if (index < 0) return buffer;
  const lead = buffer[index]!;
  const needed = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
  return needed > continuation + 1 ? buffer.subarray(0, index) : buffer;
}

function failedToStart(started: number, error: unknown): ProcessResult {
  return {
    exitCode: null,
    signal: null,
    stdout: "",
    stderr: "",
    stdoutCut: false,
    stderrCut: false,
    timedOut: false,
    durationMs: Math.round(performance.now() - started),
    spawnError: describeSpawnError(error),
  };
}

function describeSpawnError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === undefined ? "could not start the process" : `could not start the process (${code})`;
}
