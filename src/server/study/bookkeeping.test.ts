import { writeFileSync } from "node:fs";
import { mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ClientMsgSchema, LIMITS } from "../../shared/protocol";
import { type BookkeepingOp, type Proposal, ScribeOutputSchema } from "../../shared/types";
import { type PrivacyGuard, loadPrivacyGuard } from "../guard/privacy";
import { NOTES_FILE, type TempStudyRoot, makeCustomRoot, makeStudyRoot, snapshotText } from "./__fixtures__/studyRoot";
import { applyProposal, planProposal } from "./bookkeeping";
import { sha256 } from "./files";
import { findBullet, findTable } from "./tracker";

const C2 = "### C2. Classic HLD Problems";
const A4 = "### A4. Databases";

let ctx: TempStudyRoot;
let guard: PrivacyGuard;
let guardDir: string;
let frozenHashes: Record<string, string>;

const FROZEN_FILES = ["TRACKER.md", "REVIEW.md", "notes/_TEMPLATE.md", NOTES_FILE];
const hashFrozen = (): Record<string, string> => Object.fromEntries(FROZEN_FILES.map((f) => [f, sha256(snapshotText(f))]));

async function makeGuard(terms: string[]): Promise<PrivacyGuard> {
  const denylistPath = join(guardDir, `deny-${Math.random().toString(36).slice(2)}.txt`);
  await writeFile(denylistPath, terms.join("\n"));
  return loadPrivacyGuard({ claudeJsonPath: join(guardDir, "none.json"), denylistPath });
}

beforeAll(async () => {
  frozenHashes = hashFrozen();
  guardDir = await mkdtemp(join(tmpdir(), "ir-bk-guard-"));
  guard = await makeGuard(["acme"]);
});
afterAll(async () => {
  // The tests edit temp copies, never the frozen files.
  expect(hashFrozen()).toEqual(frozenHashes);
  await rm(guardDir, { recursive: true, force: true });
});
beforeEach(async () => {
  ctx = await makeStudyRoot();
});
afterEach(async () => {
  await ctx.cleanup();
});

const plan = (ops: BookkeepingOp[], g: PrivacyGuard = guard): Promise<Proposal> => planProposal(ctx.root, "session-1", ops, g);

const lines = (text: string): string[] => text.split("\n");

function expectReplacedLine(before: string, after: string, index: number, expected: string): void {
  const b = lines(before);
  const a = lines(after);
  expect(a).toHaveLength(b.length);
  expect(a[index]).toBe(expected);
  expect(a.filter((_, i) => i !== index)).toEqual(b.filter((_, i) => i !== index));
}

function expectInserted(before: string, after: string, index: number, inserted: string[]): void {
  const b = lines(before);
  const a = lines(after);
  expect(a.slice(index, index + inserted.length)).toEqual(inserted);
  expect([...a.slice(0, index), ...a.slice(index + inserted.length)]).toEqual(b);
}

const updateOp = (extra: Partial<Extract<BookkeepingOp, { kind: "tracker_update_bullet" }>> = {}): BookkeepingOp => ({
  kind: "tracker_update_bullet",
  section: C2,
  bullet: "URL Shortener",
  mark: "[~]",
  appendSuffix: "→ notes/c2-url-shortener.md · 2026-10-30",
  ...extra,
});

describe("tracker_update_bullet", () => {
  it("changes the mark and appends the notes link to exactly one line", async () => {
    const before = await ctx.read("TRACKER.md");
    const index = findBullet(before, C2, "URL Shortener")!.lineIndex;
    const proposal = await plan([updateOp()]);

    expect(proposal.status).toBe("draft");
    expect(proposal.ops).toHaveLength(1);
    expect(proposal.ops[0]).toMatchObject({ id: "op-1", file: "TRACKER.md", blocked: null });
    expect(proposal.baseHashes).toEqual({ "TRACKER.md": sha256(before) });
    expect(await ctx.read("TRACKER.md")).toBe(before);

    const result = await applyProposal(ctx.root, proposal, ["op-1"], guard);
    expect(result).toMatchObject({ applied: ["op-1"], failed: [] });
    expect(result.proposal.status).toBe("applied");
    expectReplacedLine(before, await ctx.read("TRACKER.md"), index, "- [~] URL Shortener → notes/c2-url-shortener.md · 2026-10-30");
  });

  it("adds the arrow when the suffix does not start with one", async () => {
    const before = await ctx.read("TRACKER.md");
    const index = findBullet(before, C2, "URL Shortener")!.lineIndex;
    const proposal = await plan([updateOp({ appendSuffix: "notes/c2-url-shortener.md · 2026-10-30" })]);
    await applyProposal(ctx.root, proposal, ["op-1"], guard);
    expectReplacedLine(before, await ctx.read("TRACKER.md"), index, "- [~] URL Shortener → notes/c2-url-shortener.md · 2026-10-30");
  });

  it("joins a second link to an existing suffix with a middle dot, with or without an arrow in the new text", async () => {
    const before = await ctx.read("TRACKER.md");
    const index = findBullet(before, C2, "Rate Limiter")!.lineIndex;
    const original = "- [~] Rate Limiter → notes/c2-rate-limiter.md · 2026-10-24";
    expect(lines(before)[index]).toBe(original);

    for (const suffix of ["notes/c2-rate-limiter.md · 2026-11-02", "→ notes/c2-rate-limiter.md · 2026-11-02"]) {
      const proposal = await plan([updateOp({ bullet: "Rate Limiter", mark: undefined, appendSuffix: suffix })]);
      const result = await applyProposal(ctx.root, proposal, ["op-1"], guard);
      expect(result.failed).toEqual([]);
      expectReplacedLine(before, await ctx.read("TRACKER.md"), index, `${original} · notes/c2-rate-limiter.md · 2026-11-02`);
      await ctx.write("TRACKER.md", before);
    }
  });

  it("changes only the mark when no suffix is given and keeps the suffix", async () => {
    const before = await ctx.read("TRACKER.md");
    const index = findBullet(before, C2, "Rate Limiter")!.lineIndex;
    const proposal = await plan([updateOp({ bullet: "Rate Limiter", mark: "[x]", appendSuffix: undefined })]);
    await applyProposal(ctx.root, proposal, ["op-1"], guard);
    expectReplacedLine(before, await ctx.read("TRACKER.md"), index, "- [x] Rate Limiter → notes/c2-rate-limiter.md · 2026-10-24");
  });

  it("turns a multi-line suffix into one line", async () => {
    const before = await ctx.read("TRACKER.md");
    const index = findBullet(before, C2, "URL Shortener")!.lineIndex;
    const proposal = await plan([updateOp({ mark: undefined, appendSuffix: "notes/x.md\n· 2026-10-30\n" })]);
    await applyProposal(ctx.root, proposal, ["op-1"], guard);
    expectReplacedLine(before, await ctx.read("TRACKER.md"), index, "- [ ] URL Shortener → notes/x.md · 2026-10-30");
  });

  it.each([
    ["the bullet is not in the section", { bullet: "Parking Lot" }, /bullet was not found/i],
    ["the section does not exist", { section: "### Z9. Nothing" }, /section was not found/i],
    ["the section has no hashes", { section: "C2. Classic HLD Problems" }, /section was not found/i],
    ["only part of the bullet text is given", { bullet: "URL" }, /bullet was not found/i],
    ["nothing would change", { mark: "[ ]", appendSuffix: undefined }, /nothing would change/i],
  ] as const)("blocks the op when %s", async (_name, extra, reason) => {
    const proposal = await plan([updateOp(extra)]);
    expect(proposal.ops[0]!.blocked).toMatch(reason);
    expect(proposal.diffs).toEqual([]);
    const result = await applyProposal(ctx.root, proposal, ["op-1"], guard);
    expect(result.applied).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.proposal.status).toBe("draft");
  });

  it("blocks the op when two bullets in the section share the text", async () => {
    const custom = await makeCustomRoot({ "TRACKER.md": "### S. Section\n- [ ] Same\n- [x] Same → notes/a.md\n" });
    try {
      const proposal = await planProposal(custom.root, "s", [updateOp({ section: "### S.", bullet: "Same" })], guard);
      expect(proposal.ops[0]!.blocked).toMatch(/more than one/i);
    } finally {
      await custom.cleanup();
    }
  });
});

