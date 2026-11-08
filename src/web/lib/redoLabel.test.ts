import { describe, expect, it } from "vitest";
import { redoCardTitle } from "./redoLabel";

describe("redoCardTitle", () => {
  it("says more when a redo is the hero", () => {
    expect(redoCardTitle(3, true)).toBe("3 more redos");
    expect(redoCardTitle(1, true)).toBe("1 more redo");
  });

  it("says waiting when no redo is the hero", () => {
    expect(redoCardTitle(3, false)).toBe("3 redos waiting");
    expect(redoCardTitle(1, false)).toBe("1 redo waiting");
  });
});
