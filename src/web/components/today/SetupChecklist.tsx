import type { ReactNode } from "react";
import { CheckIcon } from "../icons";
import { cn } from "../ui";

export interface SetupStep {
  id: string;
  title: string;
  detail: string;
  done: boolean;
  /** The one thing to do about the step. Absent when the step needs no click. */
  action?: ReactNode;
}

/** The first-run hero body: four steps, the first one still open is lit. */
export function SetupChecklist({ steps }: { steps: readonly SetupStep[] }) {
  const current = steps.findIndex((s) => !s.done);
  return (
    <>
      <h2 id="hero-title" className="font-display text-display font-extrabold tracking-[-0.03em]">
        Set up in {steps.length === 4 ? "four" : steps.length} steps
      </h2>
      <p className="mt-2 max-w-[56ch] text-body text-muted-foreground">Two minutes of setup, then your first round. Everything else fills in by itself.</p>
      <ol className="mt-6 space-y-2.5">
        {steps.map((step, index) => (
          <li
            key={step.id}
            aria-current={index === current ? "step" : undefined}
            className={cn(
              "mesh-tile flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-xl px-4 py-3 sm:flex-nowrap",
              index === current ? "ring-1 ring-white/50" : step.done ? "" : "opacity-90",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-full text-ui font-bold",
                step.done ? "bg-success-fill text-background" : index === current ? "bg-white text-[#1a1442]" : "ring-1 ring-inset ring-white/40",
              )}
            >
              {step.done ? <CheckIcon size={14} /> : index + 1}
            </span>
            <div className="min-w-0 flex-1 max-sm:basis-[10rem]">
              <p className={cn("text-body font-semibold", step.done && "line-through decoration-1")}>
                {step.title}
                {step.done ? <span className="sr-only"> (done)</span> : null}
              </p>
              <p className="text-ui text-muted-foreground sm:truncate">{step.detail}</p>
            </div>
            <span className="max-sm:basis-full max-sm:pl-[2.625rem]">
              {step.done ? <span className="rounded-full bg-success-soft px-2.5 py-0.5 text-meta font-bold text-success">Done</span> : (step.action ?? null)}
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}
