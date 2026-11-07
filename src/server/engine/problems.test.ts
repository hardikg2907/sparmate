import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HLD_SECTIONS, LLD_SECTIONS } from "../../shared/problem";
import { APP_ROOT } from "./config";
import { memoryLogger } from "./log";
import { loadProblems, parseProblem, ProblemFileError, splitSections } from "./problems";

const HLD_FIXTURE = join(APP_ROOT, "content", "problems", "hld", "c2-url-shortener.md");
const LLD_FIXTURE = join(APP_ROOT, "content", "problems", "lld", "b3-parking-lot.md");

describe("parseProblem on the fixtures", () => {
  it("reads the URL shortener with every HLD section", async () => {
    const p = parseProblem(await readFile(HLD_FIXTURE, "utf8"), HLD_FIXTURE, false);
    expect(p.meta.id).toBe("c2-url-shortener");
    expect(p.meta.track).toBe("hld");
    expect(p.meta.tags).toContain("caching");
    expect(p.meta.tracker).toEqual({ section: "### C2. Classic HLD Problems", bullet: "URL Shortener" });
    for (const s of HLD_SECTIONS) expect(p.sections[s], s).toBeTruthy();
    expect(p.sections["Opening prompt"]).toBe("Let's design a URL shortener, something like bit.ly. Where would you like to start?");
    // Level-three headings stay inside their section.
    expect(p.sections["Deep dives"]).toContain("### Generating unique short codes");
    expect(p.body.startsWith("## Opening prompt")).toBe(true);
  });

  it("reads the parking lot with every LLD section and its folder", async () => {
    const p = parseProblem(await readFile(LLD_FIXTURE, "utf8"), LLD_FIXTURE, false);
    expect(p.meta.id).toBe("b3-parking-lot");
    expect(p.meta.lldFolder).toBe("parking-lot");
    for (const s of LLD_SECTIONS) expect(p.sections[s], s).toBeTruthy();
    // The reference design is a fenced block; its content must not be split.
    expect(p.sections["Reference design"]).toContain("class ParkingLot {");
  });
});

describe("splitSections", () => {
  it("ignores headings inside fenced code", () => {
    const s = splitSections("## A\ntext\n```\n## not a heading\n```\n## B\nmore");
    expect(Object.keys(s)).toEqual(["A", "B"]);
    expect(s.A).toContain("## not a heading");
  });

  it("rejects a duplicated section", () => {
    expect(() => splitSections("## A\nx\n## A\ny")).toThrow(ProblemFileError);
  });
});

describe("parseProblem errors", () => {
  const head = (extra = "") =>
    `---\nid: x-test\ntrack: hld\ntitle: Test\ndifficulty: easy\ntags: []\ntracker: null\nnotesFile: notes/x-test.md\n${extra}---\n`;

  it("needs frontmatter", () => {
    expect(() => parseProblem("## Opening prompt\nhi", "f", false)).toThrow(/frontmatter/i);
  });

  it("rejects unknown frontmatter keys", () => {
    expect(() => parseProblem(head("extra: 1\n"), "f", false)).toThrow(/format/);
  });

  it("names the missing sections", () => {
    expect(() => parseProblem(`${head()}## Opening prompt\nhello\n`, "f", false)).toThrow(/Hidden facts/);
  });

  it("needs lldFolder for LLD problems", () => {
    const text = head().replace("track: hld", "track: lld") + LLD_SECTIONS.map((s) => `## ${s}\nx`).join("\n");
    expect(() => parseProblem(text, "f", false)).toThrow(/lldFolder/);
  });
});

describe("loadProblems", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("skips a broken file with a warning and keeps the rest", async () => {
    dir = await mkdtemp(join(tmpdir(), "ir-problems-"));
    await mkdir(join(dir, "hld"));
    await writeFile(join(dir, "hld", "good.md"), await readFile(HLD_FIXTURE, "utf8"));
    await writeFile(join(dir, "hld", "broken.md"), "---\nid: [\n---\n");
    const log = memoryLogger();
    const problems = await loadProblems([{ dir, custom: false, recursive: true }], log);
    expect(problems.map((p) => p.meta.id)).toEqual(["c2-url-shortener"]);
    expect(log.lines.some((l) => l.includes("broken.md"))).toBe(true);
  });

  it("drops a duplicate id from a later source", async () => {
    dir = await mkdtemp(join(tmpdir(), "ir-problems-"));
    await mkdir(join(dir, "a"));
    await mkdir(join(dir, "b"));
    const text = await readFile(HLD_FIXTURE, "utf8");
    await writeFile(join(dir, "a", "one.md"), text);
    await writeFile(join(dir, "b", "two.md"), text);
    const log = memoryLogger();
    const problems = await loadProblems(
      [
        { dir: join(dir, "a"), custom: false, recursive: false },
        { dir: join(dir, "b"), custom: true, recursive: false },
      ],
      log,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.custom).toBe(false);
  });

  it("treats a missing folder as empty", async () => {
    const problems = await loadProblems([{ dir: join(tmpdir(), "ir-does-not-exist-xyz"), custom: true, recursive: false }], memoryLogger());
    expect(problems).toEqual([]);
  });
});
