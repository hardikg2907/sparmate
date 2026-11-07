import { constants, existsSync, realpathSync } from "node:fs";
import { access, chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parseClangDiagnostics, toUtf16Columns } from "../../shared/clang";
import type { CompileDiagnostic, RunResult } from "../../shared/types";
import { type ProcessResult, runProcess, truncateUtf8 } from "./process";
import {
  SANDBOX_EXEC,
  buildCompileSandboxProfile,
  buildLinuxSandboxInvocation,
  buildSandboxProfile,
  compilerPrefix,
  realHome,
  sandboxAvailable,
  toolchainReadRoots,
  withProcessLimits,
} from "./sandbox";

export interface CheckResult {
  ok: boolean;
  diagnostics: CompileDiagnostic[];
  stderr: string;
  durationMs: number;
}

export interface CppRunner {
  /** `clang++ -fsyntax-only` on the file in place. */
  syntaxCheck(sourcePath: string): Promise<CheckResult>;
  /** Compile the candidate's program and run its own main(). `at` is filled in by the caller. */
  compileAndRun(sourcePath: string): Promise<Omit<RunResult, "at">>;
  /** Compile the candidate's file with a harness main() (docs/SPEC.md section 8.2) and run it with sanitizers. */
  runHarness(candidatePath: string, harnessSource: string): Promise<Omit<RunResult, "at">>;
}

export interface CppRunnerOptions {
  /** Parent folder for temp build folders, for example DATA_DIR/runtime/cpp. */
  tmpRoot: string;
  compiler?: string;
  /** Set false only in tests that check behaviour without sandbox-exec. */
  sandbox?: boolean;
  /** The study folder, hidden from the Linux sandbox along with the home folder so submitted code cannot read it. */
  studyRoot?: string;
}

export interface RunnerLimits {
  syntaxCheckTimeoutMs: number;
  compileTimeoutMs: number;
  harnessCompileTimeoutMs: number;
  runTimeoutMs: number;
  harnessRunTimeoutMs: number;
  /** Cap for the stdout and for the stderr of a run, and for the compiler's stderr returned to the caller. */
  outputCapBytes: number;
  harnessMaxBytes: number;
  candidateMaxBytes: number;
  /** Resident memory caps on macOS, which enforces no memory rlimit; Linux uses prlimit's address-space limit. */
  runMemoryBytes: number;
  compileMemoryBytes: number;
}

export const RUNNER_LIMITS: Readonly<RunnerLimits> = {
  syntaxCheckTimeoutMs: 20_000,
  compileTimeoutMs: 30_000,
  harnessCompileTimeoutMs: 60_000,
  runTimeoutMs: 5_000,
  harnessRunTimeoutMs: 10_000,
  outputCapBytes: 64 * 1024,
  harnessMaxBytes: 100 * 1024,
  candidateMaxBytes: 1_000_000,
  runMemoryBytes: 1024 * 1024 * 1024,
  compileMemoryBytes: 2 * 1024 * 1024 * 1024,
};

/** Appended to cut output so the reader can see it is incomplete. */
export const OUTPUT_CUT_PATTERN = /\[output cut at \d+ KB\]/;

export type SanitizerMode = "address,undefined" | "undefined" | "none";

const DEFAULT_COMPILER = "/usr/bin/clang++";
const BASE_FLAGS = [
  "-std=c++17",
  "-Wall",
  "-Wextra",
  "-g",
  "-O0",
  "-fno-color-diagnostics",
  "-fdiagnostics-print-source-range-info",
  ...(process.platform === "linux" ? ["-stdlib=libc++"] : []),
  "-D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_DEBUG",
];

// The harness is compiled as one translation unit with the candidate's file included, so the candidate's classes
// are visible and its own main() is renamed out of the way. "#line 1" makes the tester's diagnostics count from
// the first line of its own code.
const HARNESS_HEADER = ["#define main candidate_main", '#include "candidate.cpp"', "#undef main", "// harness written by the tester follows", '#line 1 "harness.cpp"', ""].join(
  "\n",
);

/** Compile limits: far above what a single-file build needs, low enough to stop a runaway one. */
const COMPILE_ADDRESS_SPACE_BYTES = 4 * 1024 * 1024 * 1024;
const COMPILE_FILE_BYTES = 256 * 1024 * 1024;
/** The same file-size and CPU limits Linux runs get from prlimit. */
const RUN_FILE_BYTES = 16 * 1024 * 1024;
const RUN_CPU_SECONDS = 10;

