import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("keeps a text colour and a scale size together", () => {
    expect(cn("text-muted-foreground text-ui")).toBe("text-muted-foreground text-ui");
  });

  it("lets a later size or colour win over an earlier one", () => {
    expect(cn("text-ui text-foreground", "text-body text-primary")).toBe("text-body text-primary");
  });

  it("drops falsy parts", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });
});
