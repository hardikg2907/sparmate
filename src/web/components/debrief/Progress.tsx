import type { Track } from "../../../shared/phases";
import type { DebriefState, ProgressStage } from "../../session/types";
import { CheckIcon, CircleIcon, SpinnerIcon, WarnIcon } from "../icons";
import type { ReactNode } from "react";
import { Alert, Button, Skeleton, cn } from "../ui";

const STAGES: { id: Exclude<ProgressStage, "done">; label: string; lldOnly?: boolean }[] = [
  { id: "collecting", label: "Collecting the board image and your work" },
  { id: "testing", label: "Running the demo scenarios against your code", lldOnly: true },
  { id: "judging", label: "Judging the round against the rubric" },
  { id: "checking", label: "Checking every quote against the record" },
];

export function DebriefProgress({ track, debrief, children }: { track: Track; debrief: DebriefState; children?: ReactNode }) {
  const stages = STAGES.filter((stage) => !stage.lldOnly || track === "lld");
  const current =
    debrief.stage === null
      ? 0
      : debrief.stage === "done"
        ? stages.length
        : Math.max(
            0,
            stages.findIndex((s) => s.id === debrief.stage),
          );
  return (
    <div className="space-y-10">
      <section role="status" aria-live="polite">
        <h2 className="text-title font-semibold">{debrief.stage === null ? "Starting the debrief…" : "Preparing your debrief"}</h2>
        <p className="mt-1 text-body text-muted-foreground">This usually takes a minute or two. You can stay on this page, or look at your timing below while you wait.</p>
        <ol className="mt-5 space-y-3">
          {stages.map((stage, index) => {
            const done = index < current;
            const active = index === current;
            return (
              <li key={stage.id} className="flex items-start gap-3">
                <span className={cn("mt-0.5", done ? "text-success" : active ? "text-primary-text" : "text-faint")}>
                  {done ? <CheckIcon size={18} className="animate-in zoom-in-50 duration-200" /> : active ? <SpinnerIcon size={18} /> : <CircleIcon size={18} />}
                </span>
                <div>
                  <p className={cn("text-body", active ? "font-semibold text-foreground" : done ? "text-foreground" : "text-muted-foreground")}>{stage.label}</p>
                  {active && debrief.detail ? <p className="mt-0.5 text-ui text-muted-foreground">{debrief.detail}</p> : null}
                </div>
              </li>
            );
          })}
        </ol>
      </section>
      <ResultSkeleton />
      {children}
    </div>
  );
}

/** Placeholders in the shape of the verdict and its dimension grid, so the page keeps its layout while the judge works. */
function ResultSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-5">
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-9 w-44" />
          </div>
          <div className="space-y-2 pb-1">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-6 w-32" />
          </div>
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-13 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export function DebriefFailed({ onRetry, connected }: { onRetry: () => void; connected: boolean }) {
  return (
    <Alert
      tone="bad"
      role="alert"
      icon={<WarnIcon size={20} />}
      actions={
        <Button variant="default" onClick={onRetry} disabled={!connected}>
          Retry debrief
        </Button>
      }
    >
      <h2 className="text-lead font-semibold text-foreground">The debrief did not finish</h2>
      <p className="mt-1 text-body text-foreground">Your transcript, board and code are saved. Try the debrief again.</p>
    </Alert>
  );
}
