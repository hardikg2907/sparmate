import type { ReactNode } from "react";

/** A section's heading sits on a strong rule, so the page reads as chapters even when every block under it is quiet. */
export function SectionTitle({ children, aside, id, focusable }: { children: ReactNode; aside?: ReactNode; id?: string; focusable?: boolean }) {
  return (
    <div className="section-rule mb-4 flex items-end justify-between gap-4 pb-2.5">
      <h2 id={id} tabIndex={focusable ? -1 : undefined} className="text-title font-bold tracking-[-0.01em] text-foreground">
        {children}
      </h2>
      {aside ? <div className="pb-0.5 text-ui text-muted-foreground">{aside}</div> : null}
    </div>
  );
}
