import type { HTMLAttributes } from "react";
import type { Tone } from "../../lib/format";
import { cn } from "../../lib/utils";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  accent: "bg-primary-soft text-primary-soft-foreground",
  good: "bg-success-soft text-success",
  warn: "bg-warning-soft text-warning",
  bad: "bg-destructive-soft text-destructive",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  mono?: boolean;
}

/** A short status label. The tone carries meaning only; the text must say the same thing on its own. */
export function Badge({ tone = "neutral", mono, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "tint inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-transparent px-2 py-px text-meta font-semibold transition-colors",
        mono && "font-mono",
        TONE_CLASS[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
