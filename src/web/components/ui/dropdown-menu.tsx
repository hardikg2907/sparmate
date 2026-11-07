import { DropdownMenu as MenuPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";
import { containEscape, FLOATING_MOTION, FLOATING_SURFACE } from "./layer";

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;

export function DropdownMenuContent({ className, sideOffset = 6, align = "end", onEscapeKeyDown, ...rest }: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        onEscapeKeyDown={containEscape(onEscapeKeyDown)}
        className={cn(FLOATING_SURFACE, FLOATING_MOTION, "z-50 min-w-[12rem] origin-(--radix-dropdown-menu-content-transform-origin) p-1", className)}
        {...rest}
      />
    </MenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({ className, danger, ...rest }: ComponentProps<typeof MenuPrimitive.Item> & { danger?: boolean }) {
  return (
    <MenuPrimitive.Item
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-sm px-2.5 py-2 text-ui outline-none transition-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-55 data-[highlighted]:bg-accent",
        danger ? "text-destructive data-[highlighted]:bg-destructive-soft" : "text-foreground",
        className,
      )}
      {...rest}
    />
  );
}

export function DropdownMenuLabel({ className, ...rest }: ComponentProps<typeof MenuPrimitive.Label>) {
  return <MenuPrimitive.Label className={cn("px-2.5 py-1.5 text-meta font-semibold text-muted-foreground", className)} {...rest} />;
}

export function DropdownMenuSeparator({ className, ...rest }: ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...rest} />;
}
