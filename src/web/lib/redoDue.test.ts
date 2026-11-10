import { describe, expect, it } from "vitest";
import { redoDueText, untriedText } from "./redoDue";

const NOW = new Date(2026, 10, 10, 15);

describe("redoDueText", () => {
  it("names the day an overdue redo fell due", () => {
    expect(redoDueText("2026-10-31", NOW)).toBe("Due since 31 Oct");
    expect(redoDueText("2026-11-03", NOW)).toBe("Due since 3 Nov");
  });

  it("uses the weekday for a redo that fell due within the last week", () => {
    expect(redoDueText("2026-11-09", NOW)).toBe("Due since Monday");
    expect(redoDueText("2026-11-04", NOW)).toBe("Due since Wednesday");
  });

  it("says today on the due day, whatever the hour", () => {
    expect(redoDueText("2026-11-10", NOW)).toBe("Due today");
    expect(redoDueText("2026-11-10", new Date(2026, 10, 10, 0, 1))).toBe("Due today");
  });

  it("shows a redo that is not due yet with its day", () => {
    expect(redoDueText("2026-11-14", NOW)).toBe("Due Sat 14 Nov");
  });

  it("has a plain fallback for a redo with no date", () => {
    expect(redoDueText(null, NOW)).toBe("Due now");
  });
});

describe("untriedText", () => {
  it("says where a redo with no saved round comes from", () => {
    expect(untriedText({ trackerMark: "[~]", redoDueOn: "2026-11-07" })).toBe("No round of it is saved here. Your tracker marks it partly done, last on 31 Oct.");
    expect(untriedText({ trackerMark: "[~]", redoDueOn: null })).toBe("No round of it is saved here. Your tracker marks it partly done.");
  });

  it("keeps the plain line for a problem the tracker does not mark partly done", () => {
    expect(untriedText({ trackerMark: "[ ]", redoDueOn: null })).toBe("No earlier try of this problem.");
  });
});
