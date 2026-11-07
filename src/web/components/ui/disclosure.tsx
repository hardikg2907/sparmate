import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { ChevronDownIcon } from "../icons";

export const Collapsible = CollapsiblePrimitive.Root;
export const CollapsibleTrigger = CollapsiblePrimitive.Trigger;

export function CollapsibleContent({ className, ...rest }: CollapsiblePrimitive.CollapsibleContentProps) {
  return (
    <CollapsiblePrimitive.Content
      className={cn("overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down", className)}
      {...rest}
    />
  );
}

/** A text link that shows or hides more detail, with a chevron that turns as it opens. */
export function Disclosure({
  summary,
  children,
  defaultOpen,
  className,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <CollapsiblePrimitive.Root defaultOpen={defaultOpen} className={cn("group/disclosure", className)}>
      <CollapsiblePrimitive.Trigger className="flex w-fit items-center gap-1.5 rounded-sm text-ui font-semibold text-primary-text hover:underline hover:underline-offset-2">
        <ChevronDownIcon size={14} className="-rotate-90 transition-transform duration-200 group-data-[state=open]/disclosure:rotate-0" />
        {summary}
      </CollapsiblePrimitive.Trigger>
      <CollapsibleContent>
        <div className="pt-2">{children}</div>
      </CollapsibleContent>
    </CollapsiblePrimitive.Root>
  );
}
