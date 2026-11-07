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
    expect(revealFor("hld", "capacity")).toEqual({ view: "board", step: "capacity" });
  });

  it("reads a borrowed step from the frame it borrows", () => {
    expect(revealFor("hld", "wrap_up")).toEqual({ view: "board", step: "design" });
  });
});
