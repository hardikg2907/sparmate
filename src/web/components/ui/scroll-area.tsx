import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

/** Replaces one existing scroller; never place it inside another vertical scroller. */
export function ScrollArea({ className, children, viewportClassName, ...rest }: ComponentProps<typeof ScrollAreaPrimitive.Root> & { viewportClassName?: string }) {
  return (
    <ScrollAreaPrimitive.Root className={cn("relative overflow-hidden", className)} {...rest}>
      <ScrollAreaPrimitive.Viewport className={cn("size-full rounded-[inherit] focus-visible:outline-offset-[-2px]", viewportClassName)}>{children}</ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

export function ScrollBar({ className, orientation = "vertical", ...rest }: ComponentProps<typeof ScrollAreaPrimitive.Scrollbar>) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      orientation={orientation}
      className={cn(
        "flex touch-none select-none p-px transition-colors",
        orientation === "vertical" && "h-full w-2.5 border-l border-l-transparent",
        orientation === "horizontal" && "h-2.5 flex-col border-t border-t-transparent",
        className,
      )}
      {...rest}
    >
      <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-input/50 hover:bg-input/80" />
    </ScrollAreaPrimitive.Scrollbar>
  );
}
