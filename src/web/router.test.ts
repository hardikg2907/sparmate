import { describe, expect, it } from "vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { drillDetailPath, drillPath, guardNavigation, hashSnapshot, legacyTarget, navigate, parseRoute, subscribeToRoute } from "./router";

describe("parseRoute", () => {
  it.each([
    ["/", "home"],
    ["", "home"],
    ["/practice", "practice"],
    ["/practice/", "practice"],
    ["/practice/drills", "practice-drills"],
    ["/library/new", "library-new"],
    ["/progress", "progress"],
    ["/settings", "settings"],
    ["/usage", "usage"],
    ["/usage/", "usage"],
  ])("maps %s to %s", (path, name) => {
    expect(parseRoute(path)).toEqual({ name });
  });

  it.each([
    ["/library", "/practice", "practice"],
    ["/library/", "/practice", "practice"],
    ["/gym", "/practice/drills", "practice-drills"],
    ["/dsa", "/progress#dsa", "progress"],
    ["/history/", "/progress#history", "progress"],
  ])("sends the old address %s to %s", (path, target, name) => {
    expect(legacyTarget(path)).toBe(target);
    expect(parseRoute(path)).toEqual({ name });
  });

  it("has no redirect for current addresses", () => {
    for (const path of ["/", "/practice", "/practice/drills", "/progress", "/library/new", "/gym/drill/capacity/c2-url-shortener", "/constructor"]) {
      expect(legacyTarget(path)).toBeNull();
    }
  });

  it("keeps the room address", () => {
    expect(parseRoute("/session/20261030-0900-c2-url-shortener-abcd")).toEqual({ name: "session", id: "20261030-0900-c2-url-shortener-abcd" });
    expect(parseRoute("/session/20261030-0900-c2-url-shortener-abcd/")).toMatchObject({ name: "session" });
  });

  it("reads a free drill and a queued drill from the address, and builds the same address back", () => {
    expect(parseRoute("/gym/drill/capacity/c2-url-shortener")).toEqual({ name: "drill", target: { drill: "capacity", problemId: "c2-url-shortener" } });
    const queued = parseRoute("/gym/drill/deep_dive/c2-news-feed/0123456789abcdef/");
    expect(queued).toEqual({ name: "drill", target: { drill: "deep_dive", problemId: "c2-news-feed", drillId: "0123456789abcdef" } });
    if (queued.name === "drill") expect(drillPath(queued.target)).toBe("/gym/drill/deep_dive/c2-news-feed/0123456789abcdef");
  });

  it("reads the history of a queued drill from the address, and builds the same address back", () => {
    expect(parseRoute("/practice/drills/0123456789abcdef")).toEqual({ name: "drill-detail", drillId: "0123456789abcdef" });
    expect(parseRoute("/practice/drills/0123456789abcdef/")).toEqual({ name: "drill-detail", drillId: "0123456789abcdef" });
    expect(drillDetailPath("0123456789abcdef")).toBe("/practice/drills/0123456789abcdef");
    expect(legacyTarget("/practice/drills/0123456789abcdef")).toBeNull();
  });

  it.each([
    "/practice/drills/zz",
    "/practice/drills/0123456789ABCDEF",
    "/practice/drills/0123456789abcdef0",
    "/practice/drills/0123456789abcdef/x",
    "/practice/drills/../progress",
  ])("does not read %s as a drill history", (path) => {
    expect(parseRoute(path)).toEqual({ name: "not-found" });
  });

  it.each(["/gym/drill", "/gym/drill/juggling/c2-url-shortener", "/gym/drill/capacity/../x", "/gym/drill/capacity/c2-url-shortener/zz", "/gym/drill/capacity/C2"])(
    "does not read %s as a drill",
    (path) => {
      expect(parseRoute(path)).toEqual({ name: "not-found" });
    },
  );

  it("does not match inherited object keys or unknown paths", () => {
    expect(parseRoute("/constructor")).toEqual({ name: "not-found" });
    expect(parseRoute("/__proto__")).toEqual({ name: "not-found" });
    expect(parseRoute("/library/other")).toEqual({ name: "not-found" });
    expect(parseRoute("/practice/other")).toEqual({ name: "not-found" });
    expect(parseRoute("/session/")).toEqual({ name: "not-found" });
  });
});

