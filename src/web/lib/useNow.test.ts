import { describe, expect, it } from "vitest";
import { msToNextDay } from "./useNow";

describe("msToNextDay", () => {
  it("counts to the next local midnight and one second more", () => {
    expect(msToNextDay(new Date(2026, 10, 8, 23, 0, 0))).toBe(3_600_000 + 1000);
    expect(msToNextDay(new Date(2026, 10, 8, 0, 0, 0))).toBe(86_400_000 + 1000);
  });

  it("crosses a month end", () => {
    expect(msToNextDay(new Date(2026, 10, 30, 23, 59, 59))).toBe(2000);
  });
});
