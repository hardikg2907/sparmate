import { describe, expect, it } from "vitest";
import { daysSince, formatClock, formatDate, formatMinutes } from "./format";

describe("formatClock", () => {
  it("pads minutes and seconds", () => {
    expect(formatClock(65_000)).toBe("01:05");
  });

  it("lets minutes pass 59 for long rounds", () => {
    expect(formatClock(119 * 60_000 + 59_000)).toBe("119:59");
  });

  it("shows zero for negative time", () => {
    expect(formatClock(-5000)).toBe("00:00");
  });

  it("drops partial seconds", () => {
    expect(formatClock(59_999)).toBe("00:59");
  });
});

describe("formatMinutes", () => {
  it("keeps whole numbers short and shows one decimal otherwise", () => {
    expect(formatMinutes(5)).toBe("5");
    expect(formatMinutes(6.7)).toBe("6.7");
    expect(formatMinutes(13.333)).toBe("13.3");
  });
});

describe("dates", () => {
  it("formats an ISO date", () => {
    expect(formatDate("2026-10-30T10:15:00.000Z")).toMatch(/30 Oct 2026/);
  });

  it("returns unreadable input as it came", () => {
    expect(formatDate("soon")).toBe("soon");
  });

  it("counts whole days", () => {
    const now = Date.parse("2026-10-30T12:00:00.000Z");
    expect(daysSince("2026-10-18T12:00:00.000Z", now)).toBe(12);
    expect(daysSince("2026-10-30T11:00:00.000Z", now)).toBe(0);
    expect(daysSince("nope", now)).toBeNull();
  });
});
