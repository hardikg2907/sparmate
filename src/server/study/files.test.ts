import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { atomicWrite, resolveInside, sha256 } from "./files";

let base: string;
let root: string;
let outside: string;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "ir-files-")));
  root = join(base, "root");
  outside = join(base, "outside");
  await mkdir(join(root, "notes"), { recursive: true });
  await mkdir(outside);
  await writeFile(join(root, "TRACKER.md"), "tracker\n");
  await writeFile(join(outside, "secret.txt"), "secret\n");
  await symlink(outside, join(root, "link-dir"));
  await symlink(join(outside, "secret.txt"), join(root, "notes", "link-file.md"));
  await symlink(join(outside, "does-not-exist.txt"), join(root, "notes", "dangling.md"));
  await symlink(join(root, "TRACKER.md"), join(root, "notes", "inside-link.md"));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("resolveInside", () => {
  it("returns the real path of an existing file", async () => {
    expect(await resolveInside(root, "TRACKER.md")).toBe(join(root, "TRACKER.md"));
  });

  it("returns the path of a file that does not exist yet", async () => {
    expect(await resolveInside(root, "notes/new-file.md")).toBe(join(root, "notes", "new-file.md"));
  });

  it("returns a path under folders that do not exist yet", async () => {
    expect(await resolveInside(root, "lld/parking-lot/attempt.cpp")).toBe(join(root, "lld", "parking-lot", "attempt.cpp"));
  });

  it("works when the root itself is reached through a symlink", async () => {
    const alias = join(base, "root-alias");
    await symlink(root, alias);
    expect(await resolveInside(alias, "TRACKER.md")).toBe(join(root, "TRACKER.md"));
  });

  it.each(["../outside/secret.txt", "notes/../../outside/secret.txt", "../root-sibling.md", "notes/../.."])("rejects the traversal %s", async (relative) => {
    await expect(resolveInside(root, relative)).rejects.toThrow(/outside/i);
  });

  it("rejects an absolute path, an empty path and a NUL byte", async () => {
    await expect(resolveInside(root, join(outside, "secret.txt"))).rejects.toThrow(/outside/i);
    await expect(resolveInside(root, "")).rejects.toThrow(/outside/i);
    await expect(resolveInside(root, "notes/a\0b.md")).rejects.toThrow(/outside/i);
  });

  it("rejects a symlinked folder that leads out of the root, for existing and new targets", async () => {
    await expect(resolveInside(root, "link-dir/secret.txt")).rejects.toThrow(/outside/i);
    await expect(resolveInside(root, "link-dir/new.txt")).rejects.toThrow(/outside/i);
  });

  it("rejects a symlinked file that leads out of the root", async () => {
    await expect(resolveInside(root, "notes/link-file.md")).rejects.toThrow(/outside/i);
  });

  it("rejects a dangling symlink, because a write would create the file outside", async () => {
    await expect(resolveInside(root, "notes/dangling.md")).rejects.toThrow(/outside/i);
  });

  it("accepts a symlink that stays inside the root and returns its real target", async () => {
    expect(await resolveInside(root, "notes/inside-link.md")).toBe(join(root, "TRACKER.md"));
  });

  it("rejects a root that does not exist", async () => {
    await expect(resolveInside(join(base, "nope"), "a.md")).rejects.toThrow();
  });
});

describe("atomicWrite", () => {
  it("creates a new file and replaces an existing one", async () => {
    const path = join(root, "notes", "atomic.md");
    await atomicWrite(path, "first\n");
    expect(await readFile(path, "utf8")).toBe("first\n");
    await atomicWrite(path, "second\n");
    expect(await readFile(path, "utf8")).toBe("second\n");
  });

  it("keeps the permissions of the file it replaces", async () => {
    const path = join(root, "notes", "mode.md");
    await writeFile(path, "x\n");
    await chmod(path, 0o640);
    await atomicWrite(path, "y\n");
    expect((await stat(path)).mode & 0o777).toBe(0o640);
  });

  it("leaves no temp files behind, on success or failure", async () => {
    const path = join(root, "notes", "clean.md");
    await atomicWrite(path, "ok\n");
    await expect(atomicWrite(join(root, "missing-dir", "x.md"), "no\n")).rejects.toThrow();
    const leftovers = [...(await readdir(join(root, "notes"))), ...(await readdir(root))].filter((name) => name.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("writes UTF-8 and keeps the content byte for byte", async () => {
    const path = join(root, "notes", "utf8.md");
    const text = "café → — \u{1F600}\n\nlast line without newline";
    await atomicWrite(path, text);
    expect(await readFile(path, "utf8")).toBe(text);
  });

  it("never exposes a half-written file to a reader", async () => {
    const path = join(root, "notes", "race.md");
    const big = "x".repeat(2_000_000) + "\n";
    await writeFile(path, "old\n");
    const writer = atomicWrite(path, big);
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) {
      seen.add((await readFile(path, "utf8")).length);
      await new Promise((resolve) => setImmediate(resolve));
    }
    await writer;
    for (const size of seen) expect([4, big.length]).toContain(size);
  });
});

describe("sha256", () => {
  it("returns the lower-case hex digest of the UTF-8 text", () => {
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256("café")).toBe("850f7dc43910ff890f8879c0ed26fe697c93a067ad93a7d50f466a7028a9bf4e");
  });
});
