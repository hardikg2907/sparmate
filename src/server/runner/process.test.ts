import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runProcess } from "./process";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "run-process-"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

/** Waits on real time; setImmediate is left unfaked so the child's progress can be watched while the runner's clock stands still. */
async function until(check: () => boolean): Promise<void> {
  while (!check()) await new Promise((resolve) => setImmediate(resolve));
}

describe("runProcess time limit", () => {
  // The runner's clock is faked and the child is real, so these checks hold however busy the machine is:
  // the kill depends only on the limit, and the result only on the child's death.
  it("kills the group when the limit passes, not before, and returns as soon as the program is dead", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const kill = vi.spyOn(process, "kill");
    const ready = join(dir, "ready");
    const result = runProcess({
      command: "/bin/sh",
      args: ["-c", 'echo started; : > "$0"; exec sleep 30', ready],
      cwd: dir,
      env: { PATH: "/usr/bin:/bin" },
      timeoutMs: 5000,
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024,
    });

    await until(() => existsSync(ready));
    vi.advanceTimersByTime(4999);
    expect(kill).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(kill).toHaveBeenCalledTimes(1);
    const [target, signal] = kill.mock.calls[0]!;
    expect(signal).toBe("SIGKILL");
    expect(target).toBeLessThan(0);

    // No timer moves from here on, so a result that waited out the drain grace would never arrive.
    await expect(result).resolves.toMatchObject({ timedOut: true, exitCode: null, signal: "SIGKILL", stdout: "started\n", spawnError: null });
  });
});

describe("runProcess memory watch", () => {
  // The program never ends by itself, so only the watch can stop it, however long each memory sample takes.
  it.skipIf(process.platform !== "darwin")("kills a group that passes its memory cap", async () => {
    const result = await runProcess({
      command: "/bin/sh",
      args: ["-c", "exec sleep 30"],
      cwd: dir,
      env: { PATH: "/usr/bin:/bin" },
      timeoutMs: 20_000,
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024,
      maxRssBytes: 1,
    });
    expect(result).toMatchObject({ memoryExceeded: true, timedOut: false, signal: "SIGKILL" });
  });
});