describe("a bullet that already ends with a bare arrow", () => {
  it.each(["notes/x.md · 2026-10-30", "→ notes/x.md · 2026-10-30"])("writes one arrow when the suffix is %j", async (appendSuffix) => {
    const custom = await makeCustomRoot({ "TRACKER.md": "### S. Section\n- [ ] Foo →\n- [ ] Bar\n" });
    try {
      const proposal = await planProposal(custom.root, "s", [updateOp({ section: "### S.", bullet: "Foo", mark: "[~]", appendSuffix })], guard);
      expect(proposal.ops[0]!.blocked).toBeNull();
      await applyProposal(custom.root, proposal, ["op-1"], guard);
      expect(await custom.read("TRACKER.md")).toBe("### S. Section\n- [~] Foo → notes/x.md · 2026-10-30\n- [ ] Bar\n");
    } finally {
      await custom.cleanup();
    }
  });
});

describe("tracker_add_subbullet", () => {
  const subOp = (extra: Partial<Extract<BookkeepingOp, { kind: "tracker_add_subbullet" }>> = {}): BookkeepingOp => ({
    kind: "tracker_add_subbullet",
    section: C2,
    parentBullet: "URL Shortener",
    text: "Custom aliases — collisions with generated codes, reserved words",
    ...extra,
  });

  it("inserts the sub-bullet right below a parent that has none, with the added tag", async () => {
    const before = await ctx.read("TRACKER.md");
    const parent = findBullet(before, C2, "URL Shortener")!;
    const proposal = await plan([subOp()]);
    const result = await applyProposal(ctx.root, proposal, ["op-1"], guard);
    expect(result.failed).toEqual([]);
    expectInserted(before, await ctx.read("TRACKER.md"), parent.lineIndex + 1, ["  - [ ] Custom aliases — collisions with generated codes, reserved words (added)"]);
  });

  it("does not double the added tag", async () => {
    const before = await ctx.read("TRACKER.md");
    const parent = findBullet(before, C2, "URL Shortener")!;
    const proposal = await plan([subOp({ text: "Custom aliases (added)" })]);
    await applyProposal(ctx.root, proposal, ["op-1"], guard);
    expectInserted(before, await ctx.read("TRACKER.md"), parent.lineIndex + 1, ["  - [ ] Custom aliases (added)"]);
  });

  it("inserts after the last existing sub-bullet", async () => {
    const before = await ctx.read("TRACKER.md");
    const parent = findBullet(before, A4, "Replication — leader-follower, multi-leader, leaderless")!;
    const proposal = await plan([subOp({ section: A4, parentBullet: "Replication — leader-follower, multi-leader, leaderless", text: "Chain replication" })]);
    await applyProposal(ctx.root, proposal, ["op-1"], guard);
    expectInserted(before, await ctx.read("TRACKER.md"), parent.lineIndex + 8, ["  - [ ] Chain replication (added)"]);
    const after = lines(await ctx.read("TRACKER.md"));
    expect(after[parent.lineIndex + 7]).toContain("Deletes in leaderless");
    expect(after[parent.lineIndex + 9]).toMatch(/^- \[x\] Read replicas/);
  });

  it("blocks a sub-bullet whose text already exists under the parent, even without the tag", async () => {
    const proposal = await plan([
      subOp({
        section: A4,
        parentBullet: "Query optimization basics (N+1, denormalization tradeoffs)",
        text: "Why a query ignores an index — a function on the column, such as `lower(email)`, needs an expression index",
      }),
    ]);
    expect(proposal.ops[0]!.blocked).toMatch(/already exists/i);
  });

  it("blocks the second of two identical sub-bullets in one draft", async () => {
    const proposal = await plan([subOp(), subOp()]);
    expect(proposal.ops.map((o) => o.blocked === null)).toEqual([true, false]);
  });

  it("blocks a missing parent and a missing section", async () => {
    expect((await plan([subOp({ parentBullet: "Nope" })])).ops[0]!.blocked).toMatch(/parent bullet was not found/i);
    expect((await plan([subOp({ section: "### Z9. Nothing" })])).ops[0]!.blocked).toMatch(/section was not found/i);
  });
});

