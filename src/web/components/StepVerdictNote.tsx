import type { StepVerdict } from "../../shared/types";
import { CheckIcon } from "./icons";
import { cn } from "./ui";

/**
 * The guide's call on the current step, shown where the checklist used to sit. Nothing shows before the first check.
 * The gap is model output or the server's count of what is open, so it renders as text only.
 */
export function StepVerdictNote({ stepLabel, verdict, className }: { stepLabel: string; verdict: StepVerdict | undefined; className?: string }) {
  if (!verdict) return null;
  const passed = verdict.verdict === "pass";
  return (
    <section aria-label={`Verdict for ${stepLabel}`} className={cn("room-checklist px-3 py-2.5", className)}>
      <p className="flex items-center gap-1.5 text-meta font-semibold text-muted-foreground">
        <span className="truncate">{stepLabel}</span>
      </p>
      {passed ? (
        <p className="mt-0.5 flex items-center gap-1.5 text-ui font-bold text-success">
          <CheckIcon size={14} />
          Passed
        </p>
      ) : (
        <p className="mt-0.5 text-ui text-foreground">
          <span className="font-bold">Not yet.</span> {verdict.gap}
        </p>
      )}
    </section>
  );
}
