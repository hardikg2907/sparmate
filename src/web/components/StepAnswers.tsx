import type { PhaseDef } from "../../shared/phases";
import { cn } from "./ui";

interface StepAnswersProps {
  phases: readonly PhaseDef[];
  /** Kept for the callers' shape; every step with text is shown, in plan order. */
  currentPhase: string;
  texts: Readonly<Record<string, string>>;
  className?: string;
}

/** The written step text a round holds, one card per step that has any, read-only. */
export function StepAnswers({ phases, texts, className }: StepAnswersProps) {
  const shown = phases.filter((p) => (texts[p.id] ?? "").trim() !== "");
  return (
    <section aria-label="Your step answers" className={cn("flex min-h-0 flex-col bg-card", className)}>
      <header className="flex h-11 shrink-0 items-center border-b border-border px-3">
        <h3 className="text-ui font-semibold">Your step answers</h3>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {shown.map((phase) => (
          <article key={phase.id} className="rounded-lg border border-border bg-card p-2.5 shadow-xs">
            <h4 className="text-ui font-semibold">{phase.label}</h4>
            <p className="mt-1 whitespace-pre-wrap break-words text-ui leading-snug text-foreground">{texts[phase.id]}</p>
          </article>
        ))}
        {shown.length === 0 ? <p className="text-ui text-muted-foreground">This round holds no written step answers.</p> : null}
      </div>
    </section>
  );
}
