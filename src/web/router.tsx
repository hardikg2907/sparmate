import { useMemo, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { DrillTargetSchema, type DrillTarget } from "../shared/drills";

export type PageName = "home" | "library" | "library-new" | "gym" | "dsa" | "progress" | "history" | "settings" | "usage";

export type Route = { name: PageName } | { name: "session"; id: string } | { name: "drill"; target: DrillTarget } | { name: "not-found" };

const SESSION_PATH = /^\/session\/([A-Za-z0-9_-]{1,160})\/?$/;
const DRILL_PATH = /^\/gym\/drill\/([a-z_]{1,20})\/([a-z0-9][a-z0-9-]{1,80})(?:\/([a-f0-9]{16}))?\/?$/;

/** The address of one drill. A queued drill carries its id, so the attempt counts toward its schedule. */
export function drillPath(target: DrillTarget): string {
  return `/gym/drill/${target.drill}/${target.problemId}${target.drillId ? `/${target.drillId}` : ""}`;
}

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
  const drill = DRILL_PATH.exec(pathname);
  if (drill?.[1] && drill[2]) {
    const target = DrillTargetSchema.safeParse({ drill: drill[1], problemId: drill[2], ...(drill[3] ? { drillId: drill[3] } : {}) });
    if (target.success) return { name: "drill", target: target.data };
  }
  return { name: "not-found" };
}

const listeners = new Set<() => void>();
let locked = false;
/** The address the page on screen belongs to, so a guarded Back can put it back. */
let current: string | null = null;

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/**
 * The browser has already changed the address when Back or Forward fires popstate, so a guard cannot stop it the
 * way it stops a link. The page's own address goes back on top, and the guard decides as it does for a link.
 */
function onPopState(): void {
  const target = location.pathname + location.search;
  if (guard && current !== null && current !== target) {
    const decide = guard;
    history.pushState(null, "", current);
    decide(target, () => navigate(target, { replace: true, force: true }));
    return;
  }
  current = target;
  notify();
}

export function subscribeToRoute(listener: () => void): () => void {
  if (listeners.size === 0) {
    current ??= location.pathname + location.search;
    window.addEventListener("popstate", onPopState);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("popstate", onPopState);
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

type NavigationGuard = (to: string, proceed: () => void) => void;
let guard: NavigationGuard | null = null;

/**
 * While a guard is set, an in-app navigation calls it instead of leaving. The guard decides, and calls `proceed`
 * to go on. Pass null to remove it. A page with unsaved work uses this to ask first.
 */
export function guardNavigation(next: NavigationGuard | null): void {
  guard = next;
}

export function navigate(to: string, options: { replace?: boolean; force?: boolean } = {}): void {
  if (locked) return;
  if (guard && !options.force) {
    guard(to, () => navigate(to, { ...options, force: true }));
    return;
  }
  const url = withKeptParams(to);
  crossFade(() => {
    if (options.replace) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
    current = url;
    notify();
    window.scrollTo(0, 0);
  });
}

export function useRoute(): Route {
  const pathname = useSyncExternalStore(
    subscribeToRoute,
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