describe("table rows", () => {
  it("appends a Session Log row as the last row and keeps everything before it byte for byte", async () => {
    const before = await ctx.read("TRACKER.md");
    const proposal = await plan([
      {
        kind: "tracker_append_session_log_row",
        date: "2026-10-30",
        topics: "**C2 URL Shortener**, timed",
        outcome: "`[~]` — base62 or hash | counter was the open question",
        notesFile: "notes/c2-url-shortener.md",
      },
    ]);
    await applyProposal(ctx.root, proposal, ["op-1"], guard);
    const after = await ctx.read("TRACKER.md");
    expect(after.startsWith(before)).toBe(true);
    expect(after).toBe(`${before}| 2026-10-30 | **C2 URL Shortener**, timed | \`[~]\` — base62 or hash \\| counter was the open question | notes/c2-url-shortener.md |\n`);
  });

  it("does not escape a pipe that is already escaped, and flattens line breaks", async () => {
    const before = await ctx.read("TRACKER.md");
    const proposal = await plan([{ kind: "tracker_append_session_log_row", date: "2026-10-30", topics: "first\nsecond \\| kept", outcome: "line one\n\nline two", notesFile: "" }]);
    await applyProposal(ctx.root, proposal, ["op-1"], guard);
    expect(await ctx.read("TRACKER.md")).toBe(`${before}| 2026-10-30 | first second \\| kept | line one line two | — |\n`);
  });

  it("appends a Gaps row after the last gap row, before the separator", async () => {
    const before = await ctx.read("TRACKER.md");
    const table = findTable(before, "# Gaps Found & Filled")!;
    const proposal = await plan([
      { kind: "tracker_append_gap_row", date: "2026-10-30", gap: "Base62 encoding needs 7 characters for 3.5 trillion codes", cameUpWhile: "URL length maths", filled: "Yes" },
    ]);
    await applyProposal(ctx.root, proposal, ["op-1"], guard);
    const after = await ctx.read("TRACKER.md");
    expectInserted(before, after, table.lastRowIndex + 1, ["| 2026-10-30 | Base62 encoding needs 7 characters for 3.5 trillion codes | URL length maths | Yes |"]);
    expect(lines(after)[table.lastRowIndex + 2]).toBe("");
    expect(lines(after)[table.lastRowIndex + 3]).toBe("---");
  });

  it("blocks a row when the table is missing", async () => {
    const custom = await makeCustomRoot({ "TRACKER.md": "# Nothing here\n" });
    try {
      const proposal = await planProposal(
        custom.root,
        "s",
        [
          { kind: "tracker_append_session_log_row", date: "2026-10-30", topics: "abc", outcome: "abc", notesFile: "" },
          { kind: "tracker_append_gap_row", date: "2026-10-30", gap: "abc", cameUpWhile: "abc", filled: "Yes" },
        ],
        guard,
      );
      expect(proposal.ops.map((o) => o.blocked)).toEqual([
        expect.stringMatching(/Session Log table was not found/),
        expect.stringMatching(/Gaps Found & Filled table was not found/),
      ]);
    } finally {
      await custom.cleanup();
    }
  });

  it("keeps a missing trailing newline missing and a present one present", async () => {
    const withNewline = await makeCustomRoot({ "TRACKER.md": "# Session Log\n\n| A | B | C | D |\n|---|---|---|---|\n| 1 | 2 | 3 | 4 |\n" });
    const without = await makeCustomRoot({ "TRACKER.md": "# Session Log\n\n| A | B | C | D |\n|---|---|---|---|\n| 1 | 2 | 3 | 4 |" });
    const op: BookkeepingOp = { kind: "tracker_append_session_log_row", date: "2026-10-30", topics: "abc", outcome: "def", notesFile: "x" };
    try {
      for (const [custom, ending] of [
        [withNewline, "\n"],
        [without, ""],
      ] as const) {
        const proposal = await planProposal(custom.root, "s", [op], guard);
        await applyProposal(custom.root, proposal, ["op-1"], guard);
        expect(await custom.read("TRACKER.md")).toBe(`# Session Log\n\n| A | B | C | D |\n|---|---|---|---|\n| 1 | 2 | 3 | 4 |\n| 2026-10-30 | abc | def | x |${ending}`);
      }
    } finally {
      await withNewline.cleanup();
      await without.cleanup();
    }
  });
});

