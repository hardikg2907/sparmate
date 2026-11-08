import { describe, expect, it } from "vitest";
import { revealFor } from "./reveal";

describe("revealFor", () => {
  it("sends a machine-coding step without a frame to the code", () => {
    expect(revealFor("lld", "skeleton")).toEqual({ view: "code" });
    expect(revealFor("lld", "clarify")).toEqual({ view: "code" });
  });

  it("brings a machine-coding step's frame into view on the board", () => {
    expect(revealFor("lld", "entities")).toEqual({ view: "board", step: "entities" });
  });

  it("brings a high-level step's frame into view", () => {
    expect(revealFor("hld", "entities")).toEqual({ view: "board", step: "entities" });
  });

  it("sends a step without a frame to the whole board", () => {
    expect(revealFor("hld", "unknown_step")).toEqual({ view: "board", step: null });
  });
});
