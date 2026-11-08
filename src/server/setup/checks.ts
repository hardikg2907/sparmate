import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import type { SetupCheck, SetupCheckId } from "../../shared/protocol";
import { DEFAULT_COMPILER } from "../runner/cpp";
import { kokoroFilesPresent, resolveKokoroPaths } from "../tts/kokoro";

export type { SetupCheck, SetupCheckId };

export interface SpawnOutcome {
  /** False when the program could not be started or did not finish in time. */
  finished: boolean;
  exitCode: number | null;
  stdout: string;
}

export interface SetupDeps {
  /** Runs one program from an argument array, never through a shell. */
  spawn(command: string, args: readonly string[], timeoutMs: number): Promise<SpawnOutcome>;
  exists(path: string): boolean;
  /** Resolves a module path the way Node does from this app, or throws. */
  resolveModule(specifier: string): string;
  platform: NodeJS.Platform;
  arch: string;
  preferMusl: boolean;
}

export interface SetupCheckOptions {
  kokoroHome: string;
  appRoot: string;
  /** The fake agent never signs in, so the sign-in check passes. */
  fakeAgent: boolean;
  compiler?: string;
  inContainer?: boolean;
}

const PROBE_TIMEOUT_MS = 10_000;
const FIX_LOCAL = "npm run setup";
const FIX_COMPILER = "xcode-select --install";
const FIX_CONTAINER = "./container/setup.sh (on Windows: .\\container\\setup.ps1)";

function runningInGlibcLessLinux(): boolean {
  if (process.platform !== "linux") return false;
  const report = typeof process.report?.getReport === "function" ? (process.report.getReport() as { header?: { glibcVersionRuntime?: string } }) : null;
  return report !== null && report.header?.glibcVersionRuntime === undefined;
}

const require = createRequire(import.meta.url);

export function defaultDeps(): SetupDeps {
  return {
    spawn: (command, args, timeoutMs) =>
      new Promise((resolve) => {
        execFile(command, [...args], { timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true }, (err, stdout) => {
          if (!err) return resolve({ finished: true, exitCode: 0, stdout: String(stdout) });
          // A numeric code is the program's own exit status; a string code (ENOENT) or a kill means it never ran to the end.
          const failure = err as { code?: unknown; killed?: boolean };
          if (typeof failure.code === "number" && !failure.killed) return resolve({ finished: true, exitCode: failure.code, stdout: String(stdout) });
          resolve({ finished: false, exitCode: null, stdout: "" });
        });
      }),
    exists: existsSync,
    resolveModule: (specifier) => require.resolve(specifier),
    platform: process.platform,
    arch: process.arch,
    preferMusl: runningInGlibcLessLinux(),
  };
}

/** The claude program that ships inside the Agent SDK's platform package, in the same order the SDK tries. */
export function findBundledClaude(deps: Pick<SetupDeps, "exists" | "resolveModule" | "platform" | "arch" | "preferMusl"> = defaultDeps()): string | null {
  const { platform, arch } = deps;
  const base = "@anthropic-ai/claude-agent-sdk";
  const packages =
    platform === "linux"
      ? deps.preferMusl
        ? [`${base}-linux-${arch}-musl`, `${base}-linux-${arch}`]
        : [`${base}-linux-${arch}`, `${base}-linux-${arch}-musl`]
      : [`${base}-${platform}-${arch}`];
  const file = platform === "win32" ? "claude.exe" : "claude";
  for (const name of packages) {
    try {
      const path = deps.resolveModule(`${name}/${file}`);
      if (deps.exists(path)) return path;
    } catch {
      // This platform package is not installed; try the next one.
    }
  }
  return null;
}

async function checkCompiler(compiler: string, fix: string, deps: SetupDeps): Promise<SetupCheck> {
  const base = { id: "compiler" as const, optional: false, title: "C++ compiler" };
  const probe = await deps.spawn(compiler, ["--version"], PROBE_TIMEOUT_MS);
  if (probe.finished && probe.exitCode === 0) return { ...base, ok: true, detail: "clang++ is installed." };
  return { ...base, ok: false, detail: "Machine-coding rounds need clang++ to compile and run your code.", fix };
}