describe("review_append_entry", () => {
  const entry =
    '## C2 — URL Shortener · taught 2026-10-30\n1. Explain to a junior: why is a counter not enough?\n2. Finish it: "I\'d pick hashing over a counter when ___."\n3. Transfer: custom aliases.\n\nResult: not yet asked.';

  it("appends after a separator, the way existing entries are separated", async () => {
    const before = await ctx.read("REVIEW.md");
    const proposal = await plan([{ kind: "review_append_entry", markdown: entry }]);
    expect(proposal.ops[0]).toMatchObject({ file: "REVIEW.md", blocked: null });
    await applyProposal(ctx.root, proposal, ["op-1"], guard);
    const after = await ctx.read("REVIEW.md");
    expect(after.startsWith(before)).toBe(true);
    expect(after).toBe(`${before}\n---\n\n${entry}\n`);
    expect(await ctx.read("TRACKER.md")).toBe(snapshotText("TRACKER.md"));
  });

  it("does not add a second separator when the file already ends with one", async () => {
    const custom = await makeCustomRoot({ "REVIEW.md": "# Review\n\n---\n\n" });
    try {
      const proposal = await planProposal(custom.root, "s", [{ kind: "review_append_entry", markdown: `\n\n${entry}\n\n\n` }], guard);
      await applyProposal(custom.root, proposal, ["op-1"], guard);
      expect(await custom.read("REVIEW.md")).toBe(`# Review\n\n---\n\n${entry}\n`);
    } finally {
      await custom.cleanup();
    }
  });

  it("adds the missing newline when the file does not end with one", async () => {
    const custom = await makeCustomRoot({ "REVIEW.md": "# Review\n\nlast line" });
    try {
      const proposal = await planProposal(custom.root, "s", [{ kind: "review_append_entry", markdown: entry }], guard);
      await applyProposal(custom.root, proposal, ["op-1"], guard);
      expect(await custom.read("REVIEW.md")).toBe(`# Review\n\nlast line\n\n---\n\n${entry}\n`);
    } finally {
      await custom.cleanup();
    }
  });
});

describe("notes_create and notes_append", () => {
  const createOp = (extra: Partial<Extract<BookkeepingOp, { kind: "notes_create" }>> = {}): BookkeepingOp => ({
    kind: "notes_create",
    path: "notes/c2-url-shortener.md",
    content: snapshotText("notes/_TEMPLATE.md").replace("<Topic ID> — <Topic name>", "C2 — URL Shortener"),
    ...extra,
  });

  it("creates the notes file, ends it with one newline and shows a diff against /dev/null", async () => {
    const op = createOp();
    const proposal = await plan([op]);
    expect(proposal.ops[0]).toMatchObject({ file: "notes/c2-url-shortener.md", blocked: null });
    expect(proposal.baseHashes["notes/c2-url-shortener.md"]).toBeNull();
    expect(proposal.diffs).toHaveLength(1);
    expect(proposal.diffs[0]!.file).toBe("notes/c2-url-shortener.md");
    expect(proposal.diffs[0]!.diff.startsWith("--- /dev/null\n+++ b/notes/c2-url-shortener.md\n@@")).toBe(true);

    const result = await applyProposal(ctx.root, proposal, ["op-1"], guard);
    expect(result).toMatchObject({ applied: ["op-1"], failed: [] });
    const written = await ctx.read("notes/c2-url-shortener.md");
    expect(written.endsWith("\n")).toBe(true);
    expect(written.endsWith("\n\n")).toBe(false);
    expect(written).toBe(`${(op as { content: string }).content.trimEnd()}\n`);
  });

  it("blocks creating a file that exists", async () => {
    const proposal = await plan([createOp({ path: NOTES_FILE })]);
    expect(proposal.ops[0]!.blocked).toMatch(/already exists/i);
    expect(proposal.diffs).toEqual([]);
    expect(proposal.baseHashes[NOTES_FILE]).toBe(sha256(await ctx.read(NOTES_FILE)));
  });

  it.each(["notes/_TEMPLATE.md", "notes/../TRACKER.md", "TRACKER.md", "notes/Upper.md", "notes/a/b.md", "/etc/passwd", "notes/x.md/../../y.md", "notes/x.txt"])(
    "blocks the path %s as invalid and writes nothing",
    async (path) => {
      const proposal = await plan([createOp({ path })]);
      expect(proposal.ops[0]!.blocked).toMatch(/not valid/i);
      const result = await applyProposal(ctx.root, proposal, ["op-1"], guard);
      expect(result.applied).toEqual([]);
      expect((await readdir(join(ctx.root, "notes"))).sort()).toEqual(["_TEMPLATE.md", "b3-parking-lot.md"]);
    },
  );

  it("appends after a blank line and keeps the existing file byte for byte", async () => {
    const before = await ctx.read(NOTES_FILE);
    const content = "## Redo — 2026-11-05\nSecond attempt, cold.";
    const proposal = await plan([{ kind: "notes_append", path: NOTES_FILE, content }]);
    expect(proposal.ops[0]!.blocked).toBeNull();
    await applyProposal(ctx.root, proposal, ["op-1"], guard);
    const after = await ctx.read(NOTES_FILE);
    expect(after.startsWith(before)).toBe(true);
    expect(after).toBe(`${before}\n${content}\n`);
  });

  it("adds the missing separator when the file has no trailing newline", async () => {
    const custom = await makeCustomRoot({ "TRACKER.md": "x\n", "notes/n.md": "no newline at the end" });
    try {
      const proposal = await planProposal(custom.root, "s", [{ kind: "notes_append", path: "notes/n.md", content: "appended text here" }], guard);
      await applyProposal(custom.root, proposal, ["op-1"], guard);
      expect(await custom.read("notes/n.md")).toBe("no newline at the end\n\nappended text here\n");
    } finally {
      await custom.cleanup();
    }
  });

  it("blocks appending to a file that does not exist", async () => {
    const proposal = await plan([{ kind: "notes_append", path: "notes/c2-missing.md", content: "text to append here" }]);
    expect(proposal.ops[0]!.blocked).toMatch(/does not exist/i);
  });

  it("lets a later op in the same draft build on a file an earlier op creates", async () => {
    const proposal = await plan([createOp(), { kind: "notes_append", path: "notes/c2-url-shortener.md", content: "## Extra\nmore text to add" }]);
    expect(proposal.ops.map((o) => o.blocked)).toEqual([null, null]);
    await applyProposal(ctx.root, proposal, ["op-1", "op-2"], guard);
    const written = await ctx.read("notes/c2-url-shortener.md");
    expect(written.endsWith("\n\n## Extra\nmore text to add\n")).toBe(true);
  });

  it("fails the append when only the append is chosen and the file still does not exist", async () => {
    const proposal = await plan([createOp(), { kind: "notes_append", path: "notes/c2-url-shortener.md", content: "## Extra\nmore text to add" }]);
    const result = await applyProposal(ctx.root, proposal, ["op-2"], guard);
    expect(result.applied).toEqual([]);
    expect(result.failed).toEqual([{ opId: "op-2", reason: expect.stringMatching(/does not exist/i) }]);
  });

  it("creates the notes folder when it is missing", async () => {
    const custom = await makeCustomRoot({ "TRACKER.md": "x\n" });
    try {
      await rm(join(custom.root, "notes"), { recursive: true });
      const proposal = await planProposal(custom.root, "s", [createOp()], guard);
      const result = await applyProposal(custom.root, proposal, ["op-1"], guard);
      expect(result.applied).toEqual(["op-1"]);
      expect(await custom.read("notes/c2-url-shortener.md")).toContain("C2 — URL Shortener");
    } finally {
      await custom.cleanup();
    }
  });

  it("blocks a notes path that leaves the study root through a symlinked folder", async () => {
    const outside = await mkdtemp(join(tmpdir(), "ir-bk-out-"));
    const custom = await makeCustomRoot({ "TRACKER.md": "x\n" });
    try {
      await rm(join(custom.root, "notes"), { recursive: true });
      await symlink(outside, join(custom.root, "notes"));
      const proposal = await planProposal(custom.root, "s", [createOp()], guard);
      expect(proposal.ops[0]!.blocked).toMatch(/outside the study folder/i);
      await applyProposal(custom.root, proposal, ["op-1"], guard);
      expect(await readdir(outside)).toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
      await custom.cleanup();
    }
  });
});