/** The compiler's own stderr is read in full to find diagnostics; callers only get the first output cap of it. */
const COMPILER_STDERR_CAP = 256 * 1024;
const PROBE_SOURCE = '#include <cstdio>\n#include <vector>\nint main() { std::vector<int> v(4, 7); std::printf("probe ok %d\\n", v[2]); return 0; }\n';

const sanitizerProbes = new Map<string, Promise<SanitizerMode>>();

export function createCppRunner(options: CppRunnerOptions): CppRunner {
  return build(options, {}).runner;
}

/** Same as createCppRunner with the limits replaced, so tests do not need to wait out real timeouts. */
export function createCppRunnerWithLimits(options: CppRunnerOptions, overrides: Partial<RunnerLimits>): CppRunner {
  return build(options, overrides).runner;
}

/**
 * Which sanitizers work on this machine under the same sandbox settings the runner uses: both address and
 * undefined-behaviour checks, only the latter, or none. Decided once per compiler by building and running a
 * small program, because a sanitizer runtime that cannot start fails every run before main().
 */
export function detectSanitizers(options: CppRunnerOptions): Promise<SanitizerMode> {
  return build(options, {}).sanitizers();
}

function build(options: CppRunnerOptions, overrides: Partial<RunnerLimits>): { runner: CppRunner; sanitizers: () => Promise<SanitizerMode> } {
  const limits: RunnerLimits = { ...RUNNER_LIMITS, ...overrides };
  const compiler = options.compiler ?? DEFAULT_COMPILER;
  const wantSandbox = options.sandbox ?? true;

  const makeRunDir = async (): Promise<string> => {
    await mkdir(options.tmpRoot, { recursive: true, mode: 0o700 });
    // The sandbox compares real paths, and macOS temp folders live behind a symlink.
    return mkdtemp(join(await realpath(options.tmpRoot), "run-"));
  };

  const privateRoots = (): string[] => {
    const roots = [realHome()];
    if (options.studyRoot) {
      try {
        roots.push(realpathSync(options.studyRoot));
      } catch {
        roots.push(options.studyRoot);
      }
    }
    return roots;
  };

  /** `cwd` is a fresh build folder; it is the only place the compiler may write. */
  const compile = async (args: {
    cwd: string;
    inputs: readonly string[];
    flags: readonly string[];
    output: string | null;
    timeoutMs: number;
    reports: readonly Report[];
  }): Promise<CheckResult> => {
    if (wantSandbox && !sandboxAvailable()) {
      const message = "Refusing to compile code: no safe sandbox is available on this system (sandbox-exec on macOS, bubblewrap on Linux)\n";
      return { ok: false, diagnostics: [{ line: 1, column: 1, endLine: 1, endColumn: 2, severity: "error", message: message.trim() }], stderr: message, durationMs: 0 };
    }
    try {
      await access(compiler, constants.X_OK);
    } catch (error) {
      return interpretCompile(notStarted(error), args.reports, args.timeoutMs, limits.outputCapBytes, limits.compileMemoryBytes);
    }

    const argv = [...BASE_FLAGS, ...args.flags, ...(args.output === null ? [] : ["-o", args.output]), "--", ...args.inputs];
    let command = compiler;
    let commandArgs = argv;
    if (wantSandbox) {
      const outside = args.inputs.filter((i) => !isInside(i, args.cwd));
      if (process.platform === "darwin") {
        // An input may be reached through a symlink, so both spellings are allowed.
        const readable = [...new Set([...outside, ...(await Promise.all(outside.map(realInput)))])];
        const profile = buildCompileSandboxProfile(args.cwd, readable, toolchainReadRoots(compiler));
        const limited = withProcessLimits(SANDBOX_EXEC, ["-p", profile, compiler, ...argv], {
          fileBytes: COMPILE_FILE_BYTES,
          cpuSeconds: Math.ceil(args.timeoutMs / 1000) + 5,
        });
        command = limited.command;
        commandArgs = limited.args;
      } else if (process.platform === "linux") {
        const prefix = compilerPrefix(compiler);
        const box = buildLinuxSandboxInvocation(compiler, args.cwd, privateRoots(), {
          args: argv,
          // A missing input is left out so the compiler, not bubblewrap, reports it.
          readOnly: [...outside.filter((i) => existsSync(i)), ...(prefix !== null && !prefix.startsWith("/usr/") ? [prefix] : [])],
          limits: { addressSpaceBytes: COMPILE_ADDRESS_SPACE_BYTES, cpuSeconds: Math.ceil(args.timeoutMs / 1000) + 5, fileBytes: COMPILE_FILE_BYTES },
        });
        command = box.command;
        commandArgs = box.args;
      }
    }

    const run = await runProcess({
      command,
      args: commandArgs,
      cwd: args.cwd,
      // Apple's compiler shim keeps a lookup cache; pointing it at the build folder keeps its write inside the sandbox.
      env: environment(args.cwd, { xcrun_db: join(args.cwd, "xcrun_db") }),
      timeoutMs: args.timeoutMs,
      maxStdoutBytes: COMPILER_STDERR_CAP,
      maxStderrBytes: COMPILER_STDERR_CAP,
      maxRssBytes: limits.compileMemoryBytes,
    });
    return interpretCompile(run, args.reports, args.timeoutMs, limits.outputCapBytes, limits.compileMemoryBytes);
  };

  const execute = async (dir: string, program: string, timeoutMs: number, extraEnv: Record<string, string>): Promise<NonNullable<RunResult["run"]>> => {
    if (wantSandbox && !sandboxAvailable()) {
      return {
        exitCode: 1,
        signal: null,
        stdout: "",
        stderr: "Refusing to run code: no safe sandbox is available on this system (sandbox-exec on macOS, bubblewrap on Linux)\n",
        timedOut: false,
        durationMs: 0,
      };
    }
    const sandboxed = wantSandbox && sandboxAvailable();
    let command = program;
    let args: string[] = [];

    if (sandboxed) {
      if (process.platform === "darwin") {
        const limited = withProcessLimits(SANDBOX_EXEC, ["-p", buildSandboxProfile(dir), program], {
          fileBytes: RUN_FILE_BYTES,
          cpuSeconds: RUN_CPU_SECONDS,
        });
        command = limited.command;
        args = limited.args;
      } else if (process.platform === "linux") {
        const box = buildLinuxSandboxInvocation(program, dir, privateRoots());
        command = box.command;
        args = box.args;
      }
    }

    const run = await runProcess({
      command,
      args,
      cwd: dir,
      env: environment(dir, extraEnv),
      timeoutMs,
      maxStdoutBytes: limits.outputCapBytes,
      maxStderrBytes: limits.outputCapBytes,
      maxRssBytes: limits.runMemoryBytes,
    });
    const stderr = withCutNote(run.spawnError === null ? withoutProcNoise(run.stderr) : `${run.spawnError}\n`, run.stderrCut, limits.outputCapBytes);
    return {
      exitCode: run.exitCode,
      signal: run.signal,
      stdout: withCutNote(run.stdout, run.stdoutCut, limits.outputCapBytes),
      stderr: run.memoryExceeded ? `${stderr}\n${memoryNote("program", limits.runMemoryBytes)}\n` : stderr,
      timedOut: run.timedOut,
      durationMs: run.durationMs,
    };
  };

  /** Compiles and runs a trivial program with the sanitizer flags, so a runtime that cannot start is never used for real work. */
  const probe = async (mode: Exclude<SanitizerMode, "none">): Promise<boolean> => {
    const dir = await makeRunDir();
    try {
      const source = join(dir, "probe.cpp");
      await writeFile(source, PROBE_SOURCE);
      const built = await compile({
        cwd: dir,
        inputs: [source],
        flags: sanitizerFlags(mode),
        output: join(dir, "probe"),
        timeoutMs: limits.compileTimeoutMs,
        reports: [],
      });
      if (!built.ok) return false;
      const ran = await execute(dir, join(dir, "probe"), limits.harnessRunTimeoutMs, sanitizerEnvironment());
      return ran.exitCode === 0 && !ran.timedOut && ran.stdout.includes("probe ok 7");
    } finally {
      await removeDir(dir);
    }
  };

  const sanitizers = (): Promise<SanitizerMode> => {
    const key = `${compiler}\n${wantSandbox && sandboxAvailable()}`;
    let pending = sanitizerProbes.get(key);
    if (pending === undefined) {
      pending = (async (): Promise<SanitizerMode> => {
        if (await probe("address,undefined")) return "address,undefined";
        if (await probe("undefined")) return "undefined";
        return "none";
      })();
      sanitizerProbes.set(key, pending);
      // A failed probe says nothing about the machine, so it must not be remembered.
      pending.catch(() => sanitizerProbes.delete(key));
    }
    return pending;
  };

  const runner: CppRunner = {
    async syntaxCheck(sourcePath: string): Promise<CheckResult> {
      const source = resolve(sourcePath);
      const dir = await makeRunDir();
      try {
        return await compile({
          cwd: dir,
          inputs: [source],
          flags: ["-fsyntax-only"],
          output: null,
          timeoutMs: limits.syntaxCheckTimeoutMs,
          reports: [{ path: source, sourceText: await readSource(source), prefix: "" }],
        });
      } finally {
        await removeDir(dir);
      }
    },

    async compileAndRun(sourcePath: string): Promise<Omit<RunResult, "at">> {
      const source = resolve(sourcePath);
      const dir = await makeRunDir();
      try {
        const program = join(dir, "program");
        const compileResult = await compile({
          cwd: dir,
          inputs: [source],
          flags: [],
          output: program,
          timeoutMs: limits.compileTimeoutMs,
          reports: [{ path: source, sourceText: await readSource(source), prefix: "" }],
        });
        if (!compileResult.ok) return { compile: compileResult, run: null };
        return { compile: compileResult, run: await execute(dir, program, limits.runTimeoutMs, {}) };
      } finally {
        await removeDir(dir);
      }
    },

    async runHarness(candidatePath: string, harnessSource: string): Promise<Omit<RunResult, "at">> {
      if (Buffer.byteLength(harnessSource, "utf8") > limits.harnessMaxBytes) {
        throw new RangeError(`The harness is larger than ${Math.round(limits.harnessMaxBytes / 1024)} KB`);
      }
      const candidateBytes = await readFile(resolve(candidatePath));
      if (candidateBytes.length > limits.candidateMaxBytes) throw new RangeError("The candidate file is too large to test");
      const candidate = candidateBytes.toString("utf8");

      const mode = await sanitizers();
      const dir = await makeRunDir();
      try {
        const candidateFile = join(dir, "candidate.cpp");
        const harnessFile = join(dir, "harness.cpp");
        // Copied byte for byte, so the harness always sees exactly what is on disk.
        await writeFile(candidateFile, candidateBytes);
        await writeFile(harnessFile, HARNESS_HEADER + harnessSource);

        const program = join(dir, "program");
        const compileResult = await compile({
          cwd: dir,
          inputs: [harnessFile],
          flags: sanitizerFlags(mode),
          output: program,
          timeoutMs: limits.harnessCompileTimeoutMs,
          reports: [
            { path: candidateFile, sourceText: candidate, prefix: "" },
            { path: harnessFile, sourceText: harnessSource, prefix: "(harness) " },
          ],
        });
        if (!compileResult.ok) return { compile: compileResult, run: null };
        const run = await execute(dir, program, limits.harnessRunTimeoutMs, mode === "none" ? {} : sanitizerEnvironment());
        return { compile: compileResult, run };
      } finally {
        await removeDir(dir);
      }
    },
  };

  return { runner, sanitizers };
}

