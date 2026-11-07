import { join } from "node:path";
import { loadPrivacyGuard, type PrivacyGuard } from "./guard/privacy";
import { createCppRunner, type CppRunner } from "./runner/cpp";
import { createClaudeDriver } from "./engine/claude-driver";
import { APP_ROOT, dataPaths, loadAppEnv, loadConfig, studyRootPath } from "./engine/config";
import { createFakeDriver } from "./engine/fake-driver";
import { createLogger, describeError, type Logger } from "./engine/log";
import { ProblemCatalog } from "./engine/problems";
import { PromptLoader } from "./engine/prompts";
import { SessionManager } from "./engine/sessions";
import { SettingsStore } from "./engine/settings";
import { SessionStore } from "./engine/store";
import { buildApp } from "./http/app";
import { newCsrfToken } from "./http/security";
import { KokoroManager } from "./tts/kokoro";
import { UsageLedger } from "./engine/usage-ledger";
import { wrapDriverWithLedger } from "./engine/usage-driver";
import { killLiveProcessGroups } from "./runner/process";
import { initStudyKit } from "./study/kit";

export interface ShutdownDeps {
  kokoro: { shutdown(): void };
  manager: { shutdown(): Promise<void> };
  driver: { closeAll(): void };
  app: { close(): Promise<void> };
  log: { info(msg: string): void; error(msg: string, err?: unknown): void; close(): Promise<void> };
  killRunners?: () => void;
  exit?: (code: number) => void;
  deadlineMs?: number;
}

export function createShutdownHandler(deps: ShutdownDeps): (signal: string) => Promise<void> {
  const deadlineMs = deps.deadlineMs ?? 5_000;
  const exit = deps.exit ?? ((code) => process.exit(code));
  let stopping = false;

  return async (signal: string) => {
    if (stopping) return;
    stopping = true;
    deps.log.info(`Stopping on ${signal}`);

    const forceTimer = setTimeout(() => {
      deps.log.error(`Shutdown timed out after ${deadlineMs} ms; forcing exit`);
      exit(1);
    }, deadlineMs);
    forceTimer.unref?.();

    try {
      deps.kokoro.shutdown();
      deps.killRunners?.();
      await deps.manager.shutdown();
      deps.driver.closeAll();
      await deps.app.close();
    } catch (err) {
      deps.log.error("Error while stopping", err);
    } finally {
      clearTimeout(forceTimer);
    }
    await deps.log.close();
    exit(0);
  };
}

/** Created on first use, so a broken compiler setup only affects LLD rounds and never stops the server. */
function lazyRunner(tmpRoot: string, studyRoot: string): CppRunner {
  let real: CppRunner | null = null;
  const get = () => (real ??= createCppRunner({ tmpRoot, studyRoot }));
  return {
    syntaxCheck: (path) => get().syntaxCheck(path),
    compileAndRun: (path) => get().compileAndRun(path),
    runHarness: (path, harness) => get().runHarness(path, harness),
  };
}

async function main(): Promise<void> {
  loadAppEnv();
  // Runs before the config creates the round-data folder, which may live inside the study folder and would make it non-empty.
  await initStudyKit({ studyRoot: studyRootPath(), templateDir: join(APP_ROOT, "study-kit") });
  const config = await loadConfig();
  const paths = dataPaths(config.dataDir);

  let guard: PrivacyGuard;
  try {
    guard = await loadPrivacyGuard({ claudeJsonPath: config.claudeJsonPath, denylistPath: config.denylistPath });
  } catch (err) {
    // Without the guard nothing can be checked before it is logged or written, so the server does not start.
    process.stderr.write(`Sparmate cannot start: the privacy guard did not load (${(err as Error).message}).\n`);
    process.exit(1);
  }

  const log: Logger = createLogger({ file: join(paths.logs, "server.log"), redact: (text) => guard.redact(text) });
  process.on("unhandledRejection", (err) => log.error("Unhandled rejection", err));

  const csrfToken = newCsrfToken();
  log.addSecret(csrfToken);

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
  const prompts = new PromptLoader(config.contentDir, config.studyRoot);
  const rawDriver = config.fakeAgent ? createFakeDriver() : createClaudeDriver({ cwd: paths.agentCwd, log, clientApp: `sparmate/${config.version}` });
  const usageLedger = new UsageLedger({ filePath: paths.usage, problems, log });
  const driver = wrapDriverWithLedger(rawDriver, usageLedger);
  const cppTmpRoot = process.env.SPARMATE_IN_CONTAINER === "1" ? "/tmp/runtime/cpp" : paths.cppTmp;
  const manager = new SessionManager({ config, store, settings, driver, guard, runner: lazyRunner(cppTmpRoot, config.studyRoot), prompts, log, problems });
  await manager.init();

  const kokoro = new KokoroManager({ kokoroHome: config.kokoroHome, appRoot: config.appRoot });

  const app = await buildApp({ config, csrfToken, manager, settings, store, kokoro, log, usageLedger });
  const listenHost = process.env.SPARMATE_IN_CONTAINER === "1" ? "0.0.0.0" : "127.0.0.1";
  await app.listen({ port: config.port, host: listenHost });
  log.info(`Started on port ${config.port}${config.fakeAgent ? " with the fake agent" : ""}; ${guard.size()} privacy terms loaded`);
  process.stdout.write(`Sparmate is running at http://127.0.0.1:${config.port}${config.fakeAgent ? " (fake agent)" : ""}\n`);

  const stop = createShutdownHandler({
    kokoro,
    manager,
    driver,
    app,
    log,
    killRunners: killLiveProcessGroups,
  });
  process.on("SIGINT", () => void stop("SIGINT"));
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGHUP", () => void stop("SIGHUP"));
}

main().catch((err) => {
  process.stderr.write(`Sparmate failed to start: ${describeError(err)}\n`);
  process.exit(1);
});
