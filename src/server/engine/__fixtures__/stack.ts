import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataPaths, loadConfig, type ServerConfig } from "../config";
import { createFakeDriver } from "../fake-driver";
import { memoryLogger } from "../log";
import { ProblemCatalog } from "../problems";
import type { PromptLoader } from "../prompts";
import type { Peer } from "../runtime";
import { SessionManager, type ManagerDeps } from "../sessions";
import { SettingsStore } from "../settings";
import { SessionStore } from "../store";
import type { ServerMsg } from "../../../shared/protocol";

export const PORT = 4758;

/** The study files a discard must never touch, with the text they start from. */
export const STUDY_FILES = {
  "TRACKER.md": "# Tracker\n- [ ] URL Shortener\n",
  "REVIEW.md": "# Review\n",
  "notes/c2-url-shortener.md": "# Notes\nkeep me\n",
} as const;

/** A real store, manager and config over temp folders and the fake model driver. Never touches the app's own data. */
export async function makeStack() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ir-stack-")));
  const study = join(root, "study");
  const data = join(root, "data");
  await mkdir(join(study, "notes"), { recursive: true });
  for (const [name, text] of Object.entries(STUDY_FILES)) await writeFile(join(study, name), text);
  const config: ServerConfig = await loadConfig({ PORT: String(PORT), STUDY_ROOT: study, DATA_DIR: data });
  const log = memoryLogger();
  const paths = dataPaths(config.dataDir);
  const store = new SessionStore(paths.sessions, log);
  const settings = new SettingsStore(paths.settings, log);
  await settings.load();
  const problems = new ProblemCatalog(
    [
      { dir: join(config.contentDir, "problems"), custom: false, recursive: true },
      { dir: paths.customProblems, custom: true, recursive: false },
    ],
    log,
  );
  const deps: ManagerDeps = {
    config,
    store,
    settings,
    driver: createFakeDriver({ chunkDelayMs: 0 }),
    guard: { findViolations: () => [], redact: (t: string) => t, size: () => 0 },
    runner: {
      syntaxCheck: async () => ({ ok: true, diagnostics: [], stderr: "", durationMs: 0 }),
      compileAndRun: async () => ({ compile: { ok: true, diagnostics: [], stderr: "", durationMs: 0 }, run: null }),
      runHarness: async () => ({ compile: { ok: true, diagnostics: [], stderr: "", durationMs: 0 }, run: null }),
    },
    prompts: {} as PromptLoader,
    log,
    problems,
  };
  const manager = new SessionManager(deps);
  await manager.init();
  return {
    root,
    study,
    data,
    config,
    store,
    settings,
    deps,
    manager,
    log,
    async cleanup() {
      await manager.shutdown();
      await rm(root, { recursive: true, force: true });
    },
  };
}

export type Stack = Awaited<ReturnType<typeof makeStack>>;

/** A socket stand-in that records what the server sent and whether it was closed. */
export function recordingPeer(id = "peer"): Peer & { msgs: ServerMsg[]; closed: boolean } {
  return {
    id,
    msgs: [],
    closed: false,
    send(msg) {
      this.msgs.push(msg);
    },
    close() {
      this.closed = true;
    },
  };
}
