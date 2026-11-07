import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

const TONE = {
  info: "bg-primary-soft text-primary-soft-foreground",
  warn: "bg-warning-soft text-warning",
  bad: "bg-destructive-soft text-destructive",
  good: "bg-success-soft text-success",
} as const;

/** A full-width strip under a page header for a page-wide state, such as a lost connection. */
export function Banner({
  tone,
  children,
  actions,
  role = "status",
  className,
}: {
  tone: keyof typeof TONE;
  children: ReactNode;
  actions?: ReactNode;
  role?: "status" | "alert";
  className?: string;
}) {
  return (
    <div role={role} className={cn("flex items-center gap-3 px-4 py-2 text-ui animate-in fade-in-0 slide-in-from-top-1 duration-200", TONE[tone], className)}>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** A boxed message inside the page flow: an error with a retry, or a note next to the thing it is about. */
export function Alert({
  tone,
  title,
  children,
  actions,
  icon,
  role = "status",
  className,
}: {
  tone: keyof typeof TONE;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  role?: "status" | "alert";
  className?: string;
}) {
  return (
    <div role={role} className={cn("flex items-start gap-3 rounded-lg border border-current/15 px-4 py-3 text-ui animate-in fade-in-0 duration-200", TONE[tone], className)}>
      {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
      <div className="min-w-0 flex-1 space-y-0.5">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-foreground/90 [&_a]:underline">{children}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2 self-center">{actions}</div> : null}
    </div>
  );
}
