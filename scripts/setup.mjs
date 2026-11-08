// One-command setup: node scripts/setup.mjs [--yes] [--no-kokoro] [--skip-install]
// Phase 1 uses only Node built-ins because it runs before node_modules exists. Phase 2 (scripts/setup/run.ts) does the rest.
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const flags = process.argv.slice(2);
const KNOWN_FLAGS = new Set(["--yes", "--no-kokoro", "--skip-install"]);

const unknown = flags.filter((flag) => !KNOWN_FLAGS.has(flag));
if (unknown.length > 0) {
  console.error(`Unknown option: ${unknown.join(" ")}`);
  console.error("Options: --yes (answer yes to every question), --no-kokoro (skip the voice), --skip-install (do not run npm ci)");
  process.exit(1);
}

const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`Sparmate needs Node.js 22.12 or newer. You have ${process.versions.node}.`);
  console.error("Run this in the sparmate folder, then run setup again:");
  console.error("  nvm install");
  process.exit(1);
}

if (process.platform === "win32" || process.platform === "linux") {
  console.log("Native setup is for macOS. On Linux and Windows, run Sparmate in a container.");
  console.log("");
  console.log("Linux:");
  console.log("  ./container/setup.sh");
  console.log("  ./container/start.sh");
  console.log("");
  console.log("Windows (PowerShell, in the container folder):");
  console.log("  .\\setup.ps1");
  console.log("  .\\start.ps1");
  console.log("");
  console.log("More detail: container/README.md");
  process.exit(0);
}

/** npm writes node_modules/.package-lock.json when an install ends; if it is newer than the lock file, the install is current. */
function installIsCurrent() {
  try {
    return statSync(join(appRoot, "node_modules", ".package-lock.json")).mtimeMs >= statSync(join(appRoot, "package-lock.json")).mtimeMs;
  } catch {
    return false;
  }
}

if (flags.includes("--skip-install")) {
  console.log("Skipping npm ci.");
} else if (installIsCurrent()) {
  console.log("The packages are already installed.");
} else {
  console.log("Installing the packages with npm ci...");
  const install = spawnSync("npm", ["ci"], { cwd: appRoot, stdio: "inherit" });
  if (install.status !== 0) {
    console.error("npm ci failed. Fix the error above and run setup again.");
    process.exit(install.status ?? 1);
  }
}

const tsx = join(appRoot, "node_modules", ".bin", "tsx");
const phase2 = spawnSync(tsx, [join("scripts", "setup", "run.ts"), ...flags], { cwd: appRoot, stdio: "inherit" });
if (phase2.error) {
  console.error(`Setup could not continue: ${phase2.error.message}`);
  console.error("Run setup again without --skip-install.");
  process.exit(1);
}
process.exit(phase2.status ?? 1);
