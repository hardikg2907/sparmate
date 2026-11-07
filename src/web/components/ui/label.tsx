import { Label as LabelPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Label({ className, ...rest }: ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn("text-ui font-semibold text-muted-foreground peer-disabled:opacity-55", className)} {...rest} />;
}
