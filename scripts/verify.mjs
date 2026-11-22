// Runs every check: npm run verify
//
// The quick checks and the build run together first. When they all pass, the tests, the fake-agent round and the
// layout check run together. Each step's output is held and printed whole, in step order, so the log reads as if
// the steps ran one by one. When a step fails, the steps already running still finish, so every server, browser and
// temp folder they started is cleaned up; then every failed step is named and nothing later runs.
//
// VERIFY_SERIAL=1 runs the steps one by one, for a machine too busy to run them together.
import { spawn } from "node:child_process";
import { pickFreePort } from "./lib/freePort.mjs";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

// Both end-to-end scripts start a server. Two scripts that probe for a free port at the same moment can pick the
// same one, so each gets its own here. A PORT set by the caller still goes to the fake-agent round.
const e2ePort = process.env.PORT ? Number(process.env.PORT) : await pickFreePort();
const layoutPort = await pickFreePort({ skip: [4780, e2ePort] });

const quick = [
  { name: "typecheck", cmd: npm, args: ["run", "typecheck"] },
  { name: "lint", cmd: npm, args: ["run", "lint"] },
  { name: "format:check", cmd: npm, args: ["run", "format:check"] },
  // dist/ is outside the lint and format checks, so the build can write it while they run.
  { name: "vite build", cmd: npx, args: ["vite", "build"] },
];
const slow = [
  { name: "test", cmd: npm, args: ["test"] },
  {
    name: "e2e fake round",
    cmd: process.execPath,
    args: ["scripts/e2e/ws-fake-round.mjs"],
    env: { SPARMATE_FAKE_AGENT: "1", PORT: String(e2ePort) },
  },
  // Scroll and overflow bugs show only in a real browser at real sizes, so every page is loaded at each width.
  { name: "layout and scroll", cmd: process.execPath, args: ["scripts/e2e/layout-check.mjs"], env: { PORT: String(layoutPort) } },
];

const steps = [...quick, ...slow];
const phases = process.env.VERIFY_SERIAL === "1" ? steps.map((step) => [step]) : [quick, slow];

function run(step) {
  return new Promise((resolve) => {
    const started = Date.now();
    const chunks = [];
    const child = spawn(step.cmd, step.args, {
      stdio: ["ignore", "pipe", "pipe"],
      // Output goes through a pipe, so tools that colour only a terminal are told to colour anyway.
      env: { ...process.env, ...(process.stdout.isTTY ? { FORCE_COLOR: "1" } : {}), ...step.env },
      // npm.cmd and npx.cmd need a shell on Windows
      shell: process.platform === "win32",
    });
    child.stdout.on("data", (d) => chunks.push(d));
    child.stderr.on("data", (d) => chunks.push(d));
    const finish = (status, extra = "") => resolve({ step, status, seconds: (Date.now() - started) / 1000, output: Buffer.concat(chunks).toString() + extra });
    child.on("error", (err) => finish(1, `\n${err.message}\n`));
    child.on("close", (code) => finish(code ?? 1));
  });
}

const results = [];
for (const phase of phases) {
  if (phase.length > 1) console.log(`\n[verify] running together: ${phase.map((s) => s.name).join(", ")}`);
  const done = await Promise.all(
    phase.map((step) =>
      run(step).then((result) => {
        if (phase.length > 1) console.log(`  ${result.status === 0 ? "passed" : "FAILED"}: ${step.name} (${result.seconds.toFixed(1)}s)`);
        return result;
      }),
    ),
  );
  for (const result of done) {
    console.log(`\n[verify ${steps.indexOf(result.step) + 1}/${steps.length}] ${result.step.name}`);
    process.stdout.write(result.output);
    results.push(result);
  }
  const failed = done.filter((r) => r.status !== 0);
  if (failed.length > 0) {
    const names = failed.map((r) => `${steps.indexOf(r.step) + 1}/${steps.length} ${r.step.name}`).join(", ");
    console.error(`\nverify failed at step ${names}`);
    process.exit(failed[0].status || 1);
  }
}

console.log("\nStep times:");
for (const r of results) console.log(`  ${r.step.name.padEnd(18)} ${r.seconds.toFixed(1).padStart(6)}s`);
console.log("\nverify passed");
