import { describe, expect, it } from "vitest";
import { type CppRunner, OUTPUT_CUT_PATTERN, createCppRunnerWithLimits } from "./cpp";
import { buildSandboxProfile, withProcessLimits } from "./sandbox";
import { fixture, program, stopped, useRunnerFolders } from "./__fixtures__/cpp-kit";

let tmpRoot: string;
let runner: CppRunner;
useRunnerFolders((ready) => ({ tmpRoot, runner } = ready));

// A run's limit and its length count from the program's start report, so loading a fresh binary costs it nothing;
// the kernel's teardown after the kill still stretches on a busy machine. That the kill lands at the limit is
// checked in process.test.ts against a clock the machine's load cannot move; these tests check the sandboxed path.
describe("timeouts", () => {
  it("stops an infinite loop and reports a timeout, keeping the output it produced", async () => {
    const limit = 500;
    const quick = createCppRunnerWithLimits({ tmpRoot }, { runTimeoutMs: limit });
    const { run: ran } = await quick.compileAndRun(fixture("infinite.cpp"));
    expect(ran).toMatchObject({ timedOut: true, exitCode: null, signal: "SIGKILL", stdout: "started\n" });
    expect(ran!.durationMs).toBeGreaterThanOrEqual(limit - 50);
  });

  it("uses a five second limit by default", async () => {
    const { run: ran } = await runner.compileAndRun(fixture("infinite.cpp"));
    expect(ran).toMatchObject({ timedOut: true, signal: "SIGKILL" });
    expect(ran!.durationMs).toBeGreaterThanOrEqual(4900);
  }, 30_000);

  it("starts the limit when the program starts, so a limit shorter than starting a fresh binary still lets it finish", async () => {
    const quick = createCppRunnerWithLimits({ tmpRoot }, { runTimeoutMs: 250 });
    const { run: ran } = await quick.compileAndRun(fixture("hello.cpp"));
    expect(ran).toMatchObject({ exitCode: 0, timedOut: false, stdout: "hello from the candidate\n6\n", stderr: "" });
    expect(ran!.durationMs).toBeLessThan(250);
  });

  it("counts the user's own initializers against the limit, because the start report runs before them", async () => {
    const quick = createCppRunnerWithLimits({ tmpRoot }, { runTimeoutMs: 500 });
    const source =
      "#include <chrono>\n#include <cstdio>\n" +
      "static int spun = [] {\n  const auto end = std::chrono::steady_clock::now() + std::chrono::seconds(1);\n" +
      "  while (std::chrono::steady_clock::now() < end) {\n  }\n  return 1;\n}();\n" +
      'int main() { std::puts("main"); return spun - 1; }\n';
    const { run: ran } = await quick.compileAndRun(await program("slow_initializer.cpp", source));
    expect(ran).toMatchObject({ timedOut: true, signal: "SIGKILL", stdout: "" });
  });

  it("lets main() end with pthread_exit() and exits as the last thread would", async () => {
    const source = '#include <cstdio>\n#include <pthread.h>\nint main() {\n  std::puts("bye");\n  pthread_exit(nullptr);\n}\n';
    const { run: ran } = await runner.compileAndRun(await program("pthread_exit.cpp", source));
    expect(ran).toMatchObject({ exitCode: 0, signal: null, timedOut: false, stdout: "bye\n", stderr: "" });
  });

  it("is not confused by a program that writes to fd 3 or opens a file there", async () => {
    const quick = createCppRunnerWithLimits({ tmpRoot }, { runTimeoutMs: 1000 });
    const source =
      "#include <cstdio>\n#include <fcntl.h>\n#include <unistd.h>\n" +
      'int main() {\n  bool wrote = write(3, "m", 1) == 1;\n  int fd = open("mine.txt", O_CREAT | O_WRONLY, 0600);\n' +
      '  std::printf("wrote %d fd %d\\n", wrote, fd);\n  std::fflush(stdout);\n  usleep(300000);\n  return 0;\n}\n';
    const { run: ran } = await quick.compileAndRun(await program("fd_three.cpp", source));
    expect(ran).toMatchObject({ exitCode: 0, signal: null, timedOut: false, stdout: "wrote 0 fd 3\n", stderr: "" });
  });

  it("stops a program that hangs before it reports its start, at the start-up limit, and says so", async () => {
    // The program's own write() replaces the one the start report calls, so it hangs where loading would.
    const quick = createCppRunnerWithLimits({ tmpRoot }, { runTimeoutMs: 100, runStartupTimeoutMs: 2000 });
    const source = '#include <unistd.h>\nextern "C" ssize_t write(int, const void*, size_t) {\n  for (;;) sleep(1);\n}\nint main() { return 0; }\n';
    const { run: ran } = await quick.compileAndRun(await program("never_reports.cpp", source));
    expect(ran).toMatchObject({ timedOut: true, signal: "SIGKILL", stdout: "" });
    expect(ran!.stderr).toContain("The program did not start within 2 seconds and was stopped.");
    expect(ran!.durationMs).toBeGreaterThanOrEqual(1950);
  });

  it("kills the whole process group, so a child the program left behind does not survive", async () => {
    // Unsandboxed, because the sandbox refuses the fork this test needs.
    const unsandboxed = { tmpRoot, sandbox: false };
    const quick = createCppRunnerWithLimits(unsandboxed, { runTimeoutMs: 500 });
    const { run: ran } = await quick.compileAndRun(fixture("fork_loop.cpp"));
    expect(ran!.timedOut).toBe(true);

    // The child shares the program's stdout, so the run cannot end before the child has died too.
    const childPid = Number(/child (\d+)/.exec(ran!.stdout)?.[1]);
    expect(childPid).toBeGreaterThan(1);
    expect(stopped(childPid)).toBe(true);
  });

  it("stops a compile that takes too long and says so", async () => {
    const impatient = createCppRunnerWithLimits({ tmpRoot }, { compileTimeoutMs: 1 });
    const result = await impatient.compileAndRun(fixture("hello.cpp"));
    expect(result.run).toBeNull();
    expect(result.compile.ok).toBe(false);
    expect(result.compile.stderr).toMatch(/did not finish within/);
    expect(result.compile.diagnostics[0]!.message).toMatch(/did not finish/);
  });
});

