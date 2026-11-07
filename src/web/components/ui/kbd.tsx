import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

/** A key name drawn as a keycap, for the shortcuts the page offers. */
export function Kbd({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-border border-b-input/60 bg-muted px-1.5 font-mono text-meta font-medium text-muted-foreground",
        className,
      )}
      {...rest}
    />
  );
}

/** A key combination such as Ctrl + M, drawn as keycaps. */
export function KbdGroup({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </span>
  );
}
