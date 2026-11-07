import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attemptHeader, createAttemptFile, removeAttemptIfUntouched } from "./attempts";

let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "ir-attempts-")));
  await mkdir(join(root, "lld", "parking-lot"), { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("createAttemptFile", () => {
  it("creates the file with a one-line header and returns the path relative to the study root", async () => {
    const path = await createAttemptFile(root, "parking-lot", "Parking Lot", "2026-10-30");
    expect(path).toBe("lld/parking-lot/attempt-2026-10-30.cpp");
    expect(await readFile(join(root, path), "utf8")).toBe("// Parking Lot — 2026-10-30\n");
  });

  it("adds -2 and -3 when the file already exists, and never overwrites", async () => {
    const first = await createAttemptFile(root, "parking-lot", "Parking Lot", "2026-10-30");
    const second = await createAttemptFile(root, "parking-lot", "Parking Lot", "2026-10-30");
    const third = await createAttemptFile(root, "parking-lot", "Parking Lot", "2026-10-30");
    expect([first, second, third]).toEqual(["lld/parking-lot/attempt-2026-10-30.cpp", "lld/parking-lot/attempt-2026-10-30-2.cpp", "lld/parking-lot/attempt-2026-10-30-3.cpp"]);
  });

  it("keeps the user's own edits when the same day starts again", async () => {
    const first = await createAttemptFile(root, "parking-lot", "Parking Lot", "2026-10-30");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(root, first), "// my code\nint main() {}\n");
    await createAttemptFile(root, "parking-lot", "Parking Lot", "2026-10-30");
    expect(await readFile(join(root, first), "utf8")).toBe("// my code\nint main() {}\n");
  });

  it("gives different parallel callers different files", async () => {
    const paths = await Promise.all(Array.from({ length: 6 }, () => createAttemptFile(root, "parking-lot", "Parking Lot", "2026-10-30")));
    expect(new Set(paths).size).toBe(6);
    expect((await readdir(join(root, "lld", "parking-lot"))).sort()).toHaveLength(6);
  });

  it("creates the problem folder when it does not exist yet", async () => {
    const path = await createAttemptFile(root, "elevator-system", "Elevator System", "2026-11-02");
    expect(path).toBe("lld/elevator-system/attempt-2026-11-02.cpp");
    expect((await stat(join(root, "lld", "elevator-system"))).isDirectory()).toBe(true);
  });

  it("creates the lld folder too when the study root has none", async () => {
    const bare = await realpath(await mkdtemp(join(tmpdir(), "ir-attempts-bare-")));
    try {
      expect(await createAttemptFile(bare, "vending-machine", "Vending Machine", "2026-11-02")).toBe("lld/vending-machine/attempt-2026-11-02.cpp");
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });

  it.each(["", "../x", "a/b", "A", "-lead", "has space", "a.b", "x\0y", ".."])("rejects the folder %j", async (folder) => {
    await expect(createAttemptFile(root, folder, "T", "2026-10-30")).rejects.toThrow();
  });

  it.each(["", "2026-1-30", "20261030", "2026-10-30\n", "../../2026-10-30", "abcd-ef-gh"])("rejects the date %j", async (date) => {
    await expect(createAttemptFile(root, "parking-lot", "T", date)).rejects.toThrow();
  });

  it("flattens a title with line breaks so it cannot leave the comment", async () => {
    const path = await createAttemptFile(root, "parking-lot", "Parking\nLot\r\n#include <evil> int x;‮", "2026-10-30");
    const text = await readFile(join(root, path), "utf8");
    expect(text).toBe("// Parking Lot #include <evil> int x; — 2026-10-30\n");
    expect(text.split("\n")).toHaveLength(2);
  });

  it("cuts a very long title", async () => {
    const path = await createAttemptFile(root, "parking-lot", "x".repeat(500), "2026-10-30");
    const header = (await readFile(join(root, path), "utf8")).split("\n")[0]!;
    expect(header.length).toBeLessThan(150);
  });

  it("refuses to write through a symlinked folder that leaves the study root", async () => {
    const outside = await realpath(await mkdtemp(join(tmpdir(), "ir-attempts-out-")));
    try {
      await symlink(outside, join(root, "lld", "escape"));
      await expect(createAttemptFile(root, "escape", "T", "2026-10-30")).rejects.toThrow(/outside/i);
      expect(await readdir(outside)).toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("refuses to follow a symlink planted at the file name", async () => {
    const outside = await realpath(await mkdtemp(join(tmpdir(), "ir-attempts-out-")));
    try {
      await symlink(join(outside, "target.cpp"), join(root, "lld", "parking-lot", "attempt-2026-10-30.cpp"));
      await expect(createAttemptFile(root, "parking-lot", "T", "2026-10-30")).rejects.toThrow(/outside/i);
      expect(await readdir(outside)).toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("removeAttemptIfUntouched", () => {
  const exists = (path: string) =>
    stat(path).then(
      () => true,
      () => false,
    );

  it("builds the same header the file is created with", async () => {
    const path = await createAttemptFile(root, "parking-lot", "Parking Lot", "2026-10-30");
    expect(await readFile(join(root, path), "utf8")).toBe(attemptHeader("Parking Lot", "2026-10-30"));
  });

  it("deletes a file that still holds only its header", async () => {
    const path = await createAttemptFile(root, "parking-lot", "Parking Lot", "2026-10-30");
    expect(await removeAttemptIfUntouched(root, path, "Parking Lot")).toBe("removed");
    expect(await exists(join(root, path))).toBe(false);
    expect(await exists(join(root, "lld", "parking-lot"))).toBe(true);
  });

  it("finds the date of a numbered file in its name", async () => {
    await createAttemptFile(root, "parking-lot", "Parking Lot", "2026-10-30");
    const second = await createAttemptFile(root, "parking-lot", "Parking Lot", "2026-10-30");
    expect(second).toBe("lld/parking-lot/attempt-2026-10-30-2.cpp");
    expect(await removeAttemptIfUntouched(root, second, "Parking Lot")).toBe("removed");
    expect(await exists(join(root, "lld", "parking-lot", "attempt-2026-10-30.cpp"))).toBe(true);
  });

  it("keeps a file the candidate wrote code into", async () => {
    const path = await createAttemptFile(root, "parking-lot", "Parking Lot", "2026-10-30");
    const code = `${attemptHeader("Parking Lot", "2026-10-30")}int main() { return 0; }\n`;
    await writeFile(join(root, path), code);
    expect(await removeAttemptIfUntouched(root, path, "Parking Lot")).toBe("kept");
    expect(await readFile(join(root, path), "utf8")).toBe(code);
  });

  it("keeps a file whose header was changed, or that is empty", async () => {
    const path = await createAttemptFile(root, "parking-lot", "Parking Lot", "2026-10-30");
    await writeFile(join(root, path), "// Parking Lot - 2026-10-30\n");
    expect(await removeAttemptIfUntouched(root, path, "Parking Lot")).toBe("kept");
    await writeFile(join(root, path), "");
    expect(await removeAttemptIfUntouched(root, path, "Parking Lot")).toBe("kept");
    expect(await exists(join(root, path))).toBe(true);
  });

  it("keeps the file when the title does not match the one it was created with", async () => {
    const path = await createAttemptFile(root, "parking-lot", "Parking Lot", "2026-10-30");
    expect(await removeAttemptIfUntouched(root, path, "Something else")).toBe("kept");
  });

  it("treats a file that is already gone as done", async () => {
    expect(await removeAttemptIfUntouched(root, "lld/parking-lot/attempt-2026-10-30.cpp", "Parking Lot")).toBe("missing");
    expect(await removeAttemptIfUntouched(root, "lld/not-there/attempt-2026-10-30.cpp", "Parking Lot")).toBe("missing");
  });

  it.each([
    "TRACKER.md",
    "notes/x.md",
    "lld/parking-lot/other.cpp",
    "lld/../TRACKER.md",
    "/etc/passwd",
    "lld/parking-lot/attempt-2026-10-30.cpp/../../../TRACKER.md",
    "lld//attempt-2026-10-30.cpp",
  ])("refuses the path %j without touching anything", async (path) => {
    await writeFile(join(root, "TRACKER.md"), "- [ ] keep\n");
    await mkdir(join(root, "notes"), { recursive: true });
    await writeFile(join(root, "notes", "x.md"), "keep\n");
    await expect(removeAttemptIfUntouched(root, path, "T")).rejects.toThrow("Invalid attempt file path");
    expect(await readFile(join(root, "TRACKER.md"), "utf8")).toBe("- [ ] keep\n");
    expect(await readFile(join(root, "notes", "x.md"), "utf8")).toBe("keep\n");
  });

  it("never deletes through a symlink at the file name, even one pointing at a header-only file", async () => {
    const real = join(root, "lld", "parking-lot", "real.txt");
    await writeFile(real, attemptHeader("Parking Lot", "2026-10-30"));
    await symlink(real, join(root, "lld", "parking-lot", "attempt-2026-10-30.cpp"));
    expect(await removeAttemptIfUntouched(root, "lld/parking-lot/attempt-2026-10-30.cpp", "Parking Lot")).toBe("kept");
    expect(await exists(real)).toBe(true);
  });

  it("refuses a symlinked problem folder that leaves the study root", async () => {
    const outside = await realpath(await mkdtemp(join(tmpdir(), "ir-attempts-out-")));
    try {
      await writeFile(join(outside, "attempt-2026-10-30.cpp"), attemptHeader("T", "2026-10-30"));
      await symlink(outside, join(root, "lld", "escape"));
      await expect(removeAttemptIfUntouched(root, "lld/escape/attempt-2026-10-30.cpp", "T")).rejects.toThrow(/outside/i);
      expect(await exists(join(outside, "attempt-2026-10-30.cpp"))).toBe(true);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
