import { describe, expect, it } from "vitest";
import { snapshotText } from "./__fixtures__/studyRoot";
import { findBullet, findTable, lastSubBulletIndex, locateBullet, readMarks, sectionText, subBulletTexts, tableTail } from "./tracker";

// A frozen copy of the real tracker is the best test data, because its headings, emoji and suffixes are what the parser must survive.
const tracker = snapshotText("TRACKER.md");
const lines = tracker.split("\n");

const C2 = "### C2. Classic HLD Problems";
const B3 = "### B3. Applied Practice — Classic LLD Problems";
const A4 = "### A4. Databases";

describe("findBullet", () => {
  it("finds an unstarted bullet by its exact text, in a heading that carries an emoji", () => {
    const match = findBullet(tracker, C2, "URL Shortener");
    expect(match).toMatchObject({ mark: "[ ]", text: "URL Shortener", suffix: null });
    expect(lines[match!.lineIndex]).toBe("- [ ] URL Shortener");
  });

  it("reads the mark and the suffix of a started bullet", () => {
    expect(findBullet(tracker, C2, "Rate Limiter")).toMatchObject({
      mark: "[~]",
      text: "Rate Limiter",
      suffix: "notes/c2-rate-limiter.md · 2026-10-24",
    });
  });

  it("splits at the first arrow when a bullet has several links", () => {
    expect(findBullet(tracker, "### B2. Design Patterns", "Behavioral: Strategy, Observer, State, Command")).toMatchObject({
      mark: "[~]",
      suffix: "notes/b3-vending-machine.md · 2026-10-19 · notes/b3-parking-lot.md · 2026-10-25",
    });
  });

  it("matches a bullet whose own text contains dashes, slashes and parentheses", () => {
    const match = findBullet(tracker, A4, "Partitioning / sharding strategies (range, hash, directory-based)");
    expect(match).toMatchObject({ mark: "[x]", suffix: "notes/a4-sharding.md · 2026-08-29" });
  });

  it("matches the section by prefix, so the emoji and status notes are optional", () => {
    expect(findBullet(tracker, "### C2.", "URL Shortener")).not.toBeNull();
    expect(findBullet(tracker, "### C2. Classic HLD Problems 🔴", "URL Shortener")).not.toBeNull();
    expect(findBullet(tracker, "### A4. Databases 🔴  ← **CURRENT**", "ACID vs BASE")).not.toBeNull();
    expect(findBullet(tracker, "### B1. Foundations", "SOLID principles — with real examples, not definitions")).not.toBeNull();
  });

  it("requires the whole bullet text, not a prefix", () => {
    expect(findBullet(tracker, C2, "URL")).toBeNull();
    expect(findBullet(tracker, C2, "URL Shortener and more")).toBeNull();
  });

  it("ignores surrounding whitespace in the wanted text", () => {
    expect(findBullet(tracker, C2, "  URL Shortener  ")).not.toBeNull();
  });

  it("returns null for a bullet that lives in another section", () => {
    expect(findBullet(tracker, C2, "Parking Lot")).toBeNull();
    expect(findBullet(tracker, B3, "Parking Lot")).not.toBeNull();
  });

  it("returns null for a missing section, a section without hashes and an empty section", () => {
    expect(findBullet(tracker, "### Z9. Nothing", "URL Shortener")).toBeNull();
    expect(findBullet(tracker, "C2. Classic HLD Problems", "URL Shortener")).toBeNull();
    expect(findBullet(tracker, "", "URL Shortener")).toBeNull();
  });

  it("does not match a sub-bullet as a top-level bullet", () => {
    expect(findBullet(tracker, A4, "Leader-follower — WAL streaming, sync vs async, failover, split brain")).toBeNull();
  });

  it("returns null when two bullets in the section have the same text", () => {
    const doc = ["### S. Section", "- [ ] Same", "- [x] Same → notes/x.md", "- [ ] Other"].join("\n");
    expect(findBullet(doc, "### S.", "Same")).toBeNull();
    expect(locateBullet(doc, "### S.", "Same").status).toBe("ambiguous");
    expect(findBullet(doc, "### S.", "Other")).not.toBeNull();
  });

  it("reports why a lookup failed", () => {
    expect(locateBullet(tracker, "### Z9.", "x").status).toBe("no_section");
    expect(locateBullet(tracker, C2, "nope").status).toBe("not_found");
    expect(locateBullet(tracker, C2, "URL Shortener").status).toBe("ok");
  });

  it("prefers an exact heading when another heading shares its prefix", () => {
    const doc = ["### C2. Classic", "- [ ] One", "", "### C2. Classic extras", "- [ ] Two"].join("\n");
    expect(findBullet(doc, "### C2. Classic", "One")).not.toBeNull();
    expect(findBullet(doc, "### C2. Classic", "Two")).toBeNull();
    expect(findBullet(doc, "### C2. Classic e", "Two")).not.toBeNull();
  });

  it("treats an ambiguous section prefix as not found", () => {
    const doc = ["### C2. First", "- [ ] One", "", "### C2. Second", "- [ ] One"].join("\n");
    expect(locateBullet(doc, "### C2.", "One").status).toBe("no_section");
  });

  it("ignores headings and bullets inside fenced code", () => {
    const doc = ["# Doc", "```", "### Fake", "- [ ] Hidden", "```", "### Real", "- [ ] Shown"].join("\n");
    expect(findBullet(doc, "### Fake", "Hidden")).toBeNull();
    expect(findBullet(doc, "### Real", "Shown")).not.toBeNull();
    expect(readMarks(doc, "### Real")).toHaveLength(1);
  });
});