describe("output caps", () => {
  it("keeps the head of 1 MB of output and says it was cut", async () => {
    const { run: ran } = await runner.compileAndRun(fixture("big_output.cpp"));
    expect(ran!.exitCode).toBe(0);
    expect(ran!.timedOut).toBe(false);

    expect(OUTPUT_CUT_PATTERN.test(ran!.stdout)).toBe(true);
    expect(ran!.stdout.length).toBeLessThan(64 * 1024 + 200);
    expect(ran!.stdout.startsWith("line 00000 0123456789012345678901234567890123456789\nline 00001 ")).toBe(true);
    const body = ran!.stdout.replace(/\n\[output cut at \d+ KB\]\n$/, "");
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(64 * 1024);
    expect(Buffer.byteLength(body, "utf8")).toBeGreaterThan(64 * 1024 - 100);
    expect(
      body
        .split("\n")
        .slice(0, -1)
        .every((line, i) => line.startsWith(`line ${String(i).padStart(5, "0")} `)),
    ).toBe(true);

    expect(OUTPUT_CUT_PATTERN.test(ran!.stderr)).toBe(true);
    expect(ran!.stderr.startsWith("err 00000 ")).toBe(true);
  });

  it("does not cut output that fits", async () => {
    const { run: ran } = await runner.compileAndRun(fixture("hello.cpp"));
    expect(OUTPUT_CUT_PATTERN.test(ran!.stdout)).toBe(false);
  });

  it("cuts on a character boundary", async () => {
    const { run: ran } = await runner.compileAndRun(fixture("multibyte_output.cpp"));
    expect(ran!.stdout).not.toContain("\uFFFD");
    const body = ran!.stdout.replace(/\n\[output cut at \d+ KB\]\n$/, "");
    expect(body).toMatch(/^\u20AC+$/);
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(64 * 1024);
  });

  it("applies the cap to the compiler's output too", async () => {
    // A template that fails deep inside produces far more than 64 KB of notes.
    const lines = Array.from({ length: 3000 }, (_, i) => `  int v${i} = undeclared_${i};`).join("\n");
    const path = await program("many_errors.cpp", `int main() {\n${lines}\n}\n`);
    const result = await runner.syntaxCheck(path);
    expect(result.ok).toBe(false);
    expect(Buffer.byteLength(result.stderr, "utf8")).toBeLessThan(64 * 1024 + 200);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.length).toBeLessThanOrEqual(200);
  });
});

