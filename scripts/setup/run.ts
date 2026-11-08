// Phase 2 of `npm run setup`: checks the prerequisites and offers to fix what is missing.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { APP_ROOT, loadAppEnv, loadConfig, studyRootPath } from "../../src/server/engine/config";
import { initStudyKit } from "../../src/server/study/kit";
import { defaultDeps, findBundledClaude, runSetupChecks, type SetupCheck } from "../../src/server/setup/checks";
import { findQualifyingPython, installKokoro, PYTHON_INSTALL_HINT } from "../../src/server/setup/kokoro-install";

const flags = new Set(process.argv.slice(2));
const yesToAll = flags.has("--yes");
const noKokoro = flags.has("--no-kokoro");
const interactive = process.stdin.isTTY === true;

const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;

/** Asks only on a terminal. Without one, `--yes` decides and otherwise the default applies. */
async function confirm(question: string, defaultYes: boolean): Promise<boolean> {
  if (yesToAll) return true;
  if (!rl) return false;
  const answer = (await rl.question(`${question} ${defaultYes ? "[Y/n]" : "[y/N]"} `)).trim().toLowerCase();
  if (answer === "") return defaultYes;
  return answer === "y" || answer === "yes";
}

function runVisible(command: string, args: readonly string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { stdio: "inherit" });
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

function printChecks(checks: SetupCheck[]): void {
  for (const check of checks) {
    const tag = check.ok ? "ok      " : check.optional ? "optional" : "missing ";
    console.log(`  ${tag}  ${check.title}: ${check.detail}`);
  }
}

const find = (checks: SetupCheck[], id: SetupCheck["id"]) => checks.find((check) => check.id === id);

async function main(): Promise<number> {
  loadAppEnv();
  // The study folder must exist before the config creates the data folder, which may sit inside it.
  await initStudyKit({ studyRoot: studyRootPath(), templateDir: join(APP_ROOT, "study-kit") });
  const config = await loadConfig();
  const options = { kokoroHome: config.kokoroHome, appRoot: config.appRoot, fakeAgent: config.fakeAgent };

  console.log("Checking what Sparmate needs...");
  let checks = await runSetupChecks(options);
  printChecks(checks);

  const login = find(checks, "claude-login");
  if (login && !login.ok) {
    const binary = findBundledClaude(defaultDeps());
    if (binary && (await confirm("Sign in to Claude now?", true))) {
      console.log("Opening the Claude sign-in...");
      await runVisible(binary, ["auth", "login"]);
      checks = await runSetupChecks(options);
      const after = find(checks, "claude-login");
      console.log(`  ${after?.ok ? "ok      " : "missing "}  Claude sign-in: ${after?.detail ?? ""}`);
    } else if (binary) {
      console.log("Skipped the Claude sign-in. Run `npm run setup` again when you are ready.");
    }
  }

  const kokoro = find(checks, "kokoro");
  if (kokoro && !kokoro.ok && !noKokoro) {
    if (await confirm("Install the Kokoro voice (about 340 MB download)?", false)) {
      const python = await findQualifyingPython(defaultDeps().spawn);
      if (!python) {
        console.log("The Kokoro voice needs Python 3.11 or newer. Install it, then run setup again:");
        console.log(`  ${PYTHON_INSTALL_HINT}`);
      } else {
        let lastStep = -1;
        await installKokoro({
          kokoroHome: config.kokoroHome,
          python,
          log: (line) => console.log(line),
          runVisible,
          onProgress: (asset, received, total) => {
            if (total === null) return;
            const step = Math.floor((received / total) * 10);
            if (step === lastStep) return;
            lastStep = step;
            console.log(`  ${asset.fileName}: ${step * 10}% (${Math.round(received / 1_000_000)} of ${Math.round(total / 1_000_000)} MB)`);
          },
        });
        checks = await runSetupChecks(options);
      }
    }
  }

  const compiler = find(checks, "compiler");
  if (compiler && !compiler.ok && compiler.fix) {
    console.log("");
    console.log("Install the C++ compiler by running this, then run setup again:");
    console.log(`  ${compiler.fix}`);
  }

  console.log("");
  const missing = checks.filter((check) => !check.ok && !check.optional);
  const optionalMissing = checks.filter((check) => !check.ok && check.optional);
  if (missing.length === 0) console.log("Setup is complete.");
  else console.log(`Setup finished, but still missing: ${missing.map((check) => check.title).join(", ")}.`);
  if (optionalMissing.length > 0) console.log(`Optional: ${optionalMissing.map((check) => check.title).join(", ")}.`);
  console.log("Start the app with:");
  console.log("  npm start");
  return 0;
}

main()
  .then((code) => {
    rl?.close();
    process.exit(code);
  })
  .catch((err: unknown) => {
    rl?.close();
    console.error(`Setup failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
