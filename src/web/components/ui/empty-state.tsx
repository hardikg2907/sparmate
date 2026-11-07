import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

/** What a section shows when it has nothing yet: what is missing, why, and the one action that fills it. */
export function EmptyState({
  icon,
  title,
  children,
  action,
  role,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  role?: "status" | "alert";
  className?: string;
}) {
  return (
    <div role={role} className={cn("flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center fade-in", className)}>
      {icon ? <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">{icon}</span> : null}
      <p className="text-body font-semibold text-foreground">{title}</p>
      {children ? <div className="max-w-md text-ui text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-2 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}
