import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CppRunner, createCppRunner, createCppRunnerWithLimits, detectSanitizers } from "./cpp";
import { addressSanitizerRunsOnThisMachine, fixture, program, readFixture, useRunnerFolders } from "./__fixtures__/cpp-kit";

let base: string;
let tmpRoot: string;
let scratch: string;
let runner: CppRunner;
useRunnerFolders((ready) => ({ base, tmpRoot, scratch, runner } = ready));

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
    // The sanitizer build links the runner's start report too, which must add nothing to what the user reads.
    expect(result.compile).toMatchObject({ ok: true, diagnostics: [], stderr: "" });
    expect(result.run).toMatchObject({ exitCode: 0, signal: null, stdout: "harness ok 3\n", stderr: "", timedOut: false });
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
    if (process.platform === "linux") {
      // AddressSanitizer reads /proc at start, and the Linux sandbox has no /proc so the server's environment stays
      // hidden. The runner finds that out and falls back to the undefined-behaviour checks alone.
      expect(await detectSanitizers({ tmpRoot })).toBe("undefined");
      return;
    }
    expect(await detectSanitizers({ tmpRoot })).toBe("address,undefined");
    const result = await runner.runHarness(fixture("candidate_counter.cpp"), await readFixture("harness_heap_overflow.cpp"));
    expect(result.run!.exitCode).not.toBe(0);
    expect(result.run!.stderr).toContain("AddressSanitizer: heap-buffer-overflow");
  });
});
