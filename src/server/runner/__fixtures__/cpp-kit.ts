import { execFile, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, expect } from "vitest";
import { type CppRunner, createCppRunner } from "../cpp";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

export const fixture = (name: string): string => join(here, name);

export function readFixture(name: string): Promise<string> {
  return readFile(fixture(name), "utf8");
}

export interface RunnerFolders {
  base: string;
  tmpRoot: string;
  scratch: string;
  runner: CppRunner;
}

let folders: RunnerFolders | null = null;

/**
 * Gives a test file its own folders and runner. The C++ tests are split across files so they run in parallel; each
 * file still checks after every test that the runner removed its build folder.
 */
export function useRunnerFolders(onReady: (ready: RunnerFolders) => void): void {
  beforeAll(async () => {
    const base = await mkdtemp(join(tmpdir(), "ir-runner-"));
    const tmpRoot = join(base, "build", "cpp");
    const scratch = join(base, "sources");
    await mkdir(scratch, { recursive: true });
    folders = { base, tmpRoot, scratch, runner: createCppRunner({ tmpRoot }) };
    onReady(folders);
  });

  afterEach(async () => {
    expect(await leftovers()).toEqual([]);
  });

  afterAll(async () => {
    if (folders !== null) await rm(folders.base, { recursive: true, force: true });
    folders = null;
  });
}

async function leftovers(): Promise<string[]> {
  if (folders === null) return [];
  try {
    return await readdir(folders.tmpRoot);
  } catch {
    return [];
  }
}

export async function program(name: string, source: string): Promise<string> {
  if (folders === null) throw new Error("program() needs useRunnerFolders() in the test file");
  const path = join(folders.scratch, name);
  await writeFile(path, source);
  return path;
}

/** A killed process can stay a zombie until its new parent reaps it, but it can no longer run. */
export function stopped(pid: number): boolean {
  try {
    const state = execFileSync("ps", ["-o", "stat=", "-p", String(pid)])
      .toString()
      .trim();
    return state === "" || state.startsWith("Z");
  } catch {
    return true;
  }
}

export async function addressSanitizerRunsOnThisMachine(): Promise<boolean> {
  const dir = await mkdtemp(join(tmpdir(), "ir-asan-probe-"));
  try {
    const source = join(dir, "probe.cpp");
    await writeFile(source, '#include <cstdio>\n#include <vector>\nint main() { std::vector<int> v(4, 7); std::printf("probe ok %d\\n", v[2]); }\n');
    await run("/usr/bin/clang++", ["-std=c++17", "-g", "-fsanitize=address", "-o", join(dir, "probe"), source]);
    const { stdout } = await run(join(dir, "probe"), [], { timeout: 10_000 });
    return stdout.includes("probe ok 7");
  } catch {
    return false;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
