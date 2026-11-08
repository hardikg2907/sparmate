import { mkdir, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Loads KEY=value lines from a gitignored dotenv file in the app root. Variables already in the environment win. */
export function loadAppEnv(appRoot: string = APP_ROOT): void {
  try {
    process.loadEnvFile(join(appRoot, ".env"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/** The study folder before it is resolved: `STUDY_ROOT`, or a folder in the home directory the app can create. */
export function studyRootPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.STUDY_ROOT ? resolve(env.STUDY_ROOT) : join(homedir(), "sparmate-study");
}

export interface ServerConfig {
  port: number;
  appRoot: string;
  /** Real path of the study folder that holds TRACKER.md, REVIEW.md, TEACHING.md, notes/ and lld/. */
  studyRoot: string;
  dataDir: string;
  contentDir: string;
  webDist: string;
  excalidrawAssets: string;
  fakeAgent: boolean;
  /** How long a live round may have no open socket before it pauses; unset means the runtime's default. Only tests set it. */
  awayPauseMs?: number;
  claudeJsonPath: string;
  denylistPath: string;
  kokoroHome: string;
  version: string;
}

export function dataPaths(dataDir: string) {
  return {
    sessions: join(dataDir, "sessions"),
    customProblems: join(dataDir, "custom-problems"),
    agentCwd: join(dataDir, "runtime", "agent-cwd"),
    cppTmp: join(dataDir, "runtime", "cpp"),
    logs: join(dataDir, "logs"),
    settings: join(dataDir, "settings.json"),
    usage: join(dataDir, "usage.jsonl"),
    leetcode: join(dataDir, "leetcode.json"),
    drills: join(dataDir, "drills.json"),
  };
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 4747;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`PORT must be an integer from 1 to 65535`);
  return port;
}

function parseAwayMs(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const ms = Number(raw);
  if (!Number.isInteger(ms) || ms < 50 || ms > 600_000) throw new Error("SPARMATE_AWAY_MS must be an integer from 50 to 600000");
  return ms;
}

export async function loadConfig(env: NodeJS.ProcessEnv = process.env): Promise<ServerConfig> {
  const port = parsePort(env.PORT);
  const awayPauseMs = parseAwayMs(env.SPARMATE_AWAY_MS);
  const studyRootRaw = studyRootPath(env);
  const studyRoot = await realpath(studyRootRaw).catch(() => {
    throw new Error(`STUDY_ROOT does not exist: ${studyRootRaw}`);
  });
  const dataDirRaw = env.DATA_DIR ? resolve(env.DATA_DIR) : join(studyRoot, "rounds");
  await mkdir(dataDirRaw, { recursive: true, mode: 0o700 });
  const dataDir = await realpath(dataDirRaw);
  const paths = dataPaths(dataDir);
  for (const dir of [paths.sessions, paths.customProblems, paths.agentCwd, paths.cppTmp, paths.logs]) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
  }
  const pkg = JSON.parse(await readFile(join(APP_ROOT, "package.json"), "utf8")) as { version?: string };
  return {
    port,
    appRoot: APP_ROOT,
    studyRoot,
    dataDir,
    contentDir: join(APP_ROOT, "content"),
    webDist: join(APP_ROOT, "dist", "web"),
    excalidrawAssets: join(APP_ROOT, "node_modules", "@excalidraw", "excalidraw", "dist", "prod"),
    fakeAgent: env.SPARMATE_FAKE_AGENT === "1",
    ...(awayPauseMs === undefined ? {} : { awayPauseMs }),
    claudeJsonPath: env.SPARMATE_CLAUDE_JSON ? resolve(env.SPARMATE_CLAUDE_JSON) : join(homedir(), ".claude.json"),
    denylistPath: env.SPARMATE_DENYLIST ? resolve(env.SPARMATE_DENYLIST) : join(homedir(), ".config", "sparmate", "denylist.txt"),
    kokoroHome: env.SPARMATE_KOKORO_HOME ? resolve(env.SPARMATE_KOKORO_HOME) : join(dataDir, "kokoro"),
    version: typeof pkg.version === "string" ? pkg.version : "0.0.0",
  };
}
