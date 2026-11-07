import type { ReactNode } from "react";
import type { PublicStepCheck, PublicStepItem } from "../../shared/types";
import { coverText, isUnchecked, whereText } from "../lib/steps";
import { cn } from "./ui";

const ICON: Record<PublicStepItem["state"], string> = { covered: "✓", partial: "◐", missing: "○" };

/** One checklist item with its state mark and where it was covered. */
export function ChecklistRow({ item }: { item: PublicStepItem }) {
  return (
    <li className="grid grid-cols-[1.25rem_1fr] gap-2 rounded-md px-1 py-1.5" data-state={item.state}>
      <span className="room-check-icon" data-state={item.state} aria-hidden="true">
        {ICON[item.state]}
      </span>
      <span className="min-w-0">
        <span className={cn("block text-ui font-semibold leading-snug text-foreground", item.question && "italic")}>
          {item.question ? <span className="sr-only">Question to ask: </span> : null}
          {item.label}
        </span>
        <span className={cn("block text-meta", item.state === "partial" ? "text-warning" : item.state === "missing" ? "text-faint" : "text-muted-foreground")}>
          <span className="sr-only">{item.state === "covered" ? "Covered. " : item.state === "partial" ? "" : "Missing. "}</span>
          {whereText(item)}
        </span>
      </span>
    </li>
  );
}

/** A step's checklist body: the size of the step while nobody has checked it, otherwise every item. */
export function ChecklistItems({ step, empty = null }: { step: PublicStepCheck | undefined; empty?: ReactNode }) {
  if (step && isUnchecked(step) && step.total > 0) {
    return <p className="px-1 py-1.5 text-ui text-muted-foreground">{coverText(step.total)}</p>;
  }
  if (step && step.items.length > 0) {
    return (
      <ul className="space-y-0.5">
        {step.items.map((item) => (
          <ChecklistRow key={item.id} item={item} />
        ))}
      </ul>
    );
  }
  return empty;
}
