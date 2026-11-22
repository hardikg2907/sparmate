import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { constants as osConstants } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CppRunner, createCppRunner, signalFromBubblewrap, undefinedSymbols } from "./cpp";
import { fixture, program, useRunnerFolders } from "./__fixtures__/cpp-kit";

const osSignals = osConstants.signals;

let base: string;
let tmpRoot: string;
let scratch: string;
let runner: CppRunner;
useRunnerFolders((ready) => ({ base, tmpRoot, scratch, runner } = ready));

describe("link errors and exit status from any toolchain", () => {
  it("reads undefined symbols from Apple's ld, GNU ld and lld", () => {
    expect(undefinedSymbols('Undefined symbols for architecture arm64:\n  "helper(int)", referenced from:\n      _main in a.o\n')).toEqual(["helper(int)"]);
    expect(undefinedSymbols("/usr/bin/ld: /tmp/a.o: in function `main':\na.cpp:(.text+0x9): undefined reference to `helper(int)'\n")).toEqual(["helper(int)"]);
    expect(undefinedSymbols("ld.lld: error: undefined symbol: helper(int)\n>>> referenced by a.cpp\n")).toEqual(["helper(int)"]);
    expect(undefinedSymbols("(.text+0x1b): undefined reference to `main'\n(.text+0x2b): undefined reference to `main'\n")).toEqual(["main"]);
    expect(undefinedSymbols("a.cpp:1:1: error: expected ';'\n")).toEqual([]);
  });

  it("maps a bubblewrap exit of 128 plus a signal number back to the signal, and leaves other codes alone", () => {
    const n = (name: keyof typeof osSignals): number => osSignals[name];
    expect(signalFromBubblewrap(128 + n("SIGABRT"), null)).toEqual({ exitCode: null, signal: "SIGABRT" });
    expect(signalFromBubblewrap(128 + n("SIGSEGV"), null)).toEqual({ exitCode: null, signal: "SIGSEGV" });
    expect(signalFromBubblewrap(128 + n("SIGXFSZ"), null)).toEqual({ exitCode: null, signal: "SIGXFSZ" });
    expect(signalFromBubblewrap(3, null)).toEqual({ exitCode: 3, signal: null });
    expect(signalFromBubblewrap(128, null)).toEqual({ exitCode: 128, signal: null });
    expect(signalFromBubblewrap(255, null)).toEqual({ exitCode: 255, signal: null });
    expect(signalFromBubblewrap(null, "SIGKILL")).toEqual({ exitCode: null, signal: "SIGKILL" });
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
    // Apple's ld and GNU ld word it differently; the diagnostic below is the same on both.
    expect(result.compile.stderr).toMatch(/Undefined symbols|undefined reference to `main'/);
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
