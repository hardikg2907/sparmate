import { describe, expect, it } from "vitest";
import { nextCountFrom } from "./countFrom";

describe("nextCountFrom", () => {
  it("takes a full date", () => {
    expect(nextCountFrom("2026-10-08", false, undefined)).toBe("2026-10-08");
    expect(nextCountFrom("2026-10-09", false, "2026-10-08")).toBe("2026-10-09");
  });

  it("keeps the day that was there while the box holds only part of a date", () => {
    expect(nextCountFrom("", true, "2026-10-08")).toBe("2026-10-08");
    expect(nextCountFrom("", true, undefined)).toBeUndefined();
  });

  it("clears the day when the box was emptied completely", () => {
    expect(nextCountFrom("", false, "2026-10-08")).toBeUndefined();
  });
});
