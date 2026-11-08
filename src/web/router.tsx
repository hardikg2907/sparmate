import { useMemo, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";
import { flushSync } from "react-dom";

export type PageName = "home" | "library" | "library-new" | "gym" | "dsa" | "progress" | "history" | "settings" | "usage";

export type Route = { name: PageName } | { name: "session"; id: string } | { name: "not-found" };

const SESSION_PATH = /^\/session\/([A-Za-z0-9_-]{1,160})\/?$/;

const PAGE_PATHS: Record<string, PageName> = {
  "/": "home",
  "/library": "library",
  "/library/new": "library-new",
  "/gym": "gym",
  "/dsa": "dsa",
  "/progress": "progress",
  "/history": "history",
  "/settings": "settings",
  "/usage": "usage",
};

export function parseRoute(pathname: string): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : "/";
  const page = Object.hasOwn(PAGE_PATHS, path) ? PAGE_PATHS[path] : undefined;
  if (page) return { name: page };
  if (pathname === "") return { name: "home" };
  const match = SESSION_PATH.exec(pathname);
  if (match?.[1]) return { name: "session", id: match[1] };
  return { name: "not-found" };
}

const listeners = new Set<() => void>();
let locked = false;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

/** Pages rendered from static data must not change the address bar. */
export function lockNavigation(): void {
  locked = true;
}

/** Keeps the test-hook flag across in-app links so a scripted run does not lose it between pages. */
function withKeptParams(to: string): string {
  if (to.includes("?")) return to;
  const kept = new URLSearchParams();
  const current = new URLSearchParams(location.search);
  if (current.get("testhooks") === "1") kept.set("testhooks", "1");
  const query = kept.toString();
  return query ? `${to}?${query}` : to;
}

/**
 * Pages cross-fade where the browser supports view transitions. The address and the page change together inside
 * the callback, so nothing sees the new address while the old page (and a room's microphone) is still mounted.
 * React renders the new page synchronously there, because the new view is captured when the callback returns.
 */
function crossFade(update: () => void): void {
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || typeof document.startViewTransition !== "function") {
    update();
    return;
  }
  document.startViewTransition(() => flushSync(update));
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (locked) return;
  const url = withKeptParams(to);
  crossFade(() => {
    if (options.replace) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
    for (const listener of [...listeners]) listener();
    window.scrollTo(0, 0);
  });
}

export function useRoute(): Route {
  const pathname = useSyncExternalStore(
    subscribe,
    () => location.pathname,
    () => "/",
  );
  return useMemo(() => parseRoute(pathname), [pathname]);
}

export function Link({ href, onClick, target, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || target) return;
    event.preventDefault();
    navigate(href);
  };
  return <a href={href} target={target} onClick={handle} {...rest} />;
}
