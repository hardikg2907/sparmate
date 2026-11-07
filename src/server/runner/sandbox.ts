import { existsSync, lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, sep } from "node:path";

export const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
export const BWRAP_EXEC = "/usr/bin/bwrap";
export const PRLIMIT_EXEC = "/usr/bin/prlimit";

export function findExecutable(candidates: string[]): string | null {
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

export function sandboxAvailable(platform: NodeJS.Platform = process.platform): boolean {
  if (platform === "darwin") {
    return existsSync(SANDBOX_EXEC);
  }
  if (platform === "linux") {
    return Boolean(findExecutable([BWRAP_EXEC, "/usr/local/bin/bwrap", "/bin/bwrap"]));
  }
  return false;
}

/**
 * A Seatbelt profile that denies all network use, every file write except inside `writableDir` and the
 * few device files a normal program touches, and reading file contents under `privateRoot` (the home
 * folder by default) except inside `writableDir`. Reads elsewhere stay allowed, because the dynamic
 * loader, libc++ and the sanitizer runtimes live in system folders. The program's output goes back to a
 * model, so it must not be able to print the user's files.
 *
 * Forking is denied too: macOS has no per-sandbox process limit, and a child that calls setsid() would leave the
 * process group and outlive the timeout. Threads are unaffected.
 *
 * Both paths must be real paths: the sandbox compares resolved paths, so a symlinked
 * temp folder such as /var/... would never match and every write would be denied.
 */
export function buildSandboxProfile(writableDir: string, privateRoot: string = realHome()): string {
  return [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    "(deny process-fork)",
    "(deny file-write*)",
    `(allow file-write* (subpath ${quote(writableDir)}))`,
    DEVICE_WRITES,
    // Later rules win, so the build folder stays readable even when it sits inside the private root.
    `(deny file-read-data (subpath ${quote(privateRoot)}))`,
    `(allow file-read-data (subpath ${quote(writableDir)}))`,
  ].join("\n");
}

/**
 * A Seatbelt profile for the compiler. Source text can pull in any file through #include or an assembler
 * .incbin, and diagnostics and the built program both reach the page and the model, so file contents are
 * readable only from an allow-list: the system, the toolchain, the build folder and the named input files.
 * Writes stay inside the build folder and network use is denied. Forking stays allowed because the compiler
 * driver starts the linker.
 *
 * Every path must be a real path, for the same reason as in buildSandboxProfile.
 */
export function buildCompileSandboxProfile(workDir: string, inputs: readonly string[], toolchainRoots: readonly string[] = toolchainReadRoots()): string {
  const roots = ["/usr", "/System", ...toolchainRoots];
  return [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    "(deny file-write*)",
    `(allow file-write* (subpath ${quote(workDir)}))`,
    DEVICE_WRITES,
    "(deny file-read-data)",
    // The root listing, the active-toolchain link and the time zone files are read by the toolchain itself.
    '(allow file-read-data (literal "/") (literal "/private/var/db/xcode_select_link") (subpath "/private/var/db/timezone"))',
    // Only devices with a fixed size, so an #include cannot read forever from /dev/zero or /dev/urandom.
    '(allow file-read-data (literal "/dev/null") (literal "/dev/dtracehelper") (literal "/dev/autofs_nowait"))',
    `(allow file-read-data ${roots.map((r) => `(subpath ${quote(r)})`).join(" ")})`,
    `(allow file-read-data (subpath ${quote(workDir)})${inputs.map((i) => ` (literal ${quote(i)})`).join("")})`,
  ].join("\n");
}

const COMMAND_LINE_TOOLS = "/Library/Developer/CommandLineTools";

/**
 * Folders the Apple toolchain reads from: the active developer folder (Command Line Tools or a whole Xcode
 * bundle, whose Info.plist sits outside Contents/Developer) and, for a compiler outside it, the compiler's
 * install prefix unless that prefix would open the home folder.
 */
export function toolchainReadRoots(compiler?: string): string[] {
  const roots = [COMMAND_LINE_TOOLS];
  try {
    const developer = realpathSync("/private/var/db/xcode_select_link");
    const bundle = /^(.*\.app)\/Contents\/Developer$/.exec(developer)?.[1];
    roots.push(bundle ?? developer);
  } catch {
    // No toolchain selected; the Command Line Tools path is the only candidate.
  }
  const prefix = compilerPrefix(compiler);
  if (prefix !== null) roots.push(prefix);
  return [...new Set(roots)];
}

/** The folder two levels above the real compiler binary, or null when that would expose the home folder or the root. */
export function compilerPrefix(compiler: string | undefined, home: string = realHome()): string | null {
  if (compiler === undefined) return null;
  let real: string;
  try {
    real = realpathSync(compiler);
  } catch {
    return null;
  }
  const prefix = dirname(dirname(real));
  if (prefix === "/" || prefix === home || home.startsWith(prefix + sep)) return null;
  return prefix;
}

/**
 * Runs `command` through /bin/sh with a file-size and CPU-time limit. macOS rejects memory rlimits and counts
 * processes per user, so those come from the memory watch and the sandbox instead. `exec` keeps the pid, so the
 * caller's process group and memory watch still apply.
 * The limits are numbers built here; the command and its arguments travel as positional parameters, never
 * as shell text.
 */
export function withProcessLimits(command: string, args: readonly string[], limits: { fileBytes: number; cpuSeconds: number }): { command: string; args: string[] } {
  const blocks = Math.max(1, Math.ceil(limits.fileBytes / 1024));
  const cpu = Math.max(1, Math.ceil(limits.cpuSeconds));
  return { command: "/bin/sh", args: ["-c", `ulimit -f ${blocks} && ulimit -t ${cpu} && exec "$0" "$@"`, command, ...args] };
}

export interface LinuxSandboxOptions {
  /** Arguments passed to `program`. */
  args?: readonly string[];
  /** Files or folders outside `writableDir` that must be readable, mounted read-only at the same path. */
  readOnly?: readonly string[];
  limits?: Partial<LinuxLimits>;
}

export interface LinuxLimits {
  addressSpaceBytes: number;
  cpuSeconds: number;
  processes: number;
  fileBytes: number;
}

const DEFAULT_LINUX_LIMITS: LinuxLimits = { addressSpaceBytes: 1073741824, cpuSeconds: 10, processes: 64, fileBytes: 16777216 };

/**
 * Bubblewrap invocation for Linux containers. Constructs a minimal isolated root holding only system
 * libraries and compilers, leaving study roots and home folders unmounted and inaccessible.
 */
export function buildLinuxSandboxInvocation(
  program: string,
  writableDir: string,
  _privateRoots: readonly string[] = [realHome()],
  options: LinuxSandboxOptions = {},
): { command: string; args: string[] } {
  const limits = { ...DEFAULT_LINUX_LIMITS, ...options.limits };
  const bwrap = findExecutable([BWRAP_EXEC, "/usr/local/bin/bwrap", "/bin/bwrap"]) ?? BWRAP_EXEC;
  const prlimit = findExecutable([PRLIMIT_EXEC, "/usr/local/bin/prlimit", "/bin/prlimit"]);

  const args: string[] = [
    "--ro-bind", "/usr", "/usr",
  ];

  for (const name of ["bin", "lib", "lib64", "sbin"]) {
    const rootPath = `/${name}`;
    const usrTarget = `/usr/${name}`;
    try {
      const stat = lstatSync(rootPath);
      if (stat.isSymbolicLink()) {
        args.push("--symlink", `usr/${name}`, rootPath);
      } else if (stat.isDirectory()) {
        args.push("--ro-bind", rootPath, rootPath);
      }
    } catch {
      if (existsSync(usrTarget)) {
        args.push("--symlink", `usr/${name}`, rootPath);
      }
    }
  }

  if (existsSync("/etc")) args.push("--ro-bind", "/etc", "/etc");
  // No /proc at all: the container's own would expose the server's environment, token included, and a rootless
  // container cannot mount a fresh one. Only the device files a normal program opens are bound.
  for (const dev of ["null", "zero", "random", "urandom"]) args.push("--dev-bind", `/dev/${dev}`, `/dev/${dev}`);
  args.push("--tmpfs", "/tmp");

  for (const path of options.readOnly ?? []) args.push("--ro-bind", path, path);
  args.push(
    "--bind", writableDir, writableDir,
    "--unshare-all",
    "--die-with-parent",
  );

  if (prlimit) {
    args.push(
      prlimit,
      `--as=${limits.addressSpaceBytes}`,
      `--cpu=${limits.cpuSeconds}`,
      `--nproc=${limits.processes}`,
      `--fsize=${limits.fileBytes}`,
    );
  }
  args.push(program, ...(options.args ?? []));

  return { command: bwrap, args };
}

export function realHome(): string {
  const home = homedir();
  try {
    return realpathSync(home);
  } catch {
    return home;
  }
}

const DEVICE_WRITES =
  '(allow file-write* (literal "/dev/null") (literal "/dev/tty") (literal "/dev/stdout") (literal "/dev/stderr") (literal "/dev/dtracehelper"))';

function quote(path: string): string {
  if (/\p{Cc}/u.test(path)) throw new Error("Unsafe path for a sandbox profile");
  return `"${path.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
