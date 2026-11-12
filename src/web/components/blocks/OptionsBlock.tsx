import { useLayoutEffect, useRef, useState } from "react";
import type { OptionItem, OptionsBlock as OptionsBlockType } from "../../../shared/blocks";
import { CheckIcon } from "../icons";
import { cn } from "../ui";
import { focusSettledOptionsGroup, prefersFinePointer } from "./optionsState";

export interface OptionsBlockProps {
  block: OptionsBlockType;
  settled: boolean;
  disabled: boolean;
  answeredText?: string | null;
  focusGroupOnSettle?: boolean;
  onChoose: (text: string, action: "send" | "prefill") => boolean;
}

function matchAnsweredIndex(items: readonly OptionItem[], answeredText: string | null | undefined): number | null {
  const trimmed = answeredText?.trim();
  if (!trimmed) return null;
  for (const [index, item] of items.entries()) {
    const reply = (item.reply ?? item.label).trim();
    if (reply === trimmed || item.label.trim() === trimmed) return index;
  }
  const lower = trimmed.toLowerCase();
  for (const [index, item] of items.entries()) {
    const reply = (item.reply ?? item.label).trim().toLowerCase();
    if (reply === lower || item.label.trim().toLowerCase() === lower) return index;
  }
  return null;
}

export function OptionsBlock({ block, settled, disabled, answeredText, focusGroupOnSettle: focusGroupOnSettleProp, onChoose }: OptionsBlockProps) {
  const [prefilledIndex, setPrefilledIndex] = useState<number | null>(null);
  const [focusGroupState, setFocusGroupState] = useState(false);
  const pendingGroupFocus = useRef(false);
  const groupRef = useRef<HTMLDivElement>(null);
  const action = block.action ?? "send";
  const focusGroupOnSettle = focusGroupOnSettleProp ?? focusGroupState;
  // A later assistant reply settles options with answeredText === null, which must not mark a prefill draft as sent.
  const chosenIndex = matchAnsweredIndex(block.items, answeredText) ?? (settled && answeredText ? prefilledIndex : null);

  // Touch sends keep the virtual keyboard closed by landing focus on the settled group once the buttons unmount.
  useLayoutEffect(() => {
    if (focusSettledOptionsGroup(settled, pendingGroupFocus.current, groupRef.current)) {
      pendingGroupFocus.current = false;
    }
  }, [settled, focusGroupState]);

  if (settled) {
    return (
      <div ref={groupRef} role="group" aria-label="Options" tabIndex={focusGroupOnSettle ? -1 : undefined} className="flex flex-col gap-1.5 outline-none">
        {block.items.map((item, index) => {
          const chosen = chosenIndex === index;
          return (
            <div
              key={index}
              className={cn(
                "flex w-full items-start justify-between gap-2.5 rounded-md border px-3 py-2 text-left",
                chosen ? "border-primary/60 bg-primary-soft/35" : "border-border/80 bg-raised/30 opacity-60",
              )}
            >
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                <span className="block min-w-0 text-ui font-medium [overflow-wrap:anywhere] text-foreground">
                  {chosen ? <span className="sr-only">Selected: </span> : null}
                  {item.label}
                </span>
                {item.note ? <span className="mt-0.5 block min-w-0 text-meta [overflow-wrap:anywhere] text-muted-foreground">{item.note}</span> : null}
              </span>
              {chosen ? <CheckIcon size={14} className="mt-0.5 shrink-0 text-primary-text" /> : null}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div role="group" aria-label="Options" className="flex flex-col gap-1.5">
      {block.items.map((item, index) => {
        const activePrefill = action === "prefill" && prefilledIndex === index;
        return (
          <button
            key={index}
            type="button"
            disabled={disabled}
            onClick={() => {
              const text = item.reply ?? item.label;
              const ok = onChoose(text, action);
              if (!ok) return;
              if (action === "prefill") {
                setPrefilledIndex(index);
                return;
              }
              if (!prefersFinePointer()) {
                pendingGroupFocus.current = true;
                setFocusGroupState(true);
              }
            }}
            className={cn(
              "group flex w-full items-start justify-between gap-2.5 rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55",
              activePrefill ? "border-primary/60 bg-primary-soft/40" : "border-border bg-raised/60 hover:border-primary/40 hover:bg-accent/60",
            )}
          >
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              <span className="block min-w-0 text-ui font-medium [overflow-wrap:anywhere] text-foreground">{item.label}</span>
              {item.note ? <span className="mt-0.5 block min-w-0 text-meta [overflow-wrap:anywhere] text-muted-foreground">{item.note}</span> : null}
            </span>
            <span aria-hidden="true" className="mt-0.5 shrink-0 font-mono text-meta text-faint transition-colors group-hover:text-foreground">
              {action === "prefill" ? "✎" : "↵"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
