import { describe, expect, it } from "vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { guardNavigation, navigate, parseRoute } from "./router";

describe("parseRoute", () => {
  it.each([
    ["/", "home"],
    ["", "home"],
    ["/library", "library"],
    ["/library/", "library"],
    ["/library/new", "library-new"],
    ["/gym", "gym"],
    ["/dsa", "dsa"],
    ["/progress", "progress"],
    ["/history", "history"],
    ["/settings", "settings"],
    ["/usage", "usage"],
    ["/usage/", "usage"],
  ])("maps %s to %s", (path, name) => {
    expect(parseRoute(path)).toEqual({ name });
  });

  it("keeps the room address", () => {
    expect(parseRoute("/session/20261030-0900-c2-url-shortener-abcd")).toEqual({ name: "session", id: "20261030-0900-c2-url-shortener-abcd" });
    expect(parseRoute("/session/20261030-0900-c2-url-shortener-abcd/")).toMatchObject({ name: "session" });
  });

  it("does not match inherited object keys or unknown paths", () => {
    expect(parseRoute("/constructor")).toEqual({ name: "not-found" });
    expect(parseRoute("/__proto__")).toEqual({ name: "not-found" });
    expect(parseRoute("/library/other")).toEqual({ name: "not-found" });
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
