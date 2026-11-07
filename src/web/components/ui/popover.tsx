import { Popover as PopoverPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";
import { containEscape, FLOATING_MOTION, FLOATING_SURFACE } from "./layer";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export function PopoverContent({ className, sideOffset = 6, align = "center", onEscapeKeyDown, ...rest }: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        onEscapeKeyDown={containEscape(onEscapeKeyDown)}
        className={cn(FLOATING_SURFACE, FLOATING_MOTION, "z-50 w-72 origin-(--radix-popover-content-transform-origin) p-4 outline-none", className)}
        {...rest}
      />
    </PopoverPrimitive.Portal>
  );
}
