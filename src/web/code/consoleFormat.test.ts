import { describe, expect, it } from "vitest";
import type { RunResult } from "../../shared/types";
import { compileSummary, formatDuration, outputWasCut, runSummary, statusLine } from "./consoleFormat";

const compile = (ok: boolean, severities: ("error" | "warning" | "note")[] = []): RunResult["compile"] => ({
  ok,
  diagnostics: severities.map((severity, i) => ({ line: i + 1, column: 1, severity, message: "m" })),
  stderr: "",
  durationMs: 40,
});

const run = (over: Partial<NonNullable<RunResult["run"]>> = {}): NonNullable<RunResult["run"]> => ({
  exitCode: 0,
  signal: null,
  stdout: "",
  stderr: "",
  timedOut: false,
  durationMs: 12,
  ...over,
});

describe("formatDuration", () => {
  it("uses milliseconds under a second and seconds above", () => {
    expect(formatDuration(12.4)).toBe("12 ms");
    expect(formatDuration(999)).toBe("999 ms");
    expect(formatDuration(1240)).toBe("1.24 s");
    expect(formatDuration(5000)).toBe("5.00 s");
    expect(formatDuration(12_500)).toBe("12.5 s");
  });
});

describe("outputWasCut", () => {
  it("is false for ordinary output", () => {
    expect(outputWasCut("hello\nworld\n")).toBe(false);
    expect(outputWasCut("")).toBe(false);
  });

  it("is true when a stream reaches the 64 KB cap", () => {
    expect(outputWasCut("x".repeat(64 * 1024))).toBe(true);
    expect(outputWasCut("x".repeat(64 * 1024 - 1))).toBe(false);
  });

  it("is true when the runner ends the stream with a cut line", () => {
    expect(outputWasCut("line\n[output cut after 64 KB]\n")).toBe(true);
    expect(outputWasCut("line\n... stdout truncated\n")).toBe(true);
  });

  it("ignores the word cut inside ordinary program output", () => {
    expect(outputWasCut("cut the deck\nshuffled\n")).toBe(false);
  });
});

describe("compileSummary", () => {
  it("counts errors and warnings and ignores notes", () => {
    expect(compileSummary(compile(true))).toBe("Compiled");
    expect(compileSummary(compile(true, ["warning", "warning"]))).toBe("Compiled with 2 warnings");
    expect(compileSummary(compile(false, ["error", "note", "warning"]))).toBe("Compile failed: 1 error, 1 warning");
    expect(compileSummary(compile(false))).toBe("Compile failed");
  });
});

describe("runSummary", () => {
  it("names each way a run can end", () => {
    expect(runSummary(run())).toEqual({ text: "Exit code 0", tone: "ok" });
    expect(runSummary(run({ exitCode: 3 }))).toEqual({ text: "Exit code 3", tone: "fail" });
    expect(runSummary(run({ exitCode: null, signal: "SIGSEGV" }))).toEqual({ text: "Crashed with SIGSEGV", tone: "fail" });
    expect(runSummary(run({ exitCode: null, timedOut: true }))).toEqual({ text: "Timed out", tone: "warn" });
    expect(runSummary(run({ exitCode: null }))).toEqual({ text: "Stopped", tone: "fail" });
  });
});

describe("statusLine", () => {
  const result = (c: RunResult["compile"], r: RunResult["run"]): RunResult => ({ at: 0, compile: c, run: r });

  it("covers the empty, running, failed and finished states", () => {
    expect(statusLine(null, false)).toBe("Not run yet");
    expect(statusLine(null, true)).toBe("Running…");
    expect(statusLine(result(compile(false, ["error"]), null), false)).toBe("Compile failed: 1 error. The program did not run.");
    expect(statusLine(result(compile(true), run({ durationMs: 1500 })), false)).toBe("Exit code 0 in 1.50 s");
  });
});
