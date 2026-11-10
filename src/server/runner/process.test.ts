import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ProcessOptions, runProcess } from "./process";

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

describe("runProcess start report", () => {
  const LIMIT = 5000;
  const STARTUP = 10_000;
  // The child is a shell standing in for a built program; "$0" is the build folder, and fd 3 is the status pipe.
  const reporting = (script: string): Promise<Awaited<ReturnType<typeof runProcess>>> =>
    runProcess({
      command: "/bin/sh",
      args: ["-c", script, dir],
      cwd: dir,
      env: { PATH: "/usr/bin:/bin" },
      timeoutMs: LIMIT,
      startupTimeoutMs: STARTUP,
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024,
    } satisfies ProcessOptions);
  const waitFor = (name: string): string => `while [ ! -e "$0/${name}" ]; do sleep 0.01; done`;

  /**
   * Waits until the child has made `name`, then lets the runner read what the child wrote before it. The pipe is
   * already readable then, so one turn of the event loop picks it up; a few more cost nothing.
   */
  async function afterChild(name: string): Promise<void> {
    await until(() => existsSync(join(dir, name)));
    for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve));
  }

  it("kills a program that never reports its start at the start-up limit", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
    const kill = vi.spyOn(process, "kill");
    const result = reporting(': > "$0/ready"; exec sleep 30');

    await afterChild("ready");
    vi.advanceTimersByTime(STARTUP - 1);
    expect(kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(kill).toHaveBeenCalledTimes(1);

    await expect(result).resolves.toMatchObject({ timedOut: true, startupTimedOut: true, signal: "SIGKILL", durationMs: STARTUP });
  });

  it("starts the limit at the report, so the kill lands one limit after it, and measures the run from there", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
    const kill = vi.spyOn(process, "kill");
    const result = reporting(`${waitFor("go")}; printf s >&3; : > "$0/ready"; exec sleep 30`);

    const reportAt = 3000;
    vi.advanceTimersByTime(reportAt);
    writeFileSync(join(dir, "go"), "");
    await afterChild("ready");
    vi.advanceTimersByTime(LIMIT - 1);
    expect(kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(kill).toHaveBeenCalledTimes(1);

    await expect(result).resolves.toMatchObject({ timedOut: true, startupTimedOut: false, signal: "SIGKILL", durationMs: LIMIT });
  });

  it("ignores later reports and junk on the pipe, so a program cannot push its limit back", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
    const kill = vi.spyOn(process, "kill");
    const result = reporting(`printf s >&3; : > "$0/ready"; ${waitFor("go")}; printf 'sss junk s' >&3; : > "$0/again"; exec sleep 30`);

    await afterChild("ready");
    vi.advanceTimersByTime(3000);
    writeFileSync(join(dir, "go"), "");
    await afterChild("again");
    vi.advanceTimersByTime(LIMIT - 3000 - 1);
    expect(kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(kill).toHaveBeenCalledTimes(1);

    await expect(result).resolves.toMatchObject({ timedOut: true, startupTimedOut: false, durationMs: LIMIT });
  });

  it("starts the limit when the program closes the pipe without reporting", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
    const kill = vi.spyOn(process, "kill");
    const result = reporting('exec 3>&-; : > "$0/ready"; exec sleep 30');

    await afterChild("ready");
    vi.advanceTimersByTime(LIMIT);
    expect(kill).toHaveBeenCalledTimes(1);

    await expect(result).resolves.toMatchObject({ timedOut: true, startupTimedOut: false, durationMs: LIMIT });
  });

  it("keeps measuring from the spawn when the start report is read only after the exit", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
    const kill = vi.spyOn(process, "kill");
    // A leftover in its own process group keeps the pipe and writes the report once the program has exited.
    const leftover =
      'perl -e \'exit 0 if fork; setpgrp(0, 0); open(STDOUT, ">", "/dev/null"); open(STDERR, ">", "/dev/null"); alarm 10; ' +
      'select(undef, undef, undef, 0.01) until -e "$ARGV[0]/go"; open(my $s, ">&=", 3); syswrite($s, "s");\' "$0"';
    const result = reporting(`${leftover}; exit 0`);

    // The runner kills the group as soon as it sees the exit.
    await until(() => kill.mock.calls.length > 0);
    vi.advanceTimersByTime(300);
    writeFileSync(join(dir, "go"), "");

    await expect(result).resolves.toMatchObject({ exitCode: 0, timedOut: false, durationMs: 300 });
  });

  it("stops the group at once when the program reports passing its memory cap", async () => {
    const result = await reporting("printf s >&3; printf m >&3; exec sleep 30");
    expect(result).toMatchObject({ memoryExceeded: true, timedOut: false, startupTimedOut: false, signal: "SIGKILL" });
  });

  it("opens no status pipe without a start-up limit", async () => {
    const result = await runProcess({
      command: "/bin/sh",
      args: ["-c", "printf s >&3 && echo open || echo closed"],
      cwd: dir,
      env: { PATH: "/usr/bin:/bin" },
      timeoutMs: 20_000,
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024,
    });
    expect(result.stdout).toBe("closed\n");
  });
});

describe("runProcess after the exit", () => {
  it("reports no time-out when the limit passes while a leftover still holds the pipes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const kill = vi.spyOn(process, "kill");
    const result = runProcess({
      command: "/bin/sh",
      args: ["-c", "perl -e 'exit 0 if fork; setpgrp(0, 0); sleep 3'; echo done"],
      cwd: dir,
      env: { PATH: "/usr/bin:/bin" },
      timeoutMs: 500,
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024,
    });

    await until(() => kill.mock.calls.length > 0);
    vi.advanceTimersByTime(500);
    expect(kill).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);

    await expect(result).resolves.toMatchObject({ exitCode: 0, signal: null, timedOut: false, stdout: "done\n" });
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