describe("missing target files", () => {
  it("blocks tracker and review ops when the files are missing", async () => {
    const custom = await makeCustomRoot({ "notes/n.md": "note text\n" });
    try {
      const proposal = await planProposal(custom.root, "s", [updateOp(), { kind: "review_append_entry", markdown: "## entry text here" }], guard);
      expect(proposal.ops.map((o) => o.blocked)).toEqual([expect.stringMatching(/TRACKER\.md is missing/), expect.stringMatching(/REVIEW\.md is missing/)]);
    } finally {
      await custom.cleanup();
    }
  });
});

describe("invalid operations", () => {
  it("blocks an op that does not match the schema and never applies it", async () => {
    const bad = { kind: "tracker_update_bullet", section: "### C2." } as unknown as BookkeepingOp;
    const extra = { ...updateOp(), surprise: true } as unknown as BookkeepingOp;
    const proposal = await plan([bad, extra, { kind: "nope" } as unknown as BookkeepingOp]);
    expect(proposal.ops.map((o) => o.blocked)).toEqual(Array(3).fill(expect.stringMatching(/not valid/i)));
    const result = await applyProposal(ctx.root, proposal, ["op-1", "op-2", "op-3"], guard);
    expect(result.applied).toEqual([]);
    expect(await ctx.read("TRACKER.md")).toBe(snapshotText("TRACKER.md"));
  });

  it("returns an empty draft for no ops", async () => {
    const proposal = await plan([]);
    expect(proposal).toMatchObject({ ops: [], diffs: [], baseHashes: {}, status: "draft", sessionId: "session-1" });
    expect(proposal.id).toMatch(/^[0-9a-f]{16}$/);
    expect(new Date(proposal.createdAt).toString()).not.toBe("Invalid Date");
  });
});

