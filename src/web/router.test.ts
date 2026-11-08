import { describe, expect, it } from "vitest";
import { parseRoute } from "./router";

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
