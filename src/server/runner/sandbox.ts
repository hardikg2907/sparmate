import { existsSync, lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";

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
 * Both paths must be real paths: the sandbox compares resolved paths, so a symlinked
 * temp folder such as /var/... would never match and every write would be denied.
 */
export function buildSandboxProfile(writableDir: string, privateRoot: string = realHome()): string {
  return [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    "(deny file-write*)",
    `(allow file-write* (subpath ${quote(writableDir)}))`,
    '(allow file-write* (literal "/dev/null") (literal "/dev/tty") (literal "/dev/stdout") (literal "/dev/stderr") (literal "/dev/dtracehelper"))',
    // Later rules win, so the build folder stays readable even when it sits inside the private root.
    `(deny file-read-data (subpath ${quote(privateRoot)}))`,
    `(allow file-read-data (subpath ${quote(writableDir)}))`,
  ].join("\n");
}

/**
 * Bubblewrap invocation for Linux containers. Constructs a minimal isolated root holding only system
 * libraries and compilers, leaving study roots and home folders unmounted and inaccessible.
 */
export function buildLinuxSandboxInvocation(
  program: string,
  writableDir: string,
  _privateRoots: readonly string[] = [realHome()],
): { command: string; args: string[] } {
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

  args.push(
    "--bind", writableDir, writableDir,
    "--unshare-all",
    "--die-with-parent",
  );

  if (prlimit) {
    args.push(
      prlimit,
      "--as=1073741824",
      "--cpu=10",
      "--nproc=64",
      "--fsize=16777216",
      program,
    );
  } else {
    args.push(program);
  }

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

function quote(path: string): string {
  if (/\p{Cc}/u.test(path)) throw new Error("Unsafe path for a sandbox profile");
  return `"${path.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
