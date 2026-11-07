import { describe, expect, it } from "vitest";
import { splitGraphText } from "./graphText";

describe("splitGraphText", () => {
  it("returns the text untouched when there are no warnings", () => {
    const text = "Nodes:\n- [A] (kind: service)";
    expect(splitGraphText(text)).toEqual({ body: text, warnings: [] });
  });

  it("moves a trailing Warnings line out of the body", () => {
    const parsed = splitGraphText("Nodes:\n- [A]\nWarnings: node [Cache] has no connections");
    expect(parsed.body).toBe("Nodes:\n- [A]");
    expect(parsed.warnings).toEqual(["node [Cache] has no connections"]);
  });

  it("splits several warnings on one line", () => {
    expect(splitGraphText("Warnings: node [A] is unlabeled; arrow is dangling").warnings).toEqual(["node [A] is unlabeled", "arrow is dangling"]);
  });

  it("reads a Warnings header followed by bullets", () => {
    expect(splitGraphText("Nodes:\n- [A]\nWarnings:\n- one\n- two").warnings).toEqual(["one", "two"]);
  });
});
