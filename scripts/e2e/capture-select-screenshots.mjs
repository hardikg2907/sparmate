import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { copyStudyKit } from "../lib/tempStudy.mjs";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 4766;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = "/tmp/ir-select";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const work = await mkdtemp(join(tmpdir(), "ir-select-screen-"));
const study = join(work, "study");
await mkdir(join(study, "lld"), { recursive: true });
await mkdir(OUT, { recursive: true });

await copyStudyKit(study);

const server = spawn(process.execPath, [join(APP, "node_modules", "tsx", "dist", "cli.mjs"), join(APP, "src", "server", "index.ts")], {
  cwd: APP,
  env: {
    ...process.env,
    PORT: String(PORT),
    STUDY_ROOT: study,
    DATA_DIR: join(work, "data"),
    SPARMATE_FAKE_AGENT: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

for (let i = 0; i < 60 && !log.includes("running at"); i++) {
  await sleep(200);
}

if (!log.includes("running at")) {
  server.kill();
  await rm(work, { recursive: true, force: true });
  throw new Error(`Server failed to start on ${PORT}:\n${log}`);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-first-run", "--no-default-browser-check"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // 1. Settings dialog with model Select open (light theme)
  await page.goto(`${BASE}/?fixture=home&theme=light`, { waitUntil: "networkidle0" });
  await sleep(500);

  // Click Settings button
  const settingsBtn = await page.waitForSelector('button:has-text("Settings")', { timeout: 5000 }).catch(async () => {
    const btns = await page.$$("button");
    for (const b of btns) {
      const text = await page.evaluate((el) => el.textContent, b);
      if (text && text.includes("Settings")) return b;
    }
    return null;
  });
  if (settingsBtn) {
    await settingsBtn.click();
  }
  await sleep(400);

  // Click model select (Interviewer model)
  const modelTrigger = await page.waitForSelector('button[aria-label="Interviewer model"]', { timeout: 5000 });
  await modelTrigger.click();
  await sleep(300);

  const lightPath = join(OUT, "settings-model-select-light.png");
  await page.screenshot({ path: lightPath });
  console.log(`Saved: ${lightPath}`);

  // 2. Settings dialog with model Select open (dark theme)
  await page.goto(`${BASE}/?fixture=home&theme=dark`, { waitUntil: "networkidle0" });
  await sleep(500);

  const settingsBtnDark = await page.waitForSelector('button:has-text("Settings")', { timeout: 5000 }).catch(async () => {
    const btns = await page.$$("button");
    for (const b of btns) {
      const text = await page.evaluate((el) => el.textContent, b);
      if (text && text.includes("Settings")) return b;
    }
    return null;
  });
  if (settingsBtnDark) {
    await settingsBtnDark.click();
  }
  await sleep(400);

  const modelTriggerDark = await page.waitForSelector('button[aria-label="Interviewer model"]', { timeout: 5000 });
  await modelTriggerDark.click();
  await sleep(300);

  const darkPath = join(OUT, "settings-model-select-dark.png");
  await page.screenshot({ path: darkPath });
  console.log(`Saved: ${darkPath}`);

  // 3. Home filter row with status Select open
  await page.goto(`${BASE}/?fixture=home&theme=light`, { waitUntil: "networkidle0" });
  await sleep(500);

  const statusTrigger = await page.waitForSelector("#status-filter", { timeout: 5000 });
  // Scroll it into view if needed
  await page.evaluate((el) => el.scrollIntoView({ block: "center" }), statusTrigger);
  await sleep(200);
  await statusTrigger.click();
  await sleep(300);

  const homeStatusPath = join(OUT, "home-status-select-open.png");
  await page.screenshot({ path: homeStatusPath });
  console.log(`Saved: ${homeStatusPath}`);
} finally {
  await browser.close();
  server.kill();
  await rm(work, { recursive: true, force: true });
}