describe("privacy guard", () => {
  const dirty = "Acme internal notes here";

  it.each<[string, BookkeepingOp]>([
    ["tracker_update_bullet", updateOp({ appendSuffix: `→ notes/${"x"}.md · ${dirty}` })],
    ["tracker_add_subbullet", { kind: "tracker_add_subbullet", section: C2, parentBullet: "URL Shortener", text: dirty }],
    ["tracker_append_session_log_row", { kind: "tracker_append_session_log_row", date: "2026-10-30", topics: dirty, outcome: "fine", notesFile: "" }],
    ["tracker_append_gap_row", { kind: "tracker_append_gap_row", date: "2026-10-30", gap: "fine gap", cameUpWhile: dirty, filled: "Yes" }],
    ["review_append_entry", { kind: "review_append_entry", markdown: `## Entry\n${dirty}` }],
    ["notes_create", { kind: "notes_create", path: "notes/c2-x.md", content: `# Notes\n\n${dirty} and more text to pass the minimum` }],
    ["notes_append", { kind: "notes_append", path: NOTES_FILE, content: dirty }],
  ])("blocks %s when its text holds a deny-listed term, and never writes it", async (_kind, op) => {
    const proposal = await plan([op]);
    expect(proposal.ops[0]!.blocked).toMatch(/privacy deny-list/i);
    expect(proposal.diffs).toEqual([]);
    expect(JSON.stringify(proposal.ops[0]!.summary)).not.toMatch(/acme/i);
    const result = await applyProposal(ctx.root, proposal, ["op-1"], guard);
    expect(result.applied).toEqual([]);
    expect(await ctx.read("TRACKER.md")).toBe(snapshotText("TRACKER.md"));
    expect(await ctx.read(NOTES_FILE)).toBe(snapshotText(NOTES_FILE));
  });

  it("blocks a notes file whose name holds a deny-listed term, even with clean content", async () => {
    const strict = await makeGuard(["zorblax"]);
    const op: BookkeepingOp = { kind: "notes_create", path: "notes/zorblax-design.md", content: `# Notes\n\n${"A clean line of text. ".repeat(5)}` };
    const proposal = await plan([op], strict);
    expect(proposal.ops[0]!.blocked).toMatch(/privacy deny-list/i);
    expect(proposal.diffs).toEqual([]);
    expect(JSON.stringify(proposal)).not.toMatch(/zorblax/i);
    const result = await applyProposal(ctx.root, proposal, ["op-1"], strict);
    expect(result.applied).toEqual([]);
    expect(await readdir(join(ctx.root, "notes"))).not.toContain("zorblax-design.md");
  });

  it("blocks an append to a notes file whose name holds a joined deny-listed term", async () => {
    const strict = await makeGuard(["zorblax corp"]);
    const proposal = await plan([{ kind: "notes_append", path: "notes/zorblax-corp.md", content: "A clean line of text." }], strict);
    expect(proposal.ops[0]!.blocked).toMatch(/privacy deny-list/i);
    expect(JSON.stringify(proposal)).not.toMatch(/zorblax/i);
  });

  it("blocks a notes link in a session log row when the link holds a term", async () => {
    const strict = await makeGuard(["zorblax"]);
    const op: BookkeepingOp = { kind: "tracker_append_session_log_row", date: "2026-10-30", topics: "clean", outcome: "clean", notesFile: "notes/zorblax-x.md" };
    expect((await plan([op], strict)).ops[0]!.blocked).toMatch(/privacy deny-list/i);
  });

  it("blocks text that forms a term only together with the text it is appended to", async () => {
    const custom = await makeCustomRoot({ "notes/a.md": "# Notes\n\nMet the team at Zorblax" });
    try {
      const strict = await makeGuard(["zorblax corp"]);
      const proposal = await planProposal(custom.root, "s", [{ kind: "notes_append", path: "notes/a.md", content: "Corp was friendly." }], strict);
      expect(proposal.ops[0]!.blocked).toMatch(/privacy deny-list/i);
    } finally {
      await custom.cleanup();
    }
  });

  it("does not block text that only mentions a term the guard does not know", async () => {
    const proposal = await plan([{ kind: "tracker_add_subbullet", section: C2, parentBullet: "URL Shortener", text: "Perfectly ordinary sub-bullet" }]);
    expect(proposal.ops[0]!.blocked).toBeNull();
  });

  it("checks only the text an op adds, not what the file already holds", async () => {
    const strict = await makeGuard(["URL Shortener"]);
    const proposal = await plan([updateOp({ appendSuffix: "→ 2026-10-30" })], strict);
    expect(proposal.ops[0]!.blocked).toBeNull();
  });

  it("lets the other ops in the draft through", async () => {
    const proposal = await plan([
      { kind: "tracker_add_subbullet", section: C2, parentBullet: "URL Shortener", text: dirty },
      { kind: "tracker_add_subbullet", section: C2, parentBullet: "Rate Limiter", text: "A clean sub-bullet" },
    ]);
    expect(proposal.ops.map((o) => o.blocked === null)).toEqual([false, true]);
    const result = await applyProposal(ctx.root, proposal, ["op-1", "op-2"], guard);
    expect(result.applied).toEqual(["op-2"]);
    expect(result.failed).toEqual([{ opId: "op-1", reason: expect.stringMatching(/privacy deny-list/i) }]);
  });

  it("checks again when the draft is applied", async () => {
    const proposal = await plan([{ kind: "tracker_add_subbullet", section: C2, parentBullet: "URL Shortener", text: "Mentions Orbit here" }]);
    expect(proposal.ops[0]!.blocked).toBeNull();
    const stricter = await makeGuard(["orbit"]);
    const result = await applyProposal(ctx.root, proposal, ["op-1"], stricter);
    expect(result.applied).toEqual([]);
    expect(result.failed[0]!.reason).toMatch(/privacy deny-list/i);
    expect(await ctx.read("TRACKER.md")).toBe(snapshotText("TRACKER.md"));
  });
});

describe("stale drafts", () => {
  it("refuses to write when the tracker changed after the draft", async () => {
    const proposal = await plan([updateOp()]);
    const edited = `${await ctx.read("TRACKER.md")}| 2026-10-31 | edited in an editor | x | y |\n`;
    await ctx.write("TRACKER.md", edited);

    const result = await applyProposal(ctx.root, proposal, ["op-1"], guard);
    expect(result.proposal.status).toBe("stale");
    expect(result.applied).toEqual([]);
    expect(result.failed).toEqual([{ opId: "op-1", reason: "The file changed since the draft; draft again" }]);
    expect(await ctx.read("TRACKER.md")).toBe(edited);
  });

  it("is stale when a file other than the chosen ones changed", async () => {
    const proposal = await plan([updateOp(), { kind: "review_append_entry", markdown: "## Entry text here" }]);
    await ctx.write("REVIEW.md", `${await ctx.read("REVIEW.md")}extra\n`);
    const result = await applyProposal(ctx.root, proposal, ["op-1"], guard);
    expect(result.proposal.status).toBe("stale");
    expect(await ctx.read("TRACKER.md")).toBe(snapshotText("TRACKER.md"));
  });

  it("is stale when the file a create op targets appears after the draft", async () => {
    const proposal = await plan([{ kind: "notes_create", path: "notes/c2-new.md", content: "# New topic\n\nSome content that is comfortably longer than fifty characters." }]);
    await ctx.write("notes/c2-new.md", "someone made this first\n");
    const result = await applyProposal(ctx.root, proposal, ["op-1"], guard);
    expect(result.proposal.status).toBe("stale");
    expect(await ctx.read("notes/c2-new.md")).toBe("someone made this first\n");
  });

  it("is stale when a file the draft read has been deleted", async () => {
    const proposal = await plan([updateOp()]);
    await rm(join(ctx.root, "TRACKER.md"));
    const result = await applyProposal(ctx.root, proposal, ["op-1"], guard);
    expect(result.proposal.status).toBe("stale");
  });

  it("keeps a stale draft stale, and a fresh draft applies cleanly", async () => {
    const proposal = await plan([updateOp()]);
    await ctx.write("TRACKER.md", `${await ctx.read("TRACKER.md")}\n`);
    const stale = await applyProposal(ctx.root, proposal, ["op-1"], guard);
    const again = await applyProposal(ctx.root, stale.proposal, ["op-1"], guard);
    expect(again.applied).toEqual([]);
    expect(again.failed[0]!.reason).toMatch(/draft again/);

    const fresh = await plan([updateOp()]);
    const result = await applyProposal(ctx.root, fresh, ["op-1"], guard);
    expect(result.applied).toEqual(["op-1"]);
  });

  it("does not change the file when the check fails, byte for byte", async () => {
    const proposal = await plan([updateOp()]);
    const edited = (await ctx.read("TRACKER.md")).replace("# Session Log", "# Session Log ");
    await ctx.write("TRACKER.md", edited);
    await applyProposal(ctx.root, proposal, ["op-1"], guard);
    expect(sha256(await ctx.read("TRACKER.md"))).toBe(sha256(edited));
  });
});

