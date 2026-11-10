import { useMemo, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { DrillTargetSchema, type DrillTarget } from "../shared/drills";

export type PageName = "home" | "practice" | "practice-drills" | "practice-new" | "progress" | "settings" | "usage";

export type Route =
  { name: PageName } | { name: "session"; id: string } | { name: "drill"; target: DrillTarget } | { name: "drill-detail"; drillId: string } | { name: "not-found" };

const SESSION_PATH = /^\/session\/([A-Za-z0-9_-]{1,160})\/?$/;
const DRILL_DETAIL_PATH = /^\/practice\/drills\/([a-f0-9]{16})\/?$/;
const DRILL_PATH = /^\/gym\/drill\/([a-z_]{1,20})\/([a-z0-9][a-z0-9-]{1,80})(?:\/([a-f0-9]{16}))?\/?$/;

/** The address of one drill. A queued drill carries its id, so the attempt counts toward its schedule. */
export function drillPath(target: DrillTarget): string {
  return `/gym/drill/${target.drill}/${target.problemId}${target.drillId ? `/${target.drillId}` : ""}`;
}

/** The history of one queued drill. */
export function drillDetailPath(drillId: string): string {
  return `/practice/drills/${drillId}`;
}

const PAGE_PATHS: Record<string, PageName> = {
  "/": "home",
  "/practice": "practice",
  "/practice/drills": "practice-drills",
  "/practice/new": "practice-new",
  "/progress": "progress",
  "/settings": "settings",
  "/usage": "usage",
};

/** Addresses from before the pages were merged. Each one is replaced in place by the page that took over. */
const LEGACY_PATHS: Record<string, string> = {
  "/library": "/practice",
  "/library/new": "/practice/new",
  "/gym": "/practice/drills",
  "/dsa": "/progress#dsa",
  "/history": "/progress#history",
};

function trimmed(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : "/";
}

/** The current address of an old one, with its section anchor, or null when the address is not an old one. */
export function legacyTarget(pathname: string): string | null {
  const path = trimmed(pathname);
  return Object.hasOwn(LEGACY_PATHS, path) ? (LEGACY_PATHS[path] ?? null) : null;
}

export function parseRoute(pathname: string): Route {
  const legacy = legacyTarget(pathname);
  const path = legacy ? (legacy.split("#")[0] ?? "/") : trimmed(pathname);
  const page = Object.hasOwn(PAGE_PATHS, path) ? PAGE_PATHS[path] : undefined;
  if (page) return { name: page };
  if (pathname === "") return { name: "home" };
  const match = SESSION_PATH.exec(pathname);
  if (match?.[1]) return { name: "session", id: match[1] };
  const detail = DRILL_DETAIL_PATH.exec(pathname);
  if (detail?.[1]) return { name: "drill-detail", drillId: detail[1] };
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

/**
 * One object per navigation, even to the address already shown, so a page that follows an anchor can tell a repeated
 * link from no link at all.
 */
export interface HashNav {
  hash: string;
}
let hashNav: HashNav | null = null;
const NO_HASH: HashNav = { hash: "" };

export function hashSnapshot(): HashNav {
  hashNav ??= { hash: location.hash };
  return hashNav;
}

function notify(): void {
  hashNav = { hash: location.hash };
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
  const [path = to, ...anchor] = to.split("#");
  const hash = anchor.length > 0 ? `#${anchor.join("#")}` : "";
  const kept = new URLSearchParams();
  const current = new URLSearchParams(location.search);
  if (current.get("testhooks") === "1") kept.set("testhooks", "1");
  const query = kept.toString();
  return `${path}${query ? `?${query}` : ""}${hash}`;
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

/**
 * `instant` swaps the address with no cross-fade and no scroll to the top, for a switch inside one page
 * (the Rounds and Drills views), where the page stays mounted.
 */
export function navigate(to: string, options: { replace?: boolean; force?: boolean; instant?: boolean } = {}): void {
  if (locked) return;
  if (guard && !options.force) {
    guard(to, () => navigate(to, { ...options, force: true }));
    return;
  }
  const url = withKeptParams(to);
  const apply = () => {
    if (options.replace) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
    current = url.split("#")[0] ?? url;
    notify();
    if (!options.instant) window.scrollTo(0, 0);
  };
  if (options.instant) apply();
  else crossFade(apply);
}

export function useRoute(): Route {
  const pathname = useSyncExternalStore(
    subscribeToRoute,
    () => location.pathname,
    () => "/",
  );
  return useMemo(() => parseRoute(pathname), [pathname]);
}

/** The section anchor of the address. The object changes on every navigation, so an effect keyed on it runs again for a repeated link. */
export function useHash(): HashNav {
  return useSyncExternalStore(subscribeToRoute, hashSnapshot, () => NO_HASH);
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