// ---------------------------------------------------------------------------

interface Report {
  path: string;
  /** The source text the diagnostics' columns refer to, or null when it cannot be read. */
  sourceText: string | null;
  prefix: string;
}

function sanitizerFlags(mode: SanitizerMode): string[] {
  return mode === "none" ? [] : [`-fsanitize=${mode}`, "-fno-omit-frame-pointer"];
}

function sanitizerEnvironment(): Record<string, string> {
  // Leak reports are noise for short test programs, and colour codes only get in the way of reading output.
  return { ASAN_OPTIONS: "color=never:detect_leaks=0", UBSAN_OPTIONS: "color=never" };
}

/** The Linux sandbox has no /proc, so the sanitizer warns that it cannot name the executable; the report itself is intact. */
function withoutProcNoise(stderr: string): string {
  return stderr.replace(/^==\d+==WARNING: reading executable name failed[^\n]*\n/gm, "");
}

/** A minimal environment: nothing from the server's own variables, such as tokens, reaches compiled code. */
function environment(dir: string, extra: Record<string, string>): Record<string, string> {
  return { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: dir, TMPDIR: dir, LANG: "en_US.UTF-8", ...extra };
}

function isInside(path: string, dir: string): boolean {
  const rel = relative(dir, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

async function realInput(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

function notStarted(error: unknown): ProcessResult {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return {
    exitCode: null,
    signal: null,
    stdout: "",
    stderr: "",
    stdoutCut: false,
    stderrCut: false,
    timedOut: false,
    memoryExceeded: false,
    durationMs: 0,
    spawnError: code === undefined ? "could not start the process" : `could not start the process (${code})`,
  };
}

async function readSource(path: string): Promise<string | null> {
  try {
    const text = await readFile(path, "utf8");
    return text.length > 2_000_000 ? null : text;
  } catch {
    return null;
  }
}

function interpretCompile(run: ProcessResult, reports: readonly Report[], timeoutMs: number, capBytes: number, memoryBytes: number): CheckResult {
  const ok = run.exitCode === 0 && !run.timedOut && !run.memoryExceeded && run.spawnError === null;

  let stderr = run.stderr;
  if (run.spawnError !== null) stderr = `The C++ compiler could not be started: ${run.spawnError}\n`;
  if (run.timedOut) stderr += `\nThe compiler did not finish within ${Math.round(timeoutMs / 1000)} seconds and was stopped.\n`;
  if (run.memoryExceeded) stderr += `\n${memoryNote("compiler", memoryBytes)}\n`;

  const diagnostics: CompileDiagnostic[] = [];
  for (const report of reports) {
    let found = parseClangDiagnostics(run.stderr, report.path);
    if (report.sourceText !== null) found = toUtf16Columns(found, report.sourceText);
    for (const diagnostic of found) {
      diagnostics.push(report.prefix === "" ? diagnostic : { ...diagnostic, message: report.prefix + diagnostic.message });
    }
  }
  if (!ok && !diagnostics.some((d) => d.severity === "error")) {
    // Link errors and driver failures have no source position; the editor still needs something to show.
    diagnostics.push({ line: 1, column: 1, endLine: 1, endColumn: 2, severity: "error", message: describeFailure(run, stderr, timeoutMs, memoryBytes) });
  }

  const capped = truncateUtf8(stderr, capBytes);
  return {
    ok,
    diagnostics,
    stderr: capped.cut || run.stderrCut ? `${capped.text}\n${cutNote(capBytes)}\n` : capped.text,
    durationMs: run.durationMs,
  };
}

function describeFailure(run: ProcessResult, stderr: string, timeoutMs: number, memoryBytes: number): string {
  if (run.spawnError !== null) return "The C++ compiler could not be started.";
  if (run.timedOut) return `The compiler did not finish within ${Math.round(timeoutMs / 1000)} seconds.`;
  if (run.memoryExceeded) return memoryNote("compiler", memoryBytes);
  if (/Undefined symbols/.test(stderr)) {
    const symbols = [...stderr.matchAll(/^\s+"(.+)", referenced from:/gm)].map((m) => m[1] ?? "");
    if (symbols.includes("_main")) return "Link error: the program has no main() function.";
    const shown = symbols
      .slice(0, 3)
      .map((s) => `"${s}"`)
      .join(", ");
    return `Link error: undefined ${symbols.length === 1 ? "symbol" : "symbols"} ${shown}${symbols.length > 3 ? ", ..." : ""}`;
  }
  const lines = stderr.split(/\r?\n/).map((l) => l.trim());
  const errorLine = lines.find((l) => /\b(?:fatal )?error: /.test(l)) ?? lines.find((l) => l !== "");
  const message = errorLine?.replace(/^.*?\b(?:fatal )?error: /, "") ?? "";
  return message === "" ? "The build failed." : `Build failed: ${message.slice(0, 300)}`;
}

function memoryNote(who: "program" | "compiler", bytes: number): string {
  return `The ${who} used more than ${Math.round(bytes / (1024 * 1024))} MB of memory and was stopped.`;
}

function cutNote(capBytes: number): string {
  return `[output cut at ${Math.round(capBytes / 1024)} KB]`;
}

function withCutNote(text: string, cut: boolean, capBytes: number): string {
  return cut ? `${text}\n${cutNote(capBytes)}\n` : text;
}

/**
 * Deletes a build folder even when the program inside it removed its own permissions.
 * A failed delete is reported but never thrown: the folder holds only build output, and every run gets a new one.
 */
async function removeDir(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await rm(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });
      return;
    } catch {
      // rm gives up at the first folder it cannot read while sibling deletions are still running,
      // so permissions are restored and the whole delete is tried again.
      await restorePermissions(dir);
    }
  }
  console.warn(`Could not remove the temporary build folder ${dir}`);
}

async function restorePermissions(path: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) return;
    if (!info.isDirectory()) {
      await chmod(path, 0o600);
      return;
    }
    await chmod(path, 0o700);
    for (const entry of await readdir(path)) await restorePermissions(join(path, entry));
  } catch {
    // The entry vanished or cannot be changed; the next delete attempt reports what is left.
  }
}