describe("how many ops a draft may hold", () => {
  const sub = (n: number): BookkeepingOp => ({ kind: "tracker_add_subbullet", section: C2, parentBullet: "URL Shortener", text: `Gap number ${n}` });

  it("offers at most as many ops as one apply call accepts", async () => {
    const proposal = await plan(Array.from({ length: LIMITS.proposalOps + 5 }, (_, i) => sub(i)));
    expect(proposal.ops.filter((o) => o.blocked === null)).toHaveLength(LIMITS.proposalOps);
    expect(proposal.ops.at(-1)!.blocked).toMatch(/too many/i);
  });

  it("caps the scribe output at the same number", () => {
    expect(ScribeOutputSchema.safeParse({ ops: Array.from({ length: LIMITS.proposalOps }, (_, i) => sub(i)) }).success).toBe(true);
    expect(ScribeOutputSchema.safeParse({ ops: Array.from({ length: LIMITS.proposalOps + 1 }, (_, i) => sub(i)) }).success).toBe(false);
  });

  it("accepts as many ids as the cap in the apply message", () => {
    const msg = (n: number) => ClientMsgSchema.safeParse({ type: "bookkeeping.apply", proposalId: "p", opIds: Array.from({ length: n }, (_, i) => `op-${i + 1}`) });
    expect(msg(LIMITS.proposalOps).success).toBe(true);
    expect(msg(LIMITS.proposalOps + 1).success).toBe(false);
  });
});

describe("choosing ops", () => {
  const threeOps = (): BookkeepingOp[] => [
    updateOp(),
    { kind: "tracker_add_subbullet", section: C2, parentBullet: "URL Shortener", text: "Custom aliases" },
    { kind: "tracker_append_session_log_row", date: "2026-10-30", topics: "topics here", outcome: "outcome here", notesFile: "notes/c2-url-shortener.md" },
  ];

  it("applies only the ops that were chosen", async () => {
    const before = await ctx.read("TRACKER.md");
    const proposal = await plan(threeOps());
    expect(proposal.ops.map((o) => o.blocked)).toEqual([null, null, null]);
    const parent = findBullet(before, C2, "URL Shortener")!;

    const result = await applyProposal(ctx.root, proposal, ["op-2"], guard);
    expect(result).toMatchObject({ applied: ["op-2"], failed: [] });
    expectInserted(before, await ctx.read("TRACKER.md"), parent.lineIndex + 1, ["  - [ ] Custom aliases (added)"]);
  });

  it("applies every chosen op in draft order whatever order the ids arrive in", async () => {
    const proposal = await plan(threeOps());
    const result = await applyProposal(ctx.root, proposal, ["op-3", "op-1", "op-2"], guard);
    expect(result.applied.sort()).toEqual(["op-1", "op-2", "op-3"]);
    const after = lines(await ctx.read("TRACKER.md"));
    const parent = after.findIndex((l) => l.startsWith("- [~] URL Shortener"));
    expect(after[parent + 1]).toBe("  - [ ] Custom aliases (added)");
    expect(after.at(-2)).toMatch(/^\| 2026-10-30 \| topics here/);
  });

  it("writes all ops for one file in a single save and shows one diff for it", async () => {
    const proposal = await plan(threeOps());
    expect(proposal.diffs).toHaveLength(1);
    expect(proposal.diffs[0]!.file).toBe("TRACKER.md");
    // The bullet and the sub-bullet under it sit side by side, so they share a hunk; the log row is its own hunk.
    expect(proposal.diffs[0]!.diff.match(/^@@ /gm)).toHaveLength(2);
  });

  it("applies a chosen op once even when its id is repeated", async () => {
    const proposal = await plan(threeOps());
    const result = await applyProposal(ctx.root, proposal, ["op-2", "op-2"], guard);
    expect(result.applied).toEqual(["op-2"]);
    const after = await ctx.read("TRACKER.md");
    expect(after.match(/Custom aliases/g)).toHaveLength(1);
  });

  it("reports unknown ids and chosen blocked ops as failures and still applies the rest", async () => {
    const proposal = await plan([updateOp({ bullet: "Nope" }), threeOps()[1]!]);
    const result = await applyProposal(ctx.root, proposal, ["op-1", "op-2", "op-99"], guard);
    expect(result.applied).toEqual(["op-2"]);
    expect(result.failed).toEqual([
      { opId: "op-1", reason: expect.stringMatching(/bullet was not found/i) },
      { opId: "op-99", reason: "Unknown operation" },
    ]);
  });

  it("writes nothing and keeps the draft status when no chosen op can apply", async () => {
    const proposal = await plan([updateOp({ bullet: "Nope" })]);
    const none = await applyProposal(ctx.root, proposal, [], guard);
    expect(none).toMatchObject({ applied: [], failed: [] });
    expect(none.proposal.status).toBe("draft");
    expect(await ctx.read("TRACKER.md")).toBe(snapshotText("TRACKER.md"));
  });

  it("refuses to apply a saved draft a second time", async () => {
    const proposal = await plan(threeOps());
    const first = await applyProposal(ctx.root, proposal, ["op-1"], guard);
    const saved = await ctx.read("TRACKER.md");
    const second = await applyProposal(ctx.root, first.proposal, ["op-1", "op-2"], guard);
    expect(second.applied).toEqual([]);
    expect(second.failed.map((f) => f.opId)).toEqual(["op-1", "op-2"]);
    expect(await ctx.read("TRACKER.md")).toBe(saved);
  });

  it("does not change the proposal object it was given", async () => {
    const proposal = await plan(threeOps());
    const snapshot = JSON.stringify(proposal);
    await applyProposal(ctx.root, proposal, ["op-1"], guard);
    expect(JSON.stringify(proposal)).toBe(snapshot);
  });

  it("writes notes first and covers all three kinds of files in one go", async () => {
    const proposal = await plan([
      updateOp(),
      { kind: "review_append_entry", markdown: "## C2 — URL Shortener\n1. one question here" },
      { kind: "notes_create", path: "notes/c2-url-shortener.md", content: "# C2 — URL Shortener\n\nreal content for the notes file" },
    ]);
    expect(proposal.diffs.map((d) => d.file).sort()).toEqual(["REVIEW.md", "TRACKER.md", "notes/c2-url-shortener.md"]);
    const result = await applyProposal(ctx.root, proposal, ["op-1", "op-2", "op-3"], guard);
    expect(result.applied.sort()).toEqual(["op-1", "op-2", "op-3"]);
    expect(await ctx.read("notes/c2-url-shortener.md")).toContain("real content");
    expect(await ctx.read("REVIEW.md")).toContain("one question here");
  });
});