describe("process and resource limits", () => {
  const sleepUntilGone = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it("leaves no child that called setsid() alive after the run returns", async () => {
    const source =
      "#include <cerrno>\n#include <cstdio>\n#include <cstring>\n#include <unistd.h>\n" +
      "int main() {\n  pid_t child = fork();\n  if (child == 0) { setsid(); sleep(30); _exit(0); }\n" +
      '  if (child < 0) std::printf("fork refused: %s\\n", std::strerror(errno));\n  else std::printf("child %d\\n", static_cast<int>(child));\n  return 0;\n}\n';
    const { run: ran } = await runner.compileAndRun(await program("setsid_child.cpp", source));
    const pid = Number(/child (\d+)/.exec(ran!.stdout)?.[1] ?? 0);
    if (process.platform === "darwin") expect(ran!.stdout).toBe("fork refused: Operation not permitted\n");
    if (pid > 0) {
      await sleepUntilGone(300);
      expect(alive(pid)).toBe(false);
    }
  });

  it("stops a fork bomb within the time limit", async () => {
    // Bounded at 64 processes, so even a broken sandbox cannot hurt the machine.
    const source =
      "#include <cstdio>\n#include <unistd.h>\n" +
      "int main() {\n  pid_t first = getpid();\n  int made = 0;\n  for (int i = 0; i < 6; i++) if (fork() > 0) made++;\n" +
      '  if (getpid() == first) { std::printf("forks %d\\n", made); std::fflush(stdout); }\n  volatile unsigned long spin = 0;\n  while (true) spin = spin + 1;\n}\n';
    const limit = 500;
    const quick = createCppRunnerWithLimits({ tmpRoot }, { runTimeoutMs: limit });
    const { run: ran } = await quick.compileAndRun(await program("fork_bomb.cpp", source));
    expect(ran).toMatchObject({ timedOut: true, signal: "SIGKILL" });
    expect(ran!.durationMs).toBeGreaterThanOrEqual(limit - 50);
    if (process.platform === "darwin") expect(ran!.stdout).toBe("forks 0\n");
  });

  it.skipIf(process.platform !== "darwin")("stops a program that keeps allocating memory close to the cap, well before the time limit", async () => {
    // Bounded at 1 GB, so a broken watch cannot exhaust the machine either. Each step prints how far it got.
    const source =
      "#include <cstdio>\n#include <cstdlib>\n#include <cstring>\n" +
      "int main() {\n  const std::size_t step = 16u << 20;\n  for (int i = 0; i < 64; i++) {\n" +
      "    char* block = static_cast<char*>(std::malloc(step));\n    if (!block) return 2;\n    std::memset(block, 1, step);\n" +
      '    std::printf("%d\\n", (i + 1) * 16);\n    std::fflush(stdout);\n  }\n' +
      "  volatile unsigned long spin = 0;\n  while (true) spin = spin + 1;\n}\n";
    const capped = createCppRunnerWithLimits({ tmpRoot }, { runTimeoutMs: 4000, runMemoryBytes: 128 * 1024 * 1024 });
    const { run: ran } = await capped.compileAndRun(await program("memory_bomb.cpp", source));
    // Not timed out, so the memory watch stopped it before the limit did.
    expect(ran).toMatchObject({ timedOut: false, signal: "SIGKILL" });
    expect(ran!.stderr).toContain("The program used more than 128 MB of memory and was stopped.");
    const reached = Number(ran!.stdout.trim().split("\n").at(-1));
    // The cap is passed during the step after 112 MB at the earliest, so less would mean no progress was read.
    expect(reached).toBeGreaterThanOrEqual(112);
    // The rss poll alone lets this program reach 288 MB or more, so this bound needs the program's own watch.
    expect(reached).toBeLessThanOrEqual(160);
  });

  it.skipIf(process.platform !== "darwin")("stops a compiler that passes its memory cap", async () => {
    // The watch samples memory with ps, which is slow on a busy machine, so a small file can finish compiling
    // before the first sample arrives. Expanding 4 million array elements keeps the compiler busy for seconds,
    // and bounds it below 1 GB if the watch is broken.
    const macros = ["#define A0 0,", ...Array.from({ length: 22 }, (_, i) => `#define A${i + 1} A${i} A${i}`)];
    const slow = await program("slow_compile.cpp", `${macros.join("\n")}\nint a[] = { A22 };\nint main() { return 0; }\n`);
    const tiny = createCppRunnerWithLimits({ tmpRoot }, { compileMemoryBytes: 1024 * 1024 });
    const check = await tiny.syntaxCheck(slow);
    expect(check.ok).toBe(false);
    expect(check.stderr).toContain("The compiler used more than 1 MB of memory and was stopped.");
  });

  it("stops a program that writes a file larger than 16 MB", async () => {
    const source =
      "#include <cstdio>\n#include <vector>\n" +
      'int main() {\n  std::vector<char> chunk(1 << 20, \'x\');\n  std::FILE* f = std::fopen("big.bin", "w");\n' +
      "  for (int i = 0; i < 32; i++) { std::fwrite(chunk.data(), 1, chunk.size(), f); std::fflush(f); }\n" +
      '  std::puts("wrote 32 MB");\n}\n';
    const { run: ran } = await runner.compileAndRun(await program("big_file.cpp", source));
    expect(ran!.stdout).not.toContain("wrote 32 MB");
    expect(ran!.signal).toBe("SIGXFSZ");
  });

  it("still lets a program use threads", async () => {
    const source =
      "#include <iostream>\n#include <mutex>\n#include <thread>\n#include <vector>\n" +
      "int main() {\n  std::mutex m;\n  int total = 0;\n  std::vector<std::thread> pool;\n" +
      "  for (int i = 1; i <= 4; i++) pool.emplace_back([&, i] { std::lock_guard<std::mutex> lock(m); total += i; });\n" +
      '  for (auto& t : pool) t.join();\n  std::cout << "total " << total << "\\n";\n}\n';
    const { run: ran } = await runner.compileAndRun(await program("threads.cpp", source));
    expect(ran).toMatchObject({ exitCode: 0, stdout: "total 10\n" });
  });

  it("builds a run profile that refuses forks and a limits wrapper that passes the command as arguments", () => {
    expect(buildSandboxProfile("/tmp/build")).toContain("(deny process-fork)");
    const wrapped = withProcessLimits("/usr/bin/sandbox-exec", ["-p", "(version 1)", "/tmp/a b/program"], { fileBytes: 16 * 1024 * 1024, cpuSeconds: 10 });
    expect(wrapped).toEqual({
      command: "/bin/sh",
      args: ["-c", 'ulimit -f 16384 && ulimit -t 10 && exec "$0" "$@"', "/usr/bin/sandbox-exec", "-p", "(version 1)", "/tmp/a b/program"],
    });
  });
});
