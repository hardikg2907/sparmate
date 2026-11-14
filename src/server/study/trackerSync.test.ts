import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Problem } from "../../shared/problem";
import type { Logger } from "../engine/log";
import { syncTrackerBullets } from "./trackerSync";

const HLD = "### C2. Classic HLD Problems";
const LLD = "### B3. Applied";

function problem(id: string, section: string | null, bullet: string, custom = false): Problem {
  return {
    meta: { id, track: "hld", title: id, difficulty: "easy", tags: [], tracker: section ? { section, bullet } : null, notesFile: `notes/${id}.md` },
    sections: {},
    body: "",
    file: `/x/${id}.md`,
    custom,
  };
}

function logger(lines: string[]): Logger {
  return { info: (m) => void lines.push(m), warn: (m) => void lines.push(m), error: (m) => void lines.push(m), addSecret: () => undefined, close: async () => undefined };
}

let root: string;
let lines: string[];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ir-sync-"));
  lines = [];
});
afterEach(() => rm(root, { recursive: true, force: true }));

const tracker = (...parts: string[]) => `${parts.join("\n")}\n`;

describe("syncTrackerBullets", () => {
  it("appends missing bullets in problem order, after the last bullet and its sub-bullets", async () => {
    const before = tracker(
      "# Tracker",
      "",
      HLD,
      "- [x] URL Shortener → notes/a.md · 2026-10-01",
      "- [~] Chat",
      "  - [ ] sub one",
      "  - [x] sub two",
      "",
      "### Next",
      "- [ ] Other",
    );
    await writeFile(join(root, "TRACKER.md"), before);
    const out = await syncTrackerBullets(root, [problem("a", HLD, "URL Shortener"), problem("b", HLD, "Rate Limiter"), problem("c", HLD, "News Feed")], logger(lines));
    expect(out.added).toBe(2);
    expect(await readFile(join(root, "TRACKER.md"), "utf8")).toBe(
      tracker(
        "# Tracker",
        "",
        HLD,
        "- [x] URL Shortener → notes/a.md · 2026-10-01",
        "- [~] Chat",
        "  - [ ] sub one",
        "  - [x] sub two",
        "- [ ] Rate Limiter",
        "- [ ] News Feed",
        "",
        "### Next",
        "- [ ] Other",
      ),
    );
  });

  it("does not write when nothing is missing, and counts an arrow suffix as present", async () => {
    await writeFile(join(root, "TRACKER.md"), tracker(HLD, "- [x] URL Shortener → notes/a.md · 2026-10-01"));
    const path = join(root, "TRACKER.md");
    const first = await stat(path);
    await new Promise((r) => setTimeout(r, 20));
    const out = await syncTrackerBullets(root, [problem("a", HLD, "URL Shortener"), problem("x", null, "ignored", true)], logger(lines));
    expect(out.added).toBe(0);
    const second = await stat(path);
    expect(second.mtimeMs).toBe(first.mtimeMs);
    expect(second.ino).toBe(first.ino);
    expect(lines).toEqual([]);
  });

  it("skips a problem whose section is missing", async () => {
    const before = tracker(HLD, "- [ ] Chat");
    await writeFile(join(root, "TRACKER.md"), before);
    const out = await syncTrackerBullets(root, [problem("a", LLD, "Parking Lot")], logger(lines));
    expect(out.added).toBe(0);
    expect(await readFile(join(root, "TRACKER.md"), "utf8")).toBe(before);
    expect(lines).toHaveLength(1);
  });

  it("skips an ambiguous bullet", async () => {
    const before = tracker(HLD, "- [ ] Chat", "- [x] Chat");
    await writeFile(join(root, "TRACKER.md"), before);
    const out = await syncTrackerBullets(root, [problem("a", HLD, "Chat")], logger(lines));
    expect(out.added).toBe(0);
    expect(await readFile(join(root, "TRACKER.md"), "utf8")).toBe(before);
    expect(lines).toHaveLength(1);
  });

  it("does nothing when the tracker does not exist", async () => {
    expect(await syncTrackerBullets(root, [problem("a", HLD, "Chat")], logger(lines))).toEqual({ added: 0 });
    await expect(stat(join(root, "TRACKER.md"))).rejects.toThrow();
  });

  it("leaves custom problems out", async () => {
    const before = tracker(HLD, "- [ ] Chat");
    await writeFile(join(root, "TRACKER.md"), before);
    expect((await syncTrackerBullets(root, [problem("c", HLD, "Mine", true)], logger(lines))).added).toBe(0);
  });
});
