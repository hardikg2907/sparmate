import type { GapCounts, GapState } from "../../lib/gapMarks";
import { progressText } from "../../lib/gapMarks";
import type { NextAction } from "../../lib/debriefNext";
import { Button, Card, cn } from "../ui";
import { Link } from "../../router";

/** One card that always names one action, so the page never asks the reader to choose what comes next. */
export function NextStep({ next, busy, canSend, onAct }: { next: NextAction; busy: boolean; canSend: boolean; onAct: () => void }) {
  const working = busy && (next.kind === "practise_gap" || next.kind === "try_interview");
  return (
    <Card variant="flat" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-primary/40 bg-primary-soft px-4 py-3 text-primary-soft-foreground">
      <span className="text-meta font-extrabold tracking-[0.08em] text-primary-text">NEXT</span>
      <p className="min-w-0 flex-1 basis-48 text-body font-semibold">{next.label}</p>
      {next.kind === "home" ? (
        <Button asChild variant="default">
          <Link href="/">{next.button}</Link>
        </Button>
      ) : (
        <Button variant="default" busy={working} disabled={busy || (next.kind === "start_gap" && !canSend)} onClick={onAct}>
          {next.button}
        </Button>
      )}
    </Card>
  );
}

/** The gaps as a short line and a bar with one segment per gap; the line carries the meaning, the bar only repeats it. */
export function GapProgressLine({ counts, states }: { counts: GapCounts; states: readonly GapState[] }) {
  if (counts.total === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-meta text-muted-foreground">
      <span>{progressText(counts)}</span>
      <span aria-hidden="true" className="flex max-w-40 flex-1 gap-[3px]">
        {states.map((state, index) => (
          <i
            key={index}
            className={cn(
              "h-1.5 flex-1 rounded-sm",
              state === "done" || state === "later" || state === "practised" ? "bg-success-fill" : state === "with_coach" ? "bg-primary" : "bg-muted ring-1 ring-inset ring-border",
            )}
          />
        ))}
      </span>
    </div>
  );
}