describe("how files are written", () => {
  it("leaves no temp files and keeps the trailing newline", async () => {
    const proposal = await plan([
      updateOp(),
      { kind: "review_append_entry", markdown: "## Entry\ntext" },
      { kind: "notes_append", path: NOTES_FILE, content: "appended section text" },
    ]);
    await applyProposal(ctx.root, proposal, ["op-1", "op-2", "op-3"], guard);
    for (const file of ["TRACKER.md", "REVIEW.md", NOTES_FILE]) {
      const text = await ctx.read(file);
      expect(text.endsWith("\n")).toBe(true);
      expect(text.endsWith("\n\n")).toBe(false);
    }
    expect((await readdir(ctx.root)).filter((n) => n.includes(".tmp"))).toEqual([]);
    expect((await readdir(join(ctx.root, "notes"))).filter((n) => n.includes(".tmp"))).toEqual([]);
  });

  it("does not overwrite an edit made after the files were read for the save", async () => {
    const proposal = await plan([updateOp()]);
    const path = join(ctx.root, "TRACKER.md");
    const edited = `${await ctx.read("TRACKER.md")}| 2026-10-31 | typed in an editor | x | y |\n`;
    // The guard runs after the draft's files were read and before they are written, which is exactly the window.
    let fired = false;
    const racing: PrivacyGuard = {
      findViolations: () => {
        if (!fired) {
          fired = true;
          writeFileSync(path, edited);
        }
        return [];
      },
      redact: (text) => text,
      size: () => 0,
    };
    const result = await applyProposal(ctx.root, proposal, ["op-1"], racing);
    expect(fired).toBe(true);
    expect(result.applied).toEqual([]);
    expect(result.failed).toEqual([{ opId: "op-1", reason: expect.stringMatching(/could not be saved/i) }]);
    expect(result.proposal.status).toBe("draft");
    expect(await ctx.read("TRACKER.md")).toBe(edited);
  });

  it("produces a unified diff with three lines of context", async () => {
    const proposal = await plan([updateOp()]);
    const diff = proposal.diffs[0]!.diff;
    expect(diff.startsWith("--- a/TRACKER.md\n+++ b/TRACKER.md\n@@ ")).toBe(true);
    const body = diff.split("\n").slice(3);
    expect(body.filter((l) => l.startsWith(" "))).toHaveLength(6);
    expect(body.filter((l) => l.startsWith("-"))).toEqual(["-- [ ] URL Shortener"]);
    expect(body.filter((l) => l.startsWith("+"))).toEqual(["+- [~] URL Shortener → notes/c2-url-shortener.md · 2026-10-30"]);
  });
});

describe("editing in place", () => {
  it("never touches the frozen files the temp copy came from", async () => {
    const proposal = await plan([updateOp(), { kind: "review_append_entry", markdown: "## Entry\ntext" }]);
    await applyProposal(ctx.root, proposal, ["op-1", "op-2"], guard);
    expect(hashFrozen()).toEqual(frozenHashes);
  });

  it("leaves every line it was not asked to change identical in a long file", async () => {
    const before = await ctx.read("TRACKER.md");
    const proposal = await plan([updateOp(), threeSub()]);
    await applyProposal(ctx.root, proposal, ["op-1", "op-2"], guard);
    const after = lines(await ctx.read("TRACKER.md"));
    const b = lines(before);
    expect(after).toHaveLength(b.length + 1);
    const changed = after.filter((line) => !b.includes(line));
    expect(changed).toEqual(["- [~] URL Shortener → notes/c2-url-shortener.md · 2026-10-30", "  - [ ] Hot keys (added)"]);
  });

  function threeSub(): BookkeepingOp {
    return { kind: "tracker_add_subbullet", section: C2, parentBullet: "Rate Limiter", text: "Hot keys" };
  }
});