describe("navigation guard", () => {
  const pushed: string[] = [];
  beforeEach(() => {
    pushed.length = 0;
    vi.stubGlobal("document", {});
    vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {}, scrollTo: () => {} });
    vi.stubGlobal("location", { search: "", pathname: "/settings" });
    vi.stubGlobal("history", { pushState: (_s: unknown, _t: string, url: string) => pushed.push(url), replaceState: () => {} });
  });
  afterEach(() => {
    guardNavigation(null);
    vi.unstubAllGlobals();
  });

  it("goes straight there without a guard", () => {
    navigate("/library");
    expect(pushed).toEqual(["/library"]);
  });

  it("keeps the section anchor and the test-hook flag together", () => {
    vi.stubGlobal("location", { search: "?testhooks=1", pathname: "/practice" });
    navigate("/progress#skills");
    expect(pushed).toEqual(["/progress?testhooks=1#skills"]);
  });

  it("makes a new hash snapshot for a link to the address already shown", () => {
    const loc = { search: "", pathname: "/practice", hash: "#A" };
    vi.stubGlobal("location", loc);
    vi.stubGlobal("history", {
      pushState: (_s: unknown, _t: string, url: string) => {
        loc.hash = url.includes("#") ? `#${url.split("#")[1]}` : "";
      },
      replaceState: () => {},
    });
    navigate("/practice#A");
    const first = hashSnapshot();
    expect(first.hash).toBe("#A");
    expect(hashSnapshot()).toBe(first);
    navigate("/practice#A");
    expect(hashSnapshot()).not.toBe(first);
    expect(hashSnapshot().hash).toBe("#A");
  });

  it("hands the move to the guard, which can let it through", () => {
    const calls: string[] = [];
    guardNavigation((to, proceed) => {
      calls.push(to);
      proceed();
    });
    navigate("/library");
    expect(calls).toEqual(["/library"]);
    expect(pushed).toEqual(["/library"]);
  });

  it("stays put when the guard does not proceed, and goes after the guard is removed", () => {
    guardNavigation(() => {});
    navigate("/library");
    expect(pushed).toEqual([]);
    guardNavigation(null);
    navigate("/library");
    expect(pushed).toEqual(["/library"]);
  });
});

describe("Back and Forward with a guard", () => {
  const pushed: string[] = [];
  const replaced: string[] = [];
  let pop: (() => void) | null = null;
  let unsubscribe: (() => void) | null = null;
  const loc = { search: "", pathname: "/settings" };
  beforeEach(() => {
    pushed.length = 0;
    replaced.length = 0;
    loc.pathname = "/settings";
    vi.stubGlobal("document", {});
    vi.stubGlobal("window", {
      addEventListener: (type: string, fn: () => void) => {
        if (type === "popstate") pop = fn;
      },
      removeEventListener: () => {
        pop = null;
      },
      scrollTo: () => {},
    });
    vi.stubGlobal("location", loc);
    vi.stubGlobal("history", {
      pushState: (_s: unknown, _t: string, url: string) => {
        pushed.push(url);
        loc.pathname = url;
      },
      replaceState: (_s: unknown, _t: string, url: string) => {
        replaced.push(url);
        loc.pathname = url;
      },
    });
    navigate("/settings", { replace: true });
    replaced.length = 0;
  });
  afterEach(() => {
    guardNavigation(null);
    unsubscribe?.();
    unsubscribe = null;
    vi.unstubAllGlobals();
  });

  it("puts the page's address back and asks the guard where Back was going", () => {
    const heard: string[] = [];
    unsubscribe = subscribeToRoute(() => heard.push(loc.pathname));
    const asked: string[] = [];
    guardNavigation((to) => asked.push(to));
    loc.pathname = "/library";
    pop?.();
    expect(asked).toEqual(["/library"]);
    expect(pushed).toEqual(["/settings"]);
    expect(loc.pathname).toBe("/settings");
    expect(heard).toEqual([]);
  });

  it("goes where Back was going once the guard lets it", () => {
    const heard: string[] = [];
    unsubscribe = subscribeToRoute(() => heard.push(loc.pathname));
    guardNavigation((_to, proceed) => proceed());
    loc.pathname = "/library";
    pop?.();
    expect(replaced).toEqual(["/library"]);
    expect(heard).toEqual(["/library"]);
  });

  it("follows Back at once when no guard is set", () => {
    const heard: string[] = [];
    unsubscribe = subscribeToRoute(() => heard.push(loc.pathname));
    loc.pathname = "/library";
    pop?.();
    expect(pushed).toEqual([]);
    expect(heard).toEqual(["/library"]);
  });
});
