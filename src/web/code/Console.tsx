import { useId, type ReactNode } from "react";
import type { CompileDiagnostic, RunResult } from "../../shared/types";
import { SpinnerIcon } from "../components/icons";
import { Badge, Button, Disclosure, Tooltip, TONE_FILL, TONE_TEXT } from "../components/ui";
import { cn } from "../lib/utils";
import type { Tone } from "../lib/format";
import { formatDuration, outputWasCut, plural, runSummary, statusLine, type RunSummary } from "./consoleFormat";

export interface ConsoleProps {
  lastRun: RunResult | null;
  running: boolean;
  onRun: () => void;
  onJumpTo?: (line: number, column: number) => void;
  disabled?: boolean;
}

const MAX_DIAGNOSTIC_ROWS = 50;

const RUN_TONE: Record<RunSummary["tone"], Tone> = { ok: "good", fail: "bad", warn: "warn" };

const PRE = "m-0 rounded-md bg-muted px-2.5 py-2 font-mono text-ui leading-normal whitespace-pre-wrap [overflow-wrap:anywhere]";

function severityTone(severity: CompileDiagnostic["severity"]): Tone {
  if (severity === "error") return "bad";
  if (severity === "warning") return "warn";
  return "neutral";
}

function statusTone(lastRun: RunResult | null, running: boolean): Tone {
  if (running || !lastRun) return "neutral";
  if (!lastRun.compile.ok) return "bad";
  if (!lastRun.run) return "good";
  return RUN_TONE[runSummary(lastRun.run).tone];
}

function Note({ warn, children }: { warn?: boolean; children: ReactNode }) {
  return <p className={cn("mt-1.5 rounded-sm border-l-2 bg-muted px-2 py-1 text-ui text-muted-foreground", warn ? "border-warning-fill" : "border-border")}>{children}</p>;
}

function DiagnosticRow({ diagnostic, onJumpTo }: { diagnostic: CompileDiagnostic; onJumpTo?: (line: number, column: number) => void }) {
  const position = `${diagnostic.line}:${diagnostic.column}`;
  const content = (
    <>
      <Badge tone={severityTone(diagnostic.severity)}>{diagnostic.severity}</Badge>
      <span className="font-mono text-meta tabular-nums text-muted-foreground">{position}</span>
      <span className="min-w-0 text-ui text-foreground [overflow-wrap:anywhere]">{diagnostic.message}</span>
    </>
  );
  const className = cn(
    "ir-diag",
    `ir-diag--${diagnostic.severity}`,
    "grid grid-cols-[4.5rem_3.5rem_minmax(0,1fr)] items-baseline gap-2 rounded-md px-2 py-1.5 text-left",
    diagnostic.severity === "note" && "pl-5",
  );
  if (!onJumpTo) return <div className={className}>{content}</div>;
  return (
    <Tooltip content={`Go to line ${diagnostic.line}, column ${diagnostic.column}`} side="top">
      <button
        type="button"
        className={cn(className, "w-full transition-colors duration-150 hover:bg-accent/50 focus-visible:outline-offset-[-2px]")}
        onClick={() => onJumpTo(diagnostic.line, diagnostic.column)}
      >
        {content}
      </button>
    </Tooltip>
  );
}

function OutputBlock({ label, text, stream }: { label: string; text: string; stream: "stdout" | "stderr" }) {
  return (
    <div className={cn("ir-stream mt-2 first:mt-0", `ir-stream--${stream}`)}>
      <div className="mb-0.5 font-mono text-meta font-semibold text-muted-foreground">{label}</div>
      <pre className={cn("ir-out", PRE, stream === "stderr" && "border-l-2 border-destructive-fill")}>{text}</pre>
      {outputWasCut(text) && <Note>Output was cut. Only the start of {label} is shown.</Note>}
    </div>
  );
}

