import type { CompileDiagnostic, RunResult } from "../../shared/types";

export const SAMPLE_CODE = `#include <iostream>
#include <vector>

struct Ticket {
  int id;
  int spot;
};

int main() {
  std::vector<Ticket> tickets;
  tickets.push_back({1, 7});
  int unused = 3;
  std::cout << total << "\\n";
  return 0;
}
`;

export const SAMPLE_DIAGNOSTICS: CompileDiagnostic[] = [
  { line: 12, column: 7, endLine: 12, endColumn: 13, severity: "warning", message: "unused variable 'unused' [-Wunused-variable]" },
  { line: 13, column: 16, endLine: 13, endColumn: 21, severity: "error", message: "use of undeclared identifier 'total'" },
  { line: 4, column: 8, severity: "note", message: "'Ticket' is declared here" },
];

const COMPILE_ERROR_STDERR = `candidate.cpp:13:16: error: use of undeclared identifier 'total'
  std::cout << total << "\\n";
               ^
candidate.cpp:12:7: warning: unused variable 'unused' [-Wunused-variable]
  int unused = 3;
      ^
1 warning and 1 error generated.
`;

function longOutput(): string {
  const lines: string[] = [];
  let size = 0;
  for (let i = 1; size < 66_000; i += 1) {
    const line = `item ${i}: value=${(i * 37) % 1000}`;
    lines.push(line);
    size += line.length + 1;
  }
  return `${lines.join("\n")}\n[output cut after 64 KB]\n`;
}

const okCompile = (diagnostics: CompileDiagnostic[] = []): RunResult["compile"] => ({ ok: true, diagnostics, stderr: "", durationMs: 420 });

export const SAMPLE_RUNS = {
  success: (): RunResult => ({
    at: 0,
    compile: okCompile(),
    run: { exitCode: 0, signal: null, stdout: "Ticket 1 -> spot 7\nFee: 150\nAll scenarios passed\n", stderr: "", timedOut: false, durationMs: 12 },
  }),
  warnings: (): RunResult => ({
    at: 0,
    compile: { ...okCompile([SAMPLE_DIAGNOSTICS[0] as CompileDiagnostic]), stderr: "candidate.cpp:12:7: warning: unused variable 'unused'\n" },
    run: { exitCode: 0, signal: null, stdout: "ok\n", stderr: "", timedOut: false, durationMs: 9 },
  }),
  compileError: (): RunResult => ({
    at: 0,
    compile: { ok: false, diagnostics: SAMPLE_DIAGNOSTICS, stderr: COMPILE_ERROR_STDERR, durationMs: 380 },
    run: null,
  }),
  exitCode: (): RunResult => ({
    at: 0,
    compile: okCompile(),
    run: { exitCode: 3, signal: null, stdout: "Start\n", stderr: "error: lot is full\n", timedOut: false, durationMs: 15 },
  }),
  crash: (): RunResult => ({
    at: 0,
    compile: okCompile(),
    run: {
      exitCode: null,
      signal: "SIGSEGV",
      stdout: "Parking car 1\n",
      stderr: "==1==ERROR: AddressSanitizer: SEGV on unknown address 0x000000000000\n    #0 0x1 in Lot::free(int) candidate.cpp:41\n",
      timedOut: false,
      durationMs: 74,
    },
  }),
  timeout: (): RunResult => ({
    at: 0,
    compile: okCompile(),
    run: { exitCode: null, signal: "SIGKILL", stdout: "waiting for a free spot...\n", stderr: "", timedOut: true, durationMs: 5000 },
  }),
  longOutput: (): RunResult => ({
    at: 0,
    compile: okCompile(),
    run: { exitCode: 0, signal: null, stdout: longOutput(), stderr: "debug: finished\n", timedOut: false, durationMs: 230 },
  }),
  silent: (): RunResult => ({
    at: 0,
    compile: okCompile(),
    run: { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, durationMs: 3 },
  }),
} satisfies Record<string, () => RunResult>;

export type SampleRunName = keyof typeof SAMPLE_RUNS;
