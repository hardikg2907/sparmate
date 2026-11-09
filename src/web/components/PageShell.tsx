import type { CSSProperties, ReactNode } from "react";
import { AppHeader, BottomTabs } from "./AppHeader";
import { cn } from "./ui";

/** The frame of every reading page: the main bar, then a centred column that scrolls with the page, and the tab bar on a phone. `--header-h` is the bar's height, so a sticky element can sit just below it. */
export function PageShell({ testMode, children, className }: { testMode?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className="page-canvas flex h-full min-h-0 flex-col overflow-y-auto" style={{ "--header-h": testMode ? "4.25rem" : "3.5rem" } as CSSProperties}>
      <AppHeader testMode={testMode} />
      <main tabIndex={-1} className={cn("mx-auto w-full max-w-[1224px] flex-1 px-4 pb-24 pt-8 sm:px-8 sm:pb-16", className)}>
        {children}
      </main>
      <BottomTabs />
    </div>
  );
}

/** The page title row: the heading on the left, whatever belongs beside it on the right. */
export function PageHeader({ kicker, title, aside }: { kicker?: ReactNode; title: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div>
        {kicker ? <p className="text-ui text-muted-foreground">{kicker}</p> : null}
        <h1 className="text-display font-bold text-foreground">{title}</h1>
      </div>
      {aside}
    </div>
  );
}