function CompileSection({ compile, onJumpTo }: { compile: RunResult["compile"]; onJumpTo?: (line: number, column: number) => void }) {
  const headingId = useId();
  const shown = compile.diagnostics.slice(0, MAX_DIAGNOSTIC_ROWS);
  const hidden = compile.diagnostics.length - shown.length;
  const rawOnly = compile.diagnostics.length === 0 && compile.stderr.trim().length > 0;
  return (
    <section className="ir-section mt-4 first:mt-0" aria-labelledby={headingId}>
      <h3 className="ir-section__title flex items-center gap-2 pb-1.5 text-ui font-semibold text-foreground" id={headingId}>
        <span>Compiler</span>
        <Badge tone={compile.ok ? "good" : "bad"}>{compile.ok ? "OK" : "Failed"}</Badge>
        <span className="ir-section__meta text-meta font-normal tabular-nums text-muted-foreground">{formatDuration(compile.durationMs)}</span>
      </h3>
      {shown.length > 0 && (
        <ul className="ir-diags m-0 list-none p-0">
          {shown.map((d, i) => (
            <li key={i}>
              <DiagnosticRow diagnostic={d} onJumpTo={onJumpTo} />
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && <Note>{plural(hidden, "more message")} not shown.</Note>}
      {rawOnly && <pre className={cn("ir-out mt-2", PRE)}>{compile.stderr}</pre>}
      {!rawOnly && compile.stderr.trim().length > 0 && (
        <Disclosure summary="Full compiler output" className="mt-2">
          <pre className={cn("ir-out", PRE)}>{compile.stderr}</pre>
        </Disclosure>
      )}
    </section>
  );
}

function RunSection({ run }: { run: NonNullable<RunResult["run"]> }) {
  const headingId = useId();
  const summary = runSummary(run);
  const empty = run.stdout.length === 0 && run.stderr.length === 0;
  return (
    <section className="ir-section mt-4 first:mt-0" aria-labelledby={headingId}>
      <h3 className="ir-section__title flex items-center gap-2 pb-1.5 text-ui font-semibold text-foreground" id={headingId}>
        <span>Program</span>
        <Badge tone={RUN_TONE[summary.tone]}>{summary.text}</Badge>
        <span className="ir-section__meta text-meta font-normal tabular-nums text-muted-foreground">{formatDuration(run.durationMs)}</span>
      </h3>
      {run.timedOut && <Note warn>Timed out. The program was stopped after {formatDuration(run.durationMs)}.</Note>}
      {run.stdout.length > 0 && <OutputBlock label="stdout" text={run.stdout} stream="stdout" />}
      {run.stderr.length > 0 && <OutputBlock label="stderr" text={run.stderr} stream="stderr" />}
      {empty && <p className="mt-2 text-ui text-muted-foreground">The program printed nothing.</p>}
    </section>
  );
}

export function Console({ lastRun, running, onRun, onJumpTo, disabled }: ConsoleProps) {
  const tone = statusTone(lastRun, running);
  return (
    <section className="ir-console flex h-full min-h-0 w-full flex-col bg-card text-ui text-foreground" aria-label="Console" aria-busy={running}>
      <header className="ir-console__bar flex shrink-0 items-center gap-3 border-b border-border px-3 py-1.5">
        {/* aria-disabled while running keeps keyboard focus on the button; a disabled button drops it. */}
        <Tooltip content="Compile and run">
          <Button
            variant="default"
            size="sm"
            className="ir-console__run min-w-21"
            onClick={() => {
              if (!running) onRun();
            }}
            disabled={disabled}
            aria-disabled={running || undefined}
          >
            {running ? (
              <>
                <SpinnerIcon size={12} />
                Running…
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                  <path d="M2.5 1.2v9.6L10.6 6z" fill="currentColor" />
                </svg>
                Run
              </>
            )}
          </Button>
        </Tooltip>
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", TONE_FILL[tone])} />
          <div className={cn("ir-console__status min-w-0 truncate", TONE_TEXT[tone])} role="status" aria-live="polite">
            {statusLine(lastRun, running)}
          </div>
        </div>
      </header>
      <div
        className={cn(
          "ir-console__body min-h-0 flex-1 overflow-auto px-3 pt-2 pb-3 transition-opacity duration-150 focus-visible:outline-offset-[-2px]",
          running && "opacity-55",
        )}
        tabIndex={0}
        role="region"
        aria-label="Console output"
      >
        {lastRun ? (
          <>
            <CompileSection compile={lastRun.compile} onJumpTo={onJumpTo} />
            {lastRun.run ? <RunSection run={lastRun.run} /> : !lastRun.compile.ok && <p className="mt-4 text-ui text-muted-foreground">The program did not run because it did not compile.</p>}
          </>
        ) : (
          <p className="text-ui text-muted-foreground">Nothing has run yet. Press Run to compile and run your program. Compiler messages and program output appear here.</p>
        )}
      </div>
    </section>
  );
}