async function checkClaudeLogin(opts: SetupCheckOptions, fix: string, deps: SetupDeps): Promise<SetupCheck> {
  const base = { id: "claude-login" as const, optional: false, title: "Claude sign-in" };
  if (opts.fakeAgent) return { ...base, ok: true, detail: "Test mode needs no sign-in." };
  const binary = findBundledClaude(deps);
  if (!binary) {
    return { ...base, ok: false, detail: "The Claude program is not installed. Install the app's packages first.", fix };
  }
  const probe = await deps.spawn(binary, ["auth", "status", "--json"], PROBE_TIMEOUT_MS);
  // Only the boolean is read. The same output also holds account details, which must never leave this function.
  let loggedIn: unknown;
  try {
    loggedIn = (JSON.parse(probe.stdout) as { loggedIn?: unknown }).loggedIn;
  } catch {
    loggedIn = undefined;
  }
  if (loggedIn === true) return { ...base, ok: true, detail: "You are signed in to Claude." };
  if (loggedIn === false) return { ...base, ok: false, detail: "Sign in once so the interviewer can answer.", fix };
  return { ...base, ok: false, detail: "The sign-in state could not be read.", fix };
}

function checkKokoro(opts: SetupCheckOptions, fix: string, deps: SetupDeps): SetupCheck {
  const base = { id: "kokoro" as const, optional: true, title: "Kokoro voice" };
  if (kokoroFilesPresent(resolveKokoroPaths(opts.kokoroHome, opts.appRoot), deps.exists)) return { ...base, ok: true, detail: "Spoken replies use the Kokoro voice." };
  return { ...base, ok: false, detail: "Spoken replies use your system voice until the Kokoro voice is installed.", fix };
}

/** Never throws: a check that fails to run reports itself as not ready. */
async function guarded(id: SetupCheckId, title: string, optional: boolean, fix: string, run: () => Promise<SetupCheck> | SetupCheck): Promise<SetupCheck> {
  try {
    return await run();
  } catch {
    return { id, ok: false, optional, title, detail: "This check could not run.", fix };
  }
}

export async function runSetupChecks(opts: SetupCheckOptions, deps: SetupDeps = defaultDeps()): Promise<SetupCheck[]> {
  const inContainer = opts.inContainer ?? process.env.SPARMATE_IN_CONTAINER === "1";
  const compilerFix = inContainer ? FIX_CONTAINER : FIX_COMPILER;
  const loginFix = inContainer ? FIX_CONTAINER : FIX_LOCAL;
  const voiceFix = inContainer ? FIX_CONTAINER : FIX_LOCAL;
  return Promise.all([
    guarded("compiler", "C++ compiler", false, compilerFix, () => checkCompiler(opts.compiler ?? DEFAULT_COMPILER, compilerFix, deps)),
    guarded("claude-login", "Claude sign-in", false, loginFix, () => checkClaudeLogin(opts, loginFix, deps)),
    guarded("kokoro", "Kokoro voice", true, voiceFix, () => checkKokoro(opts, voiceFix, deps)),
  ]);
}

/** A cached view of the checks. Start it at boot without waiting; reads re-run a failed result once it is stale. */
export class SetupStatus {
  private cached: Promise<SetupCheck[]> | null = null;
  private finishedAt = 0;

  constructor(
    private readonly run: () => Promise<SetupCheck[]>,
    private readonly staleAfterMs = 15_000,
    private readonly now: () => number = Date.now,
  ) {}

  start(): void {
    void this.refresh();
  }

  async get(): Promise<SetupCheck[]> {
    if (!this.cached) return this.refresh();
    const current = await this.cached;
    const stale = this.now() - this.finishedAt > this.staleAfterMs;
    if (stale && current.some((check) => !check.ok)) return this.refresh();
    return current;
  }

  private refresh(): Promise<SetupCheck[]> {
    const pending = this.run().catch((): SetupCheck[] => []);
    this.cached = pending;
    void pending.then(() => {
      if (this.cached === pending) this.finishedAt = this.now();
    });
    return pending;
  }
}
