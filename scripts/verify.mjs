// Runs every check in order and stops at the first failure: npm run verify
import { spawnSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

const steps = [
  { name: "typecheck", cmd: npm, args: ["run", "typecheck"] },
  { name: "lint", cmd: npm, args: ["run", "lint"] },
  { name: "format:check", cmd: npm, args: ["run", "format:check"] },
  { name: "test", cmd: npm, args: ["test"] },
  { name: "vite build", cmd: npx, args: ["vite", "build"] },
  {
    name: "e2e fake round",
    cmd: process.execPath,
    args: ["scripts/e2e/ws-fake-round.mjs"],
    env: { SPARMATE_FAKE_AGENT: "1" },
  },
  // Scroll and overflow bugs show only in a real browser at real sizes, so every page is loaded at each width.
  { name: "layout and scroll", cmd: process.execPath, args: ["scripts/e2e/layout-check.mjs"] },
];

for (const [i, step] of steps.entries()) {
  console.log(`\n[verify ${i + 1}/${steps.length}] ${step.name}`);
  const result = spawnSync(step.cmd, step.args, {
    stdio: "inherit",
    env: { ...process.env, ...step.env },
    // npm.cmd and npx.cmd need a shell on Windows
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`\nverify failed at step ${i + 1}/${steps.length}: ${step.name}`);
    process.exit(result.status ?? 1);
  }
}
console.log("\nverify passed");
