import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/utils";
import { KbdGroup } from "./kbd";

export function TooltipProvider({ delayDuration = 350, skipDelayDuration = 250, ...rest }: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={skipDelayDuration} {...rest} />;
}

export const TooltipRoot = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({ className, sideOffset = 6, children, ...rest }: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-[70] flex max-w-72 items-center gap-2 rounded-md bg-foreground px-2.5 py-1.5 text-meta font-medium text-background shadow-md",
          "origin-(--radix-tooltip-content-transform-origin) animate-in fade-in-0 zoom-in-[0.97] duration-150 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-100",
          className,
        )}
        {...rest}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

/**
 * Wraps one focusable element. The tooltip adds sight of the name and its shortcut; it never replaces the
 * element's own accessible name, so icon buttons still need an aria-label.
 */
export function Tooltip({
  content,
  shortcut,
  side = "bottom",
  className,
  children,
}: {
  content: ReactNode;
  shortcut?: string[];
  side?: "top" | "bottom" | "left" | "right";
  /** Overrides the dark label surface, for rich content that needs the light popover tokens. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipContent side={side} className={className}>
        <span>{content}</span>
        {shortcut ? <KbdGroup keys={shortcut} className="[&_kbd]:border-background/25 [&_kbd]:bg-background/15 [&_kbd]:text-background" /> : null}
      </TooltipContent>
    </TooltipPrimitive.Root>
  );
}
