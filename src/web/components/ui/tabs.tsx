import { Tabs as TabsPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export const Tabs = TabsPrimitive.Root;

/** Pill tabs on a muted track, for switching between views of the same list. */
export function TabsList({ className, ...rest }: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("inline-flex h-9 items-center gap-0.5 rounded-md bg-muted p-0.5 text-muted-foreground ring-1 ring-inset ring-border-strong/50", className)} {...rest} />;
}

export function TabsTrigger({ className, ...rest }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] px-3 text-ui font-semibold transition-[color,background-color,box-shadow] duration-150 hover:text-foreground disabled:pointer-events-none disabled:opacity-55 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs data-[state=active]:ring-1 data-[state=active]:ring-input/70",
        className,
      )}
      {...rest}
    />
  );
}

/** Underline tabs, for switching work areas inside a dense toolbar. */
export function TabsUnderlineList({ className, ...rest }: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("flex h-full items-end gap-1", className)} {...rest} />;
}

export function TabsUnderlineTrigger({ className, ...rest }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "relative flex h-10 items-center gap-2 rounded-t-md px-3 text-ui font-medium text-muted-foreground transition-colors duration-150 after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:scale-x-0 after:rounded-full after:bg-primary after:transition-transform after:duration-200 hover:bg-accent hover:text-foreground data-[state=active]:text-foreground data-[state=active]:after:scale-x-100",
        className,
      )}
      {...rest}
    />
  );
}

export function TabsContent({ className, ...rest }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("outline-none data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-200", className)} {...rest} />;
}
