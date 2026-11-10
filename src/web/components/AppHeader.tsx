import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDueDrillCount } from "../lib/useGym";
import { Link, useRoute, type PageName } from "../router";
import { CommandPalette, PALETTE_KEYS, openPalette } from "./CommandPalette";
import { BarChartIcon, ChevronDownIcon, FlaskIcon, HomeIcon, KeyboardIcon, ListIcon, MenuIcon, SearchIcon, SlidersIcon, TrendIcon } from "./icons";
import { Logo } from "./Logo";
import { openShortcuts } from "./ShortcutsDialog";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Kbd, cn } from "./ui";

export const TABS: { href: string; label: string; pages: PageName[]; icon: typeof HomeIcon }[] = [
  { href: "/", label: "Today", pages: ["home"], icon: HomeIcon },
  { href: "/practice", label: "Practice", pages: ["practice", "practice-drills", "practice-new"], icon: ListIcon },
  { href: "/progress", label: "Progress", pages: ["progress"], icon: TrendIcon },
];

export function currentPage(route: ReturnType<typeof useRoute>): PageName | null {
  if (route.name === "drill-detail") return "practice-drills";
  return route.name === "session" || route.name === "drill" || route.name === "not-found" ? null : route.name;
}

export function DueBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span className={cn("rounded-full bg-warning-soft px-1.5 text-meta font-semibold text-warning", className)} aria-label={`${count} due`}>
      {count}
    </span>
  );
}

/**
 * The main bar of every page that is not a room. It is flat while the page is at the top. Once content scrolls under it
 * the glass blur and the hairline fade in. On a phone only the logo and the menu stay here, and the tabs move to the bottom bar.
 */
export function AppHeader({ testMode }: { testMode?: boolean }) {
  const route = useRoute();
  const page = currentPage(route);
  const dueDrills = useDueDrillCount();
  const root = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);

  // The page's own scroller moves under this bar, so the bar listens to it rather than to the window.
  useEffect(() => {
    const scroller = root.current?.closest<HTMLElement>(".page-canvas");
    if (!scroller) return;
    const update = () => setScrolled(scroller.scrollTop > 2);
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    return () => scroller.removeEventListener("scroll", update);
  }, []);

  // The bar is taller in test mode and the strip can wrap, so its real height is published for the elements that sit below it.
  useLayoutEffect(() => {
    const bar = root.current;
    const scroller = bar?.closest<HTMLElement>(".page-canvas");
    if (!bar || !scroller) return;
    const publish = () => scroller.style.setProperty("--header-h", `${bar.offsetHeight}px`);
    publish();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(publish);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  return (
    <header ref={root} className="sticky top-0 z-20 shrink-0">
      <div
        aria-hidden="true"
        data-on={scrolled}
        className="pointer-events-none absolute inset-0 border-b border-border/70 bg-card/80 opacity-0 shadow-xs backdrop-blur-xl backdrop-saturate-150 transition-opacity duration-150 data-[on=true]:opacity-100"
      />
      <div className="relative mx-auto flex h-14 max-w-[1224px] items-center gap-2 px-4 sm:gap-6 sm:px-8">
        <Link href="/" aria-label="Sparmate, Today" className="flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md text-lead font-bold tracking-[-0.01em]">
          <span className="brand-tile flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground" aria-hidden="true">
            <Logo size={18} />
          </span>
          <span>Sparmate</span>
        </Link>
        <nav aria-label="Main" className="flex min-w-0 flex-1 items-stretch gap-1 self-stretch max-sm:hidden">
          {TABS.map((tab) => {
            const current = page !== null && tab.pages.includes(page);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "relative flex shrink-0 items-center gap-1.5 rounded-md px-3 text-ui font-medium transition-colors",
                  current
                    ? "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
                {tab.href === "/practice" ? <DueBadge count={dueDrills} /> : null}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:ml-0">
          <button
            type="button"
            onClick={openPalette}
            className="flex h-9 w-64 items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 text-ui text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground max-sm:hidden"
          >
            <SearchIcon size={15} />
            <span className="flex-1 text-left">Jump to…</span>
            <span className="flex items-center gap-0.5" aria-hidden="true">
              {PALETTE_KEYS.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </span>
            <span className="sr-only">Shortcut {PALETTE_KEYS.join(" ")}</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-1.5 px-2.5">
                <MenuIcon size={16} />
                Menu
                <ChevronDownIcon size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[14rem]">
              <DropdownMenuItem asChild>
                <Link href="/settings" aria-current={page === "settings" ? "page" : undefined}>
                  <SlidersIcon size={16} className="text-muted-foreground" />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/usage" aria-current={page === "usage" ? "page" : undefined}>
                  <BarChartIcon size={16} className="text-muted-foreground" />
                  Usage
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openShortcuts()}>
                <KeyboardIcon size={16} className="text-muted-foreground" />
                Keyboard shortcuts
                <Kbd className="ml-auto">?</Kbd>
              </DropdownMenuItem>
              {testMode ? (
                <>
                  <DropdownMenuSeparator />
                  <div role="note" className="flex items-center gap-2 px-2.5 py-2 text-ui text-warning">
                    <FlaskIcon size={16} />
                    Test mode is on
                  </div>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {testMode ? (
        <div role="status" className="relative border-y border-warning-fill/60 bg-warning-soft py-0.5 text-center text-meta font-semibold text-warning">
          Test mode: the model is faked
        </div>
      ) : null}
      <CommandPalette />
    </header>
  );
}

/** The tab bar of a phone. Jump opens the palette as a bottom sheet. */
export function BottomTabs() {
  const route = useRoute();
  const page = currentPage(route);
  const dueDrills = useDueDrillCount();
  const root = useRef<HTMLElement>(null);
  // A page's own fixed bottom bar must sit above this one, so the bar's real height (zero when hidden) is published.
  useLayoutEffect(() => {
    const bar = root.current;
    const scroller = bar?.closest<HTMLElement>(".page-canvas");
    if (!bar || !scroller) return;
    const publish = () => scroller.style.setProperty("--tabbar-h", `${bar.offsetHeight}px`);
    publish();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(publish);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);
  const item = "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-meta font-medium transition-colors";
  return (
    <nav ref={root} aria-label="Main" className="bottom-tabs fixed inset-x-0 bottom-0 z-30 flex border-t border-border/70 bg-card/90 backdrop-blur-xl sm:hidden">
      {TABS.map((tab) => {
        const current = page !== null && tab.pages.includes(page);
        return (
          <Link key={tab.href} href={tab.href} aria-current={current ? "page" : undefined} className={cn(item, current ? "text-foreground" : "text-muted-foreground")}>
            <span className="relative">
              <tab.icon size={20} className={current ? "text-primary-text" : ""} />
              {tab.href === "/practice" ? <DueBadge count={dueDrills} className="absolute -right-3.5 -top-1.5 px-1" /> : null}
            </span>
            {tab.label}
          </Link>
        );
      })}
      <button type="button" onClick={openPalette} className={cn(item, "text-muted-foreground")}>
        <SearchIcon size={20} />
        Jump
      </button>
    </nav>
  );
}
