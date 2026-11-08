import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { memoryLogger } from "../engine/log";
import { emptySnapshot, loadSnapshot, saveSnapshot, type Snapshot } from "./snapshot";
import { EASY } from "./support";

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "leetcode-snapshot-"));
  file = join(dir, "leetcode.json");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const valid: Snapshot = {
  version: 1,
  problems: { "two-sum": EASY },
  account: {
    username: "example_user",
    fetchedAt: "2026-11-08T08:10:00.000Z",
    lifetime: { all: 10, easy: 5, medium: 4, hard: 1 },
    entries: [{ title: "Two Sum", slug: "two-sum", timestamp: 1762500000 }],
  },
};

describe("loadSnapshot", () => {
  it("gives an empty snapshot when the file is missing", async () => {
    const log = memoryLogger();
    expect(await loadSnapshot(file, log)).toEqual(emptySnapshot());
    expect(log.lines).toEqual([]);
  });

  it("ignores a corrupt file and says so", async () => {
    await writeFile(file, "{not json");
    const log = memoryLogger();
    expect(await loadSnapshot(file, log)).toEqual(emptySnapshot());
    expect(log.lines.some((l) => l.startsWith("WARN"))).toBe(true);
  });

  it("ignores a file that has the wrong shape", async () => {
    await writeFile(file, JSON.stringify({ ...valid, extra: true }));
    expect(await loadSnapshot(file, memoryLogger())).toEqual(emptySnapshot());
    await writeFile(file, JSON.stringify({ ...valid, problems: { "two-sum": { difficulty: "Trivial", topics: [] } } }));
    expect(await loadSnapshot(file, memoryLogger())).toEqual(emptySnapshot());
  });

  it("reads back what was saved", async () => {
    await saveSnapshot(file, valid);
    expect(await loadSnapshot(file, memoryLogger())).toEqual(valid);
  });
});
