import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export const FIELD_CLASS =
  "w-full rounded-md border border-input/70 bg-card text-foreground shadow-xs transition-[border-color,box-shadow] duration-150 placeholder:text-faint hover:border-input focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55 aria-invalid:border-destructive-fill";

export function Input({ className, type = "text", ...rest }: ComponentProps<"input">) {
  return <input type={type} className={cn(FIELD_CLASS, "h-9 px-3 text-ui", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea className={cn(FIELD_CLASS, "min-h-20 px-3 py-2 text-body", className)} {...rest} />;
}