describe("section boundaries", () => {
  it("ends a section at the next heading of the same level", () => {
    const a1 = readMarks(tracker, "### A1.");
    expect(a1).toHaveLength(7);
    expect(a1.at(-1)!.text).toBe("Proxies (forward vs reverse) and API Gateways");
  });

  it("ends a section at a --- line", () => {
    const b3 = readMarks(tracker, B3);
    expect(b3.map((b) => b.text)).toEqual([
      "LRU Cache (code-level)",
      "Parking Lot",
      "Vending Machine",
      "Tic-Tac-Toe / Chess",
      "Elevator System",
      "Library Management System",
      "Splitwise (expense sharing)",
      "Notification Service (class-level)",
      "Hotel/Movie Ticket Booking System",
    ]);
  });

  it("ends a section at a heading of a higher level", () => {
    const c2 = readMarks(tracker, C2);
    expect(c2.map((b) => b.text)).toEqual([
      "URL Shortener",
      "Rate Limiter",
      "Notification System",
      "Chat/Messaging System (WhatsApp)",
      "News Feed (Twitter/Instagram)",
      "Ride-Sharing (Uber)",
      "Video Streaming (YouTube/Netflix)",
      "Distributed Cache (design a Redis)",
      "Distributed Job Scheduler",
      "Payment/Transaction System",
      "Web Crawler",
      "E-commerce Checkout / Inventory",
    ]);
  });

  it("does not end a section at a deeper heading", () => {
    const doc = ["### S", "- [ ] One", "#### Deeper", "- [ ] Two", "### Next", "- [ ] Three"].join("\n");
    expect(readMarks(doc, "### S").map((b) => b.text)).toEqual(["One", "Two"]);
  });

  it("returns every top-level bullet in order and none of the sub-bullets", () => {
    const a4 = readMarks(tracker, A4);
    expect(a4.map((b) => b.mark)).toEqual(Array(a4.length).fill("[x]"));
    expect(a4.map((b) => b.text)).toContain("Replication — leader-follower, multi-leader, leaderless");
    expect(a4.some((b) => b.text.startsWith("Leader-follower"))).toBe(false);
    expect(a4.map((b) => b.lineIndex)).toEqual([...a4.map((b) => b.lineIndex)].sort((x, y) => x - y));
  });

  it("returns an empty list for an unknown section", () => {
    expect(readMarks(tracker, "### Z9. Nothing")).toEqual([]);
  });

  it("keeps the line index of each bullet pointing at its own line", () => {
    for (const bullet of readMarks(tracker, C2)) {
      expect(lines[bullet.lineIndex]).toMatch(new RegExp(`^- \\[[ ~x]\\] ${bullet.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    }
  });
});

describe("sectionText", () => {
  it("returns the heading and the bullets, without the trailing separator", () => {
    const text = sectionText(tracker, C2)!;
    expect(text.startsWith("### C2. Classic HLD Problems")).toBe(true);
    expect(text.endsWith("- [ ] E-commerce Checkout / Inventory")).toBe(true);
    expect(text).not.toContain("# References");
    expect(text.split("\n")).toHaveLength(13);
  });

  it("returns null for an unknown section", () => {
    expect(sectionText(tracker, "### Z9. Nothing")).toBeNull();
  });
});

describe("tableTail", () => {
  it("returns the header, the separator and the last rows of the Session Log", () => {
    const tail = tableTail(tracker, "# Session Log", 3)!.split("\n");
    expect(tail).toHaveLength(5);
    expect(tail[0]).toBe("| Date | Topic(s) | Outcome | Notes file |");
    expect(tail[1]).toBe("|---|---|---|---|");
    expect(tail.at(-1)!.startsWith("| 2026-10-25 | **B3 Parking Lot**")).toBe(true);
    expect(tail.at(-1)!.endsWith("| notes/b3-parking-lot.md |")).toBe(true);
    expect(tail[2]!.startsWith("| 2026-10-19 | **C2 Rate Limiter**, part 1")).toBe(true);
    expect(tail[3]!.startsWith("| 2026-10-22 to 2026-10-24 | **C2 Rate Limiter**, part 2")).toBe(true);
  });

  it("returns the Gaps table header and its last rows", () => {
    const tail = tableTail(tracker, "# Gaps Found & Filled", 3)!.split("\n");
    expect(tail[0]).toBe("| Date | Gap | Came up while | Filled? |");
    expect(tail).toHaveLength(5);
    expect(tail.at(-1)!).toContain("`enum class` values compare in declaration order");
  });

  it("returns only the header when no rows are wanted, and every row when more are wanted than exist", () => {
    expect(tableTail(tracker, "# Session Log", 0)!.split("\n")).toHaveLength(2);
    const all = tableTail(tracker, "# Session Log", 1000)!.split("\n");
    const sessionLogStart = lines.findIndex((l) => l === "# Session Log");
    const rows = lines.slice(sessionLogStart).filter((l) => l.startsWith("|"));
    expect(all).toEqual(rows);
  });

  it("returns null when the heading or the table is missing", () => {
    expect(tableTail(tracker, "# Nope", 3)).toBeNull();
    expect(tableTail("# Empty\n\nno table here\n", "# Empty", 3)).toBeNull();
  });
});

describe("findTable", () => {
  it("locates the last row of the Session Log at the end of the file", () => {
    const table = findTable(tracker, "# Session Log")!;
    expect(lines[table.lastRowIndex]).toContain("**B3 Parking Lot**");
    expect(lines[table.lastRowIndex + 1]).toBe("");
    expect(table.lastRowIndex).toBe(lines.length - 2);
  });

  it("locates the Gaps table, which is followed by a blank line and a separator", () => {
    const table = findTable(tracker, "# Gaps Found & Filled")!;
    expect(lines[table.lastRowIndex]).toContain("`enum class` values compare");
    expect(lines[table.lastRowIndex + 1]).toBe("");
    expect(lines[table.lastRowIndex + 2]).toBe("---");
  });

  it("reports a table with no rows yet", () => {
    const doc = "# T\n\n| A | B |\n|---|---|\n";
    expect(findTable(doc, "# T")).toEqual({ headerIndex: 2, lastRowIndex: 3 });
  });
});

describe("sub-bullet helpers", () => {
  it("finds the last sub-bullet under a parent with several", () => {
    const parent = findBullet(tracker, A4, "Replication — leader-follower, multi-leader, leaderless")!;
    const last = lastSubBulletIndex(lines, parent.lineIndex);
    expect(last - parent.lineIndex).toBe(7);
    expect(lines[last]).toContain("Deletes in leaderless");
    expect(lines[last + 1]).toMatch(/^- \[x\] Read replicas/);
  });

  it("returns the parent line itself when there are no sub-bullets", () => {
    const parent = findBullet(tracker, C2, "URL Shortener")!;
    expect(lastSubBulletIndex(lines, parent.lineIndex)).toBe(parent.lineIndex);
  });

  it("lists sub-bullet texts without marks, suffixes or the added tag", () => {
    const parent = findBullet(tracker, A4, "Query optimization basics (N+1, denormalization tradeoffs)")!;
    const texts = subBulletTexts(lines, parent.lineIndex);
    expect(texts).toHaveLength(3);
    expect(texts.at(-1)).toBe("Why a query ignores an index — a function on the column, such as `lower(email)`, needs an expression index");
    expect(texts[0]).toBe("Why not index every column — every index adds a write per insert, plus WAL; drop unused indexes");
  });
});
