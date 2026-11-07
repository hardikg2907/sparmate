import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { copyStudyKit } from "../lib/tempStudy.mjs";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 4768;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = "/tmp/ir-usage";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const work = await mkdtemp(join(tmpdir(), "ir-usage-tour-"));
const study = join(work, "study");
await mkdir(join(study, "lld"), { recursive: true });
await mkdir(OUT, { recursive: true });
await copyStudyKit(study);

const server = spawn(join(APP, "node_modules", ".bin", "tsx"), ["src/server/index.ts"], {
  cwd: APP,
  env: { ...process.env, PORT: String(PORT), STUDY_ROOT: study, DATA_DIR: join(work, "data"), IR_FAKE_AGENT: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});

let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));
for (let i = 0; i < 60 && !log.includes("running at"); i++) await sleep(500);

if (!log.includes("running at")) {
  console.error("Server failed to start:", log);
  server.kill();
  await rm(work, { recursive: true, force: true });
  process.exit(1);
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-first-run"] });

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  const token = await page.evaluate(async () => (await (await fetch("/api/bootstrap")).json()).csrfToken);

  const sessionId = await page.evaluate(async (t) => {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": t },
      body: JSON.stringify({ problemId: "c2-url-shortener", mode: "interview" }),
    });
    return (await res.json()).sessionId;
  }, token);

  await page.goto(`${BASE}/session/${sessionId}?testhooks=1`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => window.__irShell, { timeout: 20000 });
  await sleep(1500);

  // Send a chat message to generate turn usage
  await page.evaluate(() => window.__irShell.sendChat("I'd like to start with requirements. How many new links a month?"));
  await sleep(3500);

  // Click End Interview and confirm
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /end interview/i.test(b.textContent ?? ""));
    btn?.click();
  });
  await sleep(600);
  await page.evaluate(() => {
    const confirm = [...document.querySelectorAll("button")].filter((b) => /^end( interview)?$|end now|yes/i.test((b.textContent ?? "").trim())).pop();
    confirm?.click();
  });

  // Wait for debrief page
  await page.waitForFunction(() => /What the judge saw|Strengths|Teach me|This round used/i.test(document.body.innerText), { timeout: 60000 });
  // Wait for the usage card to load its data from /api/sessions/:id/usage
  await page.waitForFunction(() => /This round used/i.test(document.body.innerText), { timeout: 15000 });
  await sleep(1000);

  // Helper to set theme
  const setTheme = async (theme) => {
    await page.evaluate((th) => {
      document.documentElement.classList.toggle("dark", th === "dark");
      localStorage.setItem("ir-theme", th);
    }, theme);
    await sleep(300);
  };

  // 1. Debrief card - Light
  await setTheme("light");
  const debriefCardEl = await page.$("aside");
  if (debriefCardEl) {
    await debriefCardEl.screenshot({ path: join(OUT, "debrief-card-light.png") });
  }
  await page.screenshot({ path: join(OUT, "debrief-page-light.png") });

  // 2. Debrief card - Dark
  await setTheme("dark");
  if (debriefCardEl) {
    await debriefCardEl.screenshot({ path: join(OUT, "debrief-card-dark.png") });
  }
  await page.screenshot({ path: join(OUT, "debrief-page-dark.png") });

  // 3. Usage page - Light
  await page.goto(`${BASE}/usage`, { waitUntil: "networkidle0" });
  await sleep(1000);
  await setTheme("light");
  await page.screenshot({ path: join(OUT, "usage-page-light.png"), fullPage: true });

  // 4. Usage page - Dark
  await setTheme("dark");
  await page.screenshot({ path: join(OUT, "usage-page-dark.png"), fullPage: true });

  console.log("Screenshots captured successfully under", OUT);
} finally {
  await browser.close();
  server.kill("SIGTERM");
  await rm(work, { recursive: true, force: true });
}
