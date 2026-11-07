import type { ReactNode } from "react";
import { Link } from "../router";
import { Logo } from "./Logo";
import { openShortcuts } from "./ShortcutsDialog";
import { Button } from "./ui/button";
import { Kbd } from "./ui/kbd";
import { Tooltip } from "./ui/tooltip";

/**
 * The top bar of the reading pages. It stays in view while the page scrolls under it, so Settings and the way
 * home are always one click away.
 */
export function AppHeader({ title, titleAs = "h1", children, actions }: { title?: ReactNode; titleAs?: "h1" | "p"; children?: ReactNode; actions?: ReactNode }) {
  const Title = titleAs;
  return (
    <header className="header-hairline sticky top-0 z-20 shrink-0 border-b border-border/70 bg-card/90 shadow-xs backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-card/80">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:gap-5 sm:px-8">
        <Title className="flex items-center gap-2.5 whitespace-nowrap text-lead font-bold tracking-[-0.01em]">
          <Link href="/" className="flex items-center gap-2.5 rounded-md">
            <span className="brand-tile flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground" aria-hidden="true">
              <Logo size={18} />
            </span>
            <span>Interview Room</span>
          </Link>
          {title ? (
            <>
              <span aria-hidden="true" className="font-normal text-faint">
                /
              </span>
              <span className="font-semibold">{title}</span>
            </>
          ) : null}
        </Title>
        {children}
        <div className="ml-auto flex items-center gap-1.5">
          {actions}
          <Tooltip content="Keyboard shortcuts" shortcut={["?"]}>
            <Button variant="ghost" size="icon" aria-label="Keyboard shortcuts" onClick={openShortcuts}>
              <Kbd className="border-0 bg-transparent px-0 text-ui">?</Kbd>
            </Button>
          </Tooltip>
        </div>
      </div>
    </header>
  );
}
