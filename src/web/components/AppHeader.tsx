import type { ReactNode } from "react";
import { Link, useRoute, type PageName } from "../router";
import { BarChartIcon, SlidersIcon } from "./icons";
import { Logo } from "./Logo";
import { openShortcuts } from "./ShortcutsDialog";
import { Badge, Button, Kbd, Tooltip, cn } from "./ui";

const LINKS: { href: string; label: string; pages: PageName[] }[] = [
  { href: "/", label: "Today", pages: ["home"] },
  { href: "/library", label: "Library", pages: ["library", "library-new"] },
  { href: "/gym", label: "Gym", pages: ["gym"] },
  { href: "/dsa", label: "DSA", pages: ["dsa"] },
  { href: "/progress", label: "Progress", pages: ["progress"] },
  { href: "/history", label: "History", pages: ["history"] },
];

/**
 * The main bar of every page that is not a room. It stays in view while the page scrolls under it. The links
 * scroll sideways on a narrow screen, so the page itself never does.
 */
export function AppHeader({ testMode, actions }: { testMode?: boolean; actions?: ReactNode }) {
  const route = useRoute();
  const page = route.name === "session" || route.name === "not-found" ? null : route.name;
  return (
    <header className="header-hairline sticky top-0 z-20 shrink-0 border-b border-border/70 bg-card/90 shadow-xs backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-card/80">
      <div className="mx-auto flex h-14 max-w-[1224px] items-center gap-3 px-4 sm:gap-6 sm:px-8">
        <Link href="/" aria-label="Sparmate, Today" className="flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md text-lead font-bold tracking-[-0.01em]">
          <span className="brand-tile flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground" aria-hidden="true">
            <Logo size={18} />
          </span>
          <span className="max-sm:sr-only">Sparmate</span>
        </Link>
        <nav aria-label="Main" className="no-scrollbar -mx-1 flex min-w-0 flex-1 items-stretch gap-1 self-stretch overflow-x-auto px-1">
          {LINKS.map((link) => {
            const current = page !== null && link.pages.includes(page);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "relative flex shrink-0 items-center rounded-md px-3 text-ui font-medium transition-colors",
                  current
                    ? "text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex shrink-0 items-center gap-1">
          {testMode ? (
            <Tooltip content="The server answers with scripted replies and makes no model calls.">
              <Badge tone="warn" tabIndex={0} className="max-sm:hidden">
                Test mode
              </Badge>
            </Tooltip>
          ) : null}
          {actions}
          <Tooltip content="Usage">
            <Button asChild variant="ghost" size="icon" className={cn(page === "usage" && "bg-accent text-foreground")}>
              <Link href="/usage" aria-label="Usage" aria-current={page === "usage" ? "page" : undefined}>
                <BarChartIcon size={16} />
              </Link>
            </Button>
          </Tooltip>
          <Tooltip content="Settings">
            <Button asChild variant="ghost" size="icon" className={cn(page === "settings" && "bg-accent text-foreground")}>
              <Link href="/settings" aria-label="Settings" aria-current={page === "settings" ? "page" : undefined}>
                <SlidersIcon size={16} />
              </Link>
            </Button>
          </Tooltip>
          <Tooltip content="Keyboard shortcuts" shortcut={["?"]}>
            <Button variant="ghost" size="icon" aria-label="Keyboard shortcuts" onClick={openShortcuts} className="max-sm:hidden">
              <Kbd className="border-0 bg-transparent px-0 text-ui">?</Kbd>
            </Button>
          </Tooltip>
        </div>
      </div>
    </header>
  );
}
