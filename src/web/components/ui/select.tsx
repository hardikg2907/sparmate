import { Select as SelectPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";
import { CheckIcon, ChevronDownIcon } from "../icons";
import { containEscape, FLOATING_MOTION, FLOATING_SURFACE } from "./layer";

export const SelectRoot = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

export function SelectTrigger({ className, size = "default", children, ...rest }: ComponentProps<typeof SelectPrimitive.Trigger> & { size?: "sm" | "default" }) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "group inline-flex items-center justify-between gap-2 rounded-md border border-input/70 bg-card px-2.5 text-ui font-medium text-foreground shadow-xs transition-[border-color,background-color] duration-150 hover:border-input hover:bg-accent disabled:cursor-not-allowed disabled:opacity-55 data-[placeholder]:text-faint [&>span]:truncate",
        size === "sm" ? "h-8" : "h-9",
        className,
      )}
      {...rest}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon size={14} className="text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-180" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({ className, children, position = "popper", onEscapeKeyDown, ...rest }: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        sideOffset={4}
        onEscapeKeyDown={containEscape(onEscapeKeyDown)}
        className={cn(
          FLOATING_SURFACE,
          FLOATING_MOTION,
          "relative z-[60] max-h-(--radix-select-content-available-height) min-w-[max(var(--radix-select-trigger-width),10rem)] origin-(--radix-select-content-transform-origin) overflow-hidden",
          className,
        )}
        {...rest}
      >
        <SelectPrimitive.Viewport className="max-h-[min(280px,var(--radix-select-content-available-height))] p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({ className, children, hint, ...rest }: ComponentProps<typeof SelectPrimitive.Item> & { hint?: string }) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex cursor-pointer select-none items-center justify-between gap-3 rounded-sm py-1.5 pl-2.5 pr-8 text-ui text-foreground outline-none transition-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-accent data-[state=checked]:font-semibold",
        className,
      )}
      {...rest}
    >
      <span className="min-w-0 flex-1">
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        {hint ? <span className="block truncate text-meta font-normal text-muted-foreground">{hint}</span> : null}
      </span>
      <span className="absolute right-2.5 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon size={14} className="text-primary" />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}
