import type { CompileDiagnostic, RunResult } from "../../shared/types";

// The runner keeps the first 64 KB of each stream, and a result carries no flag for that, so size gives it away.
const OUTPUT_CAP_CHARS = 64 * 1024;
const CUT_MARKER = /(output|stdout|stderr).*\b(cut|truncated)\b/i;

/** True when a captured stream was clipped: it reached the cap, or the runner ended it with a "cut" line. */
export function outputWasCut(text: string): boolean {
  if (text.length >= OUTPUT_CAP_CHARS) return true;
  const lastLine = text.trimEnd().split("\n").pop() ?? "";
  return lastLine.length < 200 && CUT_MARKER.test(lastLine);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function countBySeverity(diagnostics: readonly CompileDiagnostic[], severity: CompileDiagnostic["severity"]): number {
  return diagnostics.filter((d) => d.severity === severity).length;
}

export function compileSummary(compile: RunResult["compile"]): string {
  const errors = countBySeverity(compile.diagnostics, "error");
  const warnings = countBySeverity(compile.diagnostics, "warning");
  const counts = [errors > 0 ? plural(errors, "error") : null, warnings > 0 ? plural(warnings, "warning") : null].filter(Boolean).join(", ");
  if (compile.ok) return counts ? `Compiled with ${counts}` : "Compiled";
  return counts ? `Compile failed: ${counts}` : "Compile failed";
}

export interface RunSummary {
  text: string;
  tone: "ok" | "fail" | "warn";
}

export function runSummary(run: NonNullable<RunResult["run"]>): RunSummary {
  if (run.timedOut) return { text: "Timed out", tone: "warn" };
  if (run.exitCode === null && run.signal) return { text: `Crashed with ${run.signal}`, tone: "fail" };
  if (run.exitCode === null) return { text: "Stopped", tone: "fail" };
  return { text: `Exit code ${run.exitCode}`, tone: run.exitCode === 0 ? "ok" : "fail" };
}

/** One line for the status area, which screen readers announce when a run ends. */
export function statusLine(lastRun: RunResult | null, running: boolean): string {
  if (running) return "Running…";
  if (!lastRun) return "Not run yet";
  if (!lastRun.compile.ok) return `${compileSummary(lastRun.compile)}. The program did not run.`;
  if (!lastRun.run) return compileSummary(lastRun.compile);
  return `${runSummary(lastRun.run).text} in ${formatDuration(lastRun.run.durationMs)}`;
}
