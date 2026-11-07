import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type CppRunner, OUTPUT_CUT_PATTERN, createCppRunner, createCppRunnerWithLimits, detectSanitizers } from "./cpp";
import { buildCompileSandboxProfile, buildLinuxSandboxInvocation, buildSandboxProfile, sandboxAvailable, withProcessLimits } from "./sandbox";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => join(here, "__fixtures__", name);

let base: string;
let tmpRoot: string;
let scratch: string;
let runner: CppRunner;

async function leftovers(): Promise<string[]> {
  try {
    return await readdir(tmpRoot);
  } catch {
    return [];
  }
}

async function program(name: string, source: string): Promise<string> {
  const path = join(scratch, name);
  await writeFile(path, source);
  return path;
}

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "ir-runner-"));
  tmpRoot = join(base, "build", "cpp");
  scratch = join(base, "sources");
  await mkdir(scratch, { recursive: true });
  runner = createCppRunner({ tmpRoot });
});

afterEach(async () => {
  expect(await leftovers()).toEqual([]);
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("the sandbox is available on this machine", () => {
  it("has sandbox-exec, so the sandbox tests below mean something", () => {
    expect(sandboxAvailable()).toBe(true);
  });
});

describe("sandbox platform choice and refusal", () => {
  it("detects sandbox availability by platform", () => {
    expect(sandboxAvailable("darwin")).toBe(existsSync("/usr/bin/sandbox-exec"));
    expect(sandboxAvailable("win32")).toBe(false);
  });

  it("builds linux sandbox invocation with read-only root, isolated namespaces and limits", () => {
    const inv = buildLinuxSandboxInvocation("/app/prog", "/tmp/build", ["/home/test", "/study"]);
    expect(inv.command).toMatch(/bwrap$/);
    expect(inv.args).toContain("--ro-bind");
    expect(inv.args).not.toContain("--proc");
    expect(inv.args).not.toContain("/proc");
    expect(inv.args).toContain("/dev/null");
    expect(inv.args).toContain("--unshare-all");
    expect(inv.args).toContain("--die-with-parent");
    expect(inv.args).toContain("/tmp/build");
  });

  it("builds a linux compiler invocation that mounts only the named input file and passes the compiler's arguments", () => {
    const inv = buildLinuxSandboxInvocation("/usr/bin/clang++", "/tmp/build", ["/home/test"], {
      args: ["-fsyntax-only", "--", "/study/lld/a/attempt.cpp"],
      readOnly: ["/study/lld/a/attempt.cpp"],
      limits: { cpuSeconds: 25, addressSpaceBytes: 4294967296 },
    });
    const at = inv.args.indexOf("/study/lld/a/attempt.cpp");
    expect(inv.args.slice(at - 1, at + 2)).toEqual(["--ro-bind", "/study/lld/a/attempt.cpp", "/study/lld/a/attempt.cpp"]);
    expect(inv.args).not.toContain("/study");
    expect(inv.args).not.toContain("/home/test");
    expect(inv.args.slice(-4)).toEqual(["/usr/bin/clang++", "-fsyntax-only", "--", "/study/lld/a/attempt.cpp"]);
    if (inv.args.some((a) => a.endsWith("prlimit"))) {
      expect(inv.args).toContain("--cpu=25");
      expect(inv.args).toContain("--as=4294967296");
    }
  });

  it("refuses to compile code when sandbox is required but unavailable, because the compiler reads files too", async () => {
    const sandboxModule = await import("./sandbox");
    const spy = vi.spyOn(sandboxModule, "sandboxAvailable").mockReturnValue(false);
    try {
      const pickyRunner = createCppRunner({ tmpRoot, sandbox: true });
      const result = await pickyRunner.compileAndRun(fixture("hello.cpp"));
      expect(result.compile.ok).toBe(false);
      expect(result.run).toBeNull();
      expect(result.compile.stderr).toContain("Refusing to compile code: no safe sandbox is available");
      expect(result.compile.diagnostics[0]).toMatchObject({ severity: "error", message: expect.stringContaining("Refusing to compile code") });
      const check = await pickyRunner.syntaxCheck(fixture("hello.cpp"));
      expect(check.ok).toBe(false);
      expect(check.stderr).toContain("Refusing to compile code");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("compileAndRun", () => {
  it("compiles and runs a normal program", async () => {
    const result = await runner.compileAndRun(fixture("hello.cpp"));
    expect(result.compile).toMatchObject({ ok: true, diagnostics: [], stderr: "" });
    expect(result.compile.durationMs).toBeGreaterThan(0);
    expect(result.run).toMatchObject({
      exitCode: 0,
      signal: null,
      stdout: "hello from the candidate\n6\n",
      stderr: "",
      timedOut: false,
    });
    expect(result.run!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("reports a non-zero exit code and stderr", async () => {
    const { run: ran } = await runner.compileAndRun(fixture("exit_three.cpp"));
    expect(ran).toMatchObject({ exitCode: 3, signal: null, stdout: "before exit\n", stderr: "a problem on stderr\n", timedOut: false });
  });

  it("makes a hardened libc++ abort on an out-of-range access, as a signal", async () => {
    const { run: ran } = await runner.compileAndRun(fixture("hardening_abort.cpp"));
    expect(ran).toMatchObject({ exitCode: null, signal: "SIGABRT", stdout: "about to read out of range\n", timedOut: false });
  });

  it("reports a crash as a signal", async () => {
    const path = await program("segv.cpp", "int main() {\n  volatile int* p = nullptr;\n  *p = 1;\n  return 0;\n}\n");
    const { run: ran } = await runner.compileAndRun(path);
    expect(["SIGSEGV", "SIGBUS"]).toContain(ran!.signal);
    expect(ran!.exitCode).toBeNull();
  });

  it("returns diagnostics and no run for a compile error", async () => {
    const result = await runner.compileAndRun(fixture("broken.cpp"));
    expect(result.run).toBeNull();
    expect(result.compile.ok).toBe(false);
    expect(result.compile.diagnostics).toEqual([{ line: 4, column: 16, endLine: 4, endColumn: 29, severity: "error", message: "use of undeclared identifier 'missing_value'" }]);
    expect(result.compile.stderr).toContain("error: use of undeclared identifier 'missing_value'");
  });

  it("keeps warnings as diagnostics when the build succeeds", async () => {
    const result = await runner.compileAndRun(fixture("warning_only.cpp"));
    expect(result.compile.ok).toBe(true);
    expect(result.compile.diagnostics).toEqual([{ line: 4, column: 7, endLine: 4, endColumn: 13, severity: "warning", message: "unused variable 'unused' [-Wunused-variable]" }]);
    expect(result.run).toMatchObject({ exitCode: 0, stdout: "compiles with a warning\n" });
  });

  it("explains a missing main() instead of returning an empty diagnostic list", async () => {
    const result = await runner.compileAndRun(fixture("no_main.cpp"));
    expect(result.run).toBeNull();
    expect(result.compile.ok).toBe(false);
    expect(result.compile.stderr).toContain("Undefined symbols");
    expect(result.compile.diagnostics).toEqual([{ line: 1, column: 1, endLine: 1, endColumn: 2, severity: "error", message: "Link error: the program has no main() function." }]);
  });

  it("names the missing symbol for other link errors", async () => {
    const path = await program("undefined_function.cpp", "int helper(int x);\nint main() { return helper(2); }\n");
    const result = await runner.compileAndRun(path);
    expect(result.compile.diagnostics).toEqual([expect.objectContaining({ severity: "error", message: 'Link error: undefined symbol "helper(int)"' })]);
  });

  it("gives the program no stdin", async () => {
    const { run: ran } = await runner.compileAndRun(fixture("reads_stdin.cpp"));
    expect(ran).toMatchObject({ exitCode: 0, stdout: "stdin is empty\n", timedOut: false });
  });

  it("runs several programs at once without mixing them up", async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => runner.compileAndRun(fixture("hello.cpp"))));
    for (const result of results) expect(result.run!.stdout).toBe("hello from the candidate\n6\n");
  });

  it("copes with paths holding spaces and quotes, because nothing goes through a shell", async () => {
    const odd = join(scratch, `dir with 'single' and "double" $(touch pwned) ; touch pwned2 \`touch pwned3\``);
    await mkdir(odd);
    const path = join(odd, "hello world.cpp");
    await writeFile(path, '#include <cstdio>\nint main() { std::puts("odd path ok"); }\n');
    const result = await runner.compileAndRun(path);
    expect(result.run!.stdout).toBe("odd path ok\n");
    await runner.syntaxCheck(path);
    for (const folder of [odd, scratch, tmpRoot, process.cwd()]) {
      for (const name of ["pwned", "pwned2", "pwned3"]) expect(existsSync(join(folder, name))).toBe(false);
    }
  });

  it("does not hand the server's environment to compiled programs", async () => {
    process.env.SPARMATE_RUNNER_TEST_SECRET = "should-not-leak";
    try {
      const path = await program(
        "env.cpp",
        '#include <cstdio>\n#include <cstdlib>\nint main() {\n  const char* v = std::getenv("SPARMATE_RUNNER_TEST_SECRET");\n  std::printf("secret=%s\\n", v ? v : "(unset)");\n}\n',
      );
      expect((await runner.compileAndRun(path)).run!.stdout).toBe("secret=(unset)\n");
    } finally {
      delete process.env.SPARMATE_RUNNER_TEST_SECRET;
    }
  });

  it("creates the temp root on demand and removes each build folder afterwards", async () => {
    const fresh = join(base, "not-yet", "there");
    const local = createCppRunner({ tmpRoot: fresh });
    await local.compileAndRun(fixture("hello.cpp"));
    expect(await readdir(fresh)).toEqual([]);
  });

  it("removes the build folder even when the program locked part of it", async () => {
    const path = await program(
      "lock.cpp",
      '#include <sys/stat.h>\n#include <cstdio>\nint main() {\n  mkdir("locked", 0700);\n  std::FILE* f = std::fopen("locked/data.txt", "w");\n  if (f) { std::fputs("x", f); std::fclose(f); }\n  chmod("locked", 0000);\n  std::puts("locked");\n}\n',
    );
    const { run: ran } = await runner.compileAndRun(path);
    expect(ran!.stdout).toBe("locked\n");
  });
});

describe("timeouts", () => {
  it("stops an infinite loop and reports a timeout, keeping the output it produced", async () => {
    const quick = createCppRunnerWithLimits({ tmpRoot }, { runTimeoutMs: 700 });
    const started = Date.now();
    const { run: ran } = await quick.compileAndRun(fixture("infinite.cpp"));
    expect(ran).toMatchObject({ timedOut: true, exitCode: null, signal: "SIGKILL", stdout: "started\n" });
    expect(ran!.durationMs).toBeGreaterThanOrEqual(650);
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it("uses a five second limit by default", async () => {
    const { run: ran } = await runner.compileAndRun(fixture("infinite.cpp"));
    expect(ran!.timedOut).toBe(true);
    expect(ran!.durationMs).toBeGreaterThanOrEqual(4900);
    expect(ran!.durationMs).toBeLessThan(9000);
  }, 30_000);

  it("kills the whole process group, so a child the program left behind does not survive", async () => {
    // Unsandboxed, because the sandbox refuses the fork this test needs.
    const quick = createCppRunnerWithLimits({ tmpRoot, sandbox: false }, { runTimeoutMs: 800 });
    const started = Date.now();
    const { run: ran } = await quick.compileAndRun(fixture("fork_loop.cpp"));
    expect(ran!.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(15_000);

    const childPid = Number(/child (\d+)/.exec(ran!.stdout)?.[1]);
    expect(childPid).toBeGreaterThan(1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(() => process.kill(childPid, 0)).toThrow(/ESRCH/);
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

describe("syntaxCheck", () => {
  it("accepts a good file without producing a program", async () => {
    const result = await runner.syntaxCheck(fixture("hello.cpp"));
    expect(result).toMatchObject({ ok: true, diagnostics: [], stderr: "" });
  });

  it("reports the same diagnostics as a build", async () => {
    const result = await runner.syntaxCheck(fixture("broken.cpp"));
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([{ line: 4, column: 16, endLine: 4, endColumn: 29, severity: "error", message: "use of undeclared identifier 'missing_value'" }]);
  });

  it("treats warnings as success", async () => {
    const result = await runner.syntaxCheck(fixture("warning_only.cpp"));
    expect(result.ok).toBe(true);
    expect(result.diagnostics.map((d) => d.severity)).toEqual(["warning"]);
  });

  it("does not report a missing main() when only the syntax is checked", async () => {
    expect((await runner.syntaxCheck(fixture("no_main.cpp"))).ok).toBe(true);
  });

  it("returns an error diagnostic for a file that does not exist", async () => {
    const result = await runner.syntaxCheck(join(scratch, "nope.cpp"));
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.severity).toBe("error");
    expect(result.diagnostics[0]!.message).toMatch(/no such file/i);
  });

  it("reports columns in editor units when the line has non-ASCII text before the error", async () => {
    const source = '#include <iostream>\nint main() {\n  std::cout << "\u2192 \u00E9" << undeclared_name << "\\n";\n}\n';
    const path = await program("columns.cpp", source);
    const [diagnostic] = (await runner.syntaxCheck(path)).diagnostics;
    const line = source.split("\n")[2]!;
    expect(diagnostic).toMatchObject({ line: 3, column: line.indexOf("undeclared_name") + 1, endColumn: line.indexOf("undeclared_name") + 1 + "undeclared_name".length });
  });

  it("promotes an error raised inside a library header onto the line that caused it", async () => {
    const path = await program("header_error.cpp", "#include <map>\nstruct Key { int id; };\nint main() {\n  std::map<Key, int> m;\n  Key k{1};\n  m[k] = 2;\n}\n");
    const result = await runner.syntaxCheck(path);
    expect(result.ok).toBe(false);
    // The wording of the library's complaint differs between compiler versions; the line is what this test is about.
    expect(result.diagnostics[0]).toMatchObject({ line: 6, severity: "error", message: expect.stringMatching(/\S/) });
  });

  it("stops after the syntax-check time limit", async () => {
    const impatient = createCppRunnerWithLimits({ tmpRoot }, { syntaxCheckTimeoutMs: 1 });
    const result = await impatient.syntaxCheck(fixture("hello.cpp"));
    expect(result.ok).toBe(false);
    expect(result.stderr).toMatch(/did not finish within/);
  });
});

describe("a missing compiler", () => {
  it("returns a failed result instead of throwing", async () => {
    const broken = createCppRunner({ tmpRoot, compiler: join(base, "no-such-clang") });
    const check = await broken.syntaxCheck(fixture("hello.cpp"));
    expect(check.ok).toBe(false);
    expect(check.stderr).toMatch(/could not be started/);
    expect(check.diagnostics[0]).toMatchObject({ severity: "error", message: "The C++ compiler could not be started." });

    const built = await broken.compileAndRun(fixture("hello.cpp"));
    expect(built.compile.ok).toBe(false);
    expect(built.run).toBeNull();
  });
});

describe("harness runs", () => {
  it("includes the candidate's file, runs the harness main() and never the candidate's", async () => {
    const harness = await readFixture("harness_counter.cpp");
    const result = await runner.runHarness(fixture("candidate_counter.cpp"), harness);
    expect(result.compile.ok).toBe(true);
    expect(result.run).toMatchObject({ exitCode: 0, signal: null, stdout: "harness ok 3\n", timedOut: false });
    expect(result.run!.stdout).not.toContain("CANDIDATE MAIN RAN");
  });

  it("also renames a main() that takes arguments", async () => {
    const result = await runner.runHarness(fixture("candidate_argv_main.cpp"), await readFixture("harness_gate.cpp"));
    expect(result.run).toMatchObject({ exitCode: 0, stdout: "gate 7\n" });
  });

  it("passes the harness's exit code through", async () => {
    const result = await runner.runHarness(fixture("candidate_counter.cpp"), "int main() {\n  Counter c;\n  return c.total() + 4;\n}\n");
    expect(result.run).toMatchObject({ exitCode: 4, signal: null });
  });

  it("reports a compile error in the harness with a prefix and line numbers counted from the harness's own first line", async () => {
    const result = await runner.runHarness(fixture("candidate_counter.cpp"), "int main() {\n  Counter counter;\n  counter.nope();\n  return 0;\n}\n");
    expect(result.run).toBeNull();
    expect(result.compile.ok).toBe(false);
    const errors = result.compile.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toEqual([{ line: 3, column: 11, endLine: 3, endColumn: 15, severity: "error", message: "(harness) no member named 'nope' in 'Counter'" }]);
    expect(result.compile.stderr).toContain("harness.cpp:3:11");
  });

  it("reports a compile error in the candidate's file with the candidate's own line numbers and no prefix", async () => {
    const result = await runner.runHarness(fixture("candidate_broken.cpp"), "int main() {\n  Counter c;\n  return c.total();\n}\n");
    expect(result.run).toBeNull();
    expect(result.compile.diagnostics).toEqual([expect.objectContaining({ line: 5, severity: "error", message: "use of undeclared identifier 'missing_total'" })]);
  });

  it("rejects a harness over 100 KB and an unreadable candidate", async () => {
    await expect(runner.runHarness(fixture("candidate_counter.cpp"), `//${"x".repeat(101 * 1024)}\nint main() {}\n`)).rejects.toThrow(/larger than 100 KB/);
    await expect(runner.runHarness(join(scratch, "missing.cpp"), "int main() {}\n")).rejects.toThrow();
  });

  it("leaves the candidate's file untouched", async () => {
    const path = await program("untouched.cpp", "#include <iostream>\nstruct S { int v = 1; };\nint main() { return 9; }\n");
    const before = await readFile(path, "utf8");
    await runner.runHarness(path, "int main() { S s; return s.v - 1; }\n");
    expect(await readFile(path, "utf8")).toBe(before);
  });
});

describe("sanitizers", () => {
  it("finds at least the undefined-behaviour checks working, and remembers the answer", async () => {
    const mode = await detectSanitizers({ tmpRoot });
    expect(["address,undefined", "undefined"]).toContain(mode);
    expect(await detectSanitizers({ tmpRoot })).toBe(mode);
  });

  it("reports undefined behaviour in a harness build under the sandbox", async () => {
    const result = await runner.runHarness(fixture("candidate_counter.cpp"), await readFixture("harness_ub.cpp"));
    expect(result.compile.ok).toBe(true);
    expect(result.run!.stderr).toContain("runtime error: signed integer overflow");
    expect(result.run!.stdout).toContain("after overflow");
  });

  it("gives the same answer without the sandbox", async () => {
    const open = createCppRunner({ tmpRoot, sandbox: false });
    const result = await open.runHarness(fixture("candidate_counter.cpp"), await readFixture("harness_ub.cpp"));
    expect(result.run!.stderr).toContain("runtime error: signed integer overflow");
  });

  it("keeps AddressSanitizer working under the sandbox wherever the machine can run it at all", async (context) => {
    if (!(await addressSanitizerRunsOnThisMachine())) {
      context.skip("AddressSanitizer cannot start on this machine, with or without the sandbox");
    }
    expect(await detectSanitizers({ tmpRoot })).toBe("address,undefined");
    const result = await runner.runHarness(fixture("candidate_counter.cpp"), await readFixture("harness_heap_overflow.cpp"));
    expect(result.run!.exitCode).not.toBe(0);
    expect(result.run!.stderr).toContain("AddressSanitizer: heap-buffer-overflow");
  });
});

describe("the sandbox", () => {
  const outsidePath = (): string => join(tmpdir(), `ir-sandbox-${Math.random().toString(36).slice(2)}.txt`);
  const writeOutside = (path: string): string =>
    `#include <cerrno>\n#include <cstdio>\n#include <cstring>\nint main() {\n  std::FILE* f = std::fopen("${path}", "w");\n  if (f == nullptr) {\n    std::printf("outside write: denied (%s)\\n", std::strerror(errno));\n    return 0;\n  }\n  std::fputs("x", f);\n  std::fclose(f);\n  std::puts("outside write: created");\n  return 0;\n}\n`;

  it("denies a write outside the build folder, and the file is never created", async () => {
    const target = outsidePath();
    try {
      const { run: ran } = await runner.compileAndRun(await program("outside.cpp", writeOutside(target)));
      expect(ran!.exitCode).toBe(0);
      expect(ran!.stdout).toMatch(/^outside write: denied/);
      expect(existsSync(target)).toBe(false);
    } finally {
      await rm(target, { force: true });
    }
  });

  it("proves the denial comes from the sandbox: the same program creates the file without it", async () => {
    const target = outsidePath();
    try {
      const open = createCppRunner({ tmpRoot, sandbox: false });
      const { run: ran } = await open.compileAndRun(await program("outside_control.cpp", writeOutside(target)));
      expect(ran!.stdout).toBe("outside write: created\n");
      expect(existsSync(target)).toBe(true);
    } finally {
      await rm(target, { force: true });
    }
  });

  it("denies a write to a sibling folder of the build folder", async () => {
    const sibling = join(tmpRoot, "sibling-file.txt");
    const { run: ran } = await runner.compileAndRun(await program("sibling.cpp", writeOutside(sibling)));
    expect(ran!.stdout).toMatch(/^outside write: denied/);
    expect(existsSync(sibling)).toBe(false);
  });

  it("allows writes inside the build folder and the usual device files", async () => {
    const source = `#include <cstdio>\nint main() {\n  std::FILE* f = std::fopen("inside.txt", "w");\n  if (!f) { std::puts("inside write: FAILED"); return 1; }\n  std::fputs("data", f);\n  std::fclose(f);\n  char buf[8] = {};\n  f = std::fopen("inside.txt", "r");\n  std::fread(buf, 1, 4, f);\n  std::fclose(f);\n  std::FILE* nul = std::fopen("/dev/null", "w");\n  std::fputs("x", nul);\n  std::fclose(nul);\n  std::printf("inside write: %s null: ok\\n", buf);\n  std::fputs("to stderr\\n", stderr);\n  return 0;\n}\n`;
    const { run: ran } = await runner.compileAndRun(await program("inside.cpp", source));
    expect(ran).toMatchObject({ exitCode: 0, stdout: "inside write: data null: ok\n", stderr: "to stderr\n" });
  });

  const connectProgram = `#include <arpa/inet.h>\n#include <netinet/in.h>\n#include <sys/socket.h>\n#include <unistd.h>\n#include <cerrno>\n#include <cstdio>\nint main() {\n  int s = socket(AF_INET, SOCK_STREAM, 0);\n  sockaddr_in addr{};\n  addr.sin_family = AF_INET;\n  addr.sin_port = htons(9);\n  inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);\n  int r = connect(s, reinterpret_cast<sockaddr*>(&addr), sizeof addr);\n  std::printf("connect=%d errno=%d\\n", r, errno);\n  return 0;\n}\n`;

  it("denies a socket connection to 127.0.0.1", async () => {
    const { run: ran } = await runner.compileAndRun(await program("connect.cpp", connectProgram));
    // EPERM (1) is the sandbox saying no; a refused connection would be ECONNREFUSED (61).
    expect(ran!.stdout).toBe("connect=-1 errno=1\n");
  });

  it("proves the denial comes from the sandbox: without it the connection is attempted", async () => {
    const open = createCppRunner({ tmpRoot, sandbox: false });
    const { run: ran } = await open.compileAndRun(await program("connect_control.cpp", connectProgram));
    expect(ran!.stdout).not.toBe("connect=-1 errno=1\n");
  });

  it.skipIf(!sandboxAvailable())("denies reading files under the private root but not inside the build folder", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "ir-private-")));
    const build = join(root, "build");
    mkdirSync(build);
    writeFileSync(join(root, "secret.txt"), "secret");
    writeFileSync(join(build, "own.txt"), "own");
    const src = join(build, "r.cpp");
    writeFileSync(
      src,
      "#include <fstream>\n#include <iostream>\nint main(int, char** argv) {\n" +
        "  std::ifstream a(argv[1]); std::ifstream b(argv[2]);\n" +
        '  std::cout << (a.good() ? "secret-read" : "secret-denied") << " " << (b.good() ? "own-read" : "own-denied");\n}\n',
    );
    execFileSync("/usr/bin/clang++", ["-std=c++17", "-o", join(build, "r"), src]);
    const out = execFileSync("/usr/bin/sandbox-exec", ["-p", buildSandboxProfile(build, root), join(build, "r"), join(root, "secret.txt"), join(build, "own.txt")], {
      cwd: build,
    }).toString();
    rmSync(root, { recursive: true, force: true });
    expect(out).toBe("secret-denied own-read");
  });

  it("builds a profile that denies network and writes, and escapes the folder name", () => {
    const profile = buildSandboxProfile('/tmp/we"ird\\dir');
    expect(profile).toContain("(deny network*)");
    expect(profile).toContain("(deny file-write*)");
    expect(profile).toContain('(allow file-write* (subpath "/tmp/we\\"ird\\\\dir"))');
    for (const device of ["/dev/null", "/dev/tty", "/dev/stdout", "/dev/stderr", "/dev/dtracehelper"]) expect(profile).toContain(`(literal "${device}")`);
    expect(() => buildSandboxProfile("/tmp/new\nline")).toThrow();
  });

  it("works when the temp root's path contains a quote and a backslash", async () => {
    const odd = createCppRunner({ tmpRoot: join(base, 'we"ird\\ root') });
    const source = '#include <cstdio>\nint main() {\n  std::FILE* f = std::fopen("inside.txt", "w");\n  std::puts(f ? "inside ok" : "inside FAILED");\n}\n';
    const { run: ran } = await odd.compileAndRun(await program("weird_root.cpp", source));
    expect(ran!.stdout).toBe("inside ok\n");
    await rm(join(base, 'we"ird\\ root'), { recursive: true, force: true });
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
    const quick = createCppRunnerWithLimits({ tmpRoot }, { runTimeoutMs: 800 });
    const started = Date.now();
    const { run: ran } = await quick.compileAndRun(await program("fork_bomb.cpp", source));
    expect(ran!.timedOut).toBe(true);
    expect(ran!.durationMs).toBeLessThan(800 + 1500);
    expect(Date.now() - started).toBeLessThan(15_000);
    if (process.platform === "darwin") expect(ran!.stdout).toBe("forks 0\n");
  });

  it.skipIf(process.platform !== "darwin")("stops a program that keeps allocating memory, well before the time limit", async () => {
    // Bounded at 1 GB, so a broken watch cannot exhaust the machine either.
    const source =
      "#include <cstdio>\n#include <cstdlib>\n#include <cstring>\n" +
      "int main() {\n  const std::size_t step = 16u << 20;\n  for (int i = 0; i < 64; i++) {\n" +
      "    char* block = static_cast<char*>(std::malloc(step));\n    if (!block) return 2;\n    std::memset(block, 1, step);\n  }\n" +
      '  std::puts("allocated 1 GB");\n  std::fflush(stdout);\n  volatile unsigned long spin = 0;\n  while (true) spin = spin + 1;\n}\n';
    const capped = createCppRunnerWithLimits({ tmpRoot }, { runTimeoutMs: 4000, runMemoryBytes: 128 * 1024 * 1024 });
    const { run: ran } = await capped.compileAndRun(await program("memory_bomb.cpp", source));
    expect(ran).toMatchObject({ timedOut: false, signal: "SIGKILL" });
    expect(ran!.stderr).toContain("The program used more than 128 MB of memory and was stopped.");
    expect(ran!.durationMs).toBeLessThan(4000);
  });

  it.skipIf(process.platform !== "darwin")("stops a compiler that passes its memory cap", async () => {
    const tiny = createCppRunnerWithLimits({ tmpRoot }, { compileMemoryBytes: 1024 * 1024 });
    const check = await tiny.syntaxCheck(fixture("hello.cpp"));
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

describe("the compile sandbox", () => {
  const marker = `planted-${Math.random().toString(36).slice(2)}`;
  let secret: string;

  beforeAll(async () => {
    // Outside every build folder and outside the sources folder, like any other file on the machine.
    secret = join(base, "outside-secret.txt");
    await writeFile(secret, `first line ${marker}\nsecond line ${marker}\n`);
  });

  const includeProgram = (): string => `#include "${secret}"\nint main() { return 0; }\n`;
  const incbinProgram = (): string =>
    "#include <cstdio>\n" +
    '#ifdef __APPLE__\n#define BLOB "_blob"\n#define DATA ".const"\n#else\n#define BLOB "blob"\n#define DATA ".section .rodata"\n#endif\n' +
    `__asm__(DATA "\\n.globl " BLOB "\\n" BLOB ":\\n.incbin \\"${secret}\\"\\n.byte 0\\n");\n` +
    'extern "C" const char blob[];\nint main() { std::fputs(blob, stdout); }\n';
  const leaks = (result: { stderr: string; diagnostics: { message: string }[] }): boolean =>
    result.stderr.includes(marker) || result.diagnostics.some((d) => d.message.includes(marker));

  it("refuses an #include of a file outside the build folder in a syntax check, and echoes none of it", async () => {
    const result = await runner.syntaxCheck(await program("include_secret.cpp", includeProgram()));
    expect(result.ok).toBe(false);
    expect(result.stderr).toMatch(/Operation not permitted|No such file/);
    expect(leaks(result)).toBe(false);
  });

  it("refuses the same #include in a build", async () => {
    const result = await runner.compileAndRun(await program("include_secret_build.cpp", includeProgram()));
    expect(result.compile.ok).toBe(false);
    expect(result.run).toBeNull();
    expect(leaks(result.compile)).toBe(false);
  });

  it("refuses an .incbin of a file outside the build folder, so its bytes never reach the program", async () => {
    const result = await runner.compileAndRun(await program("incbin_secret.cpp", incbinProgram()));
    expect(result.compile.ok).toBe(false);
    expect(result.run).toBeNull();
    expect(leaks(result.compile)).toBe(false);
  });

  it("refuses an #include of the file from a tester's harness", async () => {
    const harness = `#include "${secret}"\nint main() { return 0; }\n`;
    const result = await runner.runHarness(fixture("candidate_counter.cpp"), harness);
    expect(result.compile.ok).toBe(false);
    expect(result.run).toBeNull();
    expect(leaks(result.compile)).toBe(false);
  });

  it("refuses an #include that would read forever from a device", async () => {
    const result = await runner.syntaxCheck(await program("include_zero.cpp", '#include "/dev/zero"\nint main() {}\n'));
    expect(result.ok).toBe(false);
    expect(result.stderr).toMatch(/Operation not permitted/);
  });

  it("proves the refusals come from the sandbox: without it both tricks read the file", async () => {
    const open = createCppRunner({ tmpRoot, sandbox: false });
    const included = await open.syntaxCheck(await program("include_control.cpp", includeProgram()));
    expect(leaks(included)).toBe(true);
    const embedded = await open.compileAndRun(await program("incbin_control.cpp", incbinProgram()));
    expect(embedded.compile.ok).toBe(true);
    expect(embedded.run!.stdout).toContain(marker);
  });

  const classes = [
    "#include <iostream>",
    "#include <memory>",
    "#include <mutex>",
    "#include <optional>",
    "#include <string>",
    "#include <vector>",
    "",
    "class Shape {",
    " public:",
    "  virtual ~Shape() = default;",
    "  virtual double area() const = 0;",
    "};",
    "",
    "class Square : public Shape {",
    " public:",
    "  explicit Square(double side) : side_(side) {}",
    "  double area() const override { return side_ * side_; }",
    "",
    " private:",
    "  double side_;",
    "};",
    "",
    "class Registry {",
    " public:",
    "  void add(std::unique_ptr<Shape> shape) {",
    "    std::lock_guard<std::mutex> lock(mutex_);",
    "    shapes_.push_back(std::move(shape));",
    "  }",
    "  std::optional<double> largest() const {",
    "    std::lock_guard<std::mutex> lock(mutex_);",
    "    if (shapes_.empty()) return std::nullopt;",
    "    double best = 0;",
    "    for (const auto& s : shapes_) best = s->area() > best ? s->area() : best;",
    "    return best;",
    "  }",
    "",
    " private:",
    "  mutable std::mutex mutex_;",
    "  std::vector<std::unique_ptr<Shape>> shapes_;",
    "};",
    "",
    "int main() {",
    "  Registry registry;",
    "  registry.add(std::make_unique<Square>(2));",
    "  registry.add(std::make_unique<Square>(3));",
    '  std::cout << "largest " << registry.largest().value_or(-1) << "\\n";',
    "}",
    "",
  ];

  it("still builds and runs a normal multi-class program with the standard headers", async () => {
    const result = await runner.compileAndRun(await program("classes.cpp", classes.join("\n")));
    expect(result.compile).toMatchObject({ ok: true, diagnostics: [] });
    expect(result.run).toMatchObject({ exitCode: 0, stdout: "largest 9\n", stderr: "" });
  });

  it("still puts diagnostics on the user's own lines", async () => {
    const broken = [...classes];
    broken[44] = "  registry.add(std::make_unique<Square>(3)) // missing semicolon";
    broken[33] = "    int unused = 0;" + broken[33];
    const path = await program("classes_broken.cpp", broken.join("\n"));
    const check = await runner.syntaxCheck(path);
    expect(check.ok).toBe(false);
    expect(check.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ line: 34, severity: "warning", message: expect.stringContaining("unused variable") }),
        expect.objectContaining({ line: 45, severity: "error", message: expect.stringContaining("expected ';'") }),
      ]),
    );
    const built = await runner.compileAndRun(path);
    expect(built.compile.diagnostics.map((d) => [d.line, d.severity])).toEqual(check.diagnostics.map((d) => [d.line, d.severity]));
  });

  it("builds a profile that reads only the system, the toolchain, the build folder and the named inputs", () => {
    const profile = buildCompileSandboxProfile("/tmp/build", ["/study/lld/a/attempt.cpp"], ["/Library/Developer/CommandLineTools"]);
    expect(profile).toContain("(deny network*)");
    expect(profile).toContain("(deny file-read-data)");
    expect(profile).toContain('(allow file-write* (subpath "/tmp/build"))');
    expect(profile).toContain('(literal "/study/lld/a/attempt.cpp")');
    expect(profile).not.toContain('(subpath "/study');
    expect(profile).not.toContain("process-fork");
    expect(profile).not.toContain('/dev/zero")');
  });
});

async function addressSanitizerRunsOnThisMachine(): Promise<boolean> {
  const dir = await mkdtemp(join(tmpdir(), "ir-asan-probe-"));
  try {
    const source = join(dir, "probe.cpp");
    await writeFile(source, '#include <cstdio>\n#include <vector>\nint main() { std::vector<int> v(4, 7); std::printf("probe ok %d\\n", v[2]); }\n');
    await run("/usr/bin/clang++", ["-std=c++17", "-g", "-fsanitize=address", "-o", join(dir, "probe"), source]);
    const { stdout } = await run(join(dir, "probe"), [], { timeout: 10_000 });
    return stdout.includes("probe ok 7");
  } catch {
    return false;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function readFixture(name: string): Promise<string> {
  return readFile(fixture(name), "utf8");
}
