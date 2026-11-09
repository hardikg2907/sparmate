import type { PublicStepCheck, PublicStepItem } from "../../shared/types";
import { ChevronDownIcon, CheckIcon, CircleIcon, MinusIcon } from "./icons";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/disclosure";
import { cn } from "./ui";

const STATE_WORD: Record<PublicStepItem["state"], string> = { covered: "covered", partial: "partly covered", missing: "not covered" };

function ItemMark({ state }: { state: PublicStepItem["state"] }) {
  if (state === "covered") return <CheckIcon size={13} className="mt-0.5 shrink-0 text-success" />;
  if (state === "partial") return <MinusIcon size={13} className="mt-0.5 shrink-0 text-warning" />;
  return <CircleIcon size={13} className="mt-0.5 shrink-0 text-faint" />;
}

function ItemList({ items }: { items: readonly PublicStepItem[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-2 text-ui">
          <ItemMark state={item.state} />
          <span className={cn("min-w-0", item.state === "covered" ? "text-foreground" : "text-muted-foreground")}>
            {item.question ? <span className="sr-only">A question to ask: </span> : null}
            {item.label}
            <span className="sr-only">, {STATE_WORD[item.state]}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The step's checklist as one line at the top of the chat. It opens in place and has no scroller of its own, so the
 * chat keeps its height. It shows only what the server sent for the round: nothing is invented here.
 */
export function StepChecklist({ step }: { step: PublicStepCheck | undefined }) {
  if (!step || step.total === 0) return null;
  return (
    <Collapsible className="step-checklist group/checklist shrink-0 max-md:hidden border-b border-border px-3 py-2">
      <CollapsibleTrigger className="step-checklist__row flex h-8 w-full items-center justify-between rounded-md px-3 text-ui font-semibold">
        <span>Checklist</span>
        <span className="flex items-center gap-1.5 font-mono text-meta tabular-nums text-muted-foreground">
          {step.covered} of {step.total}
          <ChevronDownIcon size={14} className="-rotate-90 transition-transform duration-200 group-data-[state=open]/checklist:rotate-0" />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pb-1 pt-2.5">
          {step.items.length > 0 ? (
            <ItemList items={step.items} />
          ) : (
            <p className="text-ui text-muted-foreground">Nothing is checked yet. Check this step to see what you covered.</p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** What the current step must produce, under the opening message of a machine-coding round. */
export function StepNeeds({ label, goal, step }: { label: string; goal: string; step: PublicStepCheck | undefined }) {
  const items = step?.items ?? [];
  return (
    <section aria-label={`What ${label} needs`} className="step-needs rounded-lg px-3.5 py-3 text-ui">
      <h3 className="font-bold text-foreground">What this step needs</h3>
      <p className="mt-1 text-muted-foreground">{goal}.</p>
      {items.length > 0 ? (
        <div className="mt-2.5">
          <ItemList items={items} />
        </div>
      ) : null}
    </section>
  );
}
