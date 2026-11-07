import { useId, useState } from "react";
import type { PublicStepCheck } from "../../shared/types";
import { formatClock } from "../lib/format";
import { isUnchecked, ringView } from "../lib/steps";
import { ChecklistItems } from "./ChecklistItems";
import { ChevronDownIcon } from "./icons";
import { cn } from "./ui";
import { StepRing } from "./StepRing";

interface StepChecklistProps {
  stepLabel: string;
  step: PublicStepCheck | undefined;
  /** What the checker reads for this step, as a phrase: "the chat and the frame". */
  reads: string;
  className?: string;
}

/** What the current step's answer covers, and what is still missing, as of the last check. Guided rounds only. */
export function StepChecklist({ stepLabel, step, reads, className }: StepChecklistProps) {
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  const ring = ringView(step);
  const covered = step?.covered ?? 0;
  const unchecked = isUnchecked(step);

  return (
    <section aria-label="Step checklist" className={cn("room-checklist", className)}>
      <header className="flex items-center gap-2.5 px-3 py-2">
        <StepRing view={ring} size={28} />
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md text-left focus-visible:outline-offset-2"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-meta font-semibold text-muted-foreground">Checklist</span>
            <span className="block truncate text-ui font-bold text-foreground">{stepLabel}</span>
          </span>
          <span className="shrink-0 font-mono text-meta tabular-nums text-muted-foreground">
            {step ? (unchecked ? `${step.total} to cover` : `${covered} of ${step.total}`) : null}
          </span>
          <ChevronDownIcon size={14} className={cn("shrink-0 text-muted-foreground transition-transform duration-150", !open && "-rotate-90")} />
        </button>
      </header>
      {open ? (
        <div id={bodyId} className="room-checklist__body">
          <ChecklistItems step={step} empty={<p className="px-1 py-1.5 text-ui text-muted-foreground">This step has no checklist.</p>} />
          <CheckStatus step={step} reads={reads} />
        </div>
      ) : null}
    </section>
  );
}

function CheckStatus({ step, reads }: { step: PublicStepCheck | undefined; reads: string }) {
  const text =
    step?.status === "checking"
      ? "Checking this step…"
      : step?.checkedAt != null
        ? `Checked at ${formatClock(step.checkedAt)}, from ${reads}${step.usedImage ? ", with an image of the frame" : ""}`
        : step?.status === "failed"
          ? "The last check did not finish. Press Check this step to try again."
          : "Checked when you press Check this step or move on.";
  return (
    <p className="mt-1 flex items-center gap-1.5 border-t border-border px-1 pt-2 text-meta text-muted-foreground">
      <span className={cn("size-1.5 shrink-0 rounded-full", step?.status === "checking" ? "animate-pulse bg-primary" : step?.checkedAt != null ? "bg-success-fill" : "bg-input")} aria-hidden="true" />
      {text}
    </p>
  );
}
