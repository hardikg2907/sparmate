// Regenerates the README screenshots in docs/screens from the fixture pages, with the fake model driver,
// against a temp copy of the study folder. Every desktop image is 1440x900 CSS px at 2x (2880x1800).
//   npx vite build && node scripts/capture-docs-screens.mjs [outDir]     (PORT, or a free port from 4750 to 4799 when unset; needs Chrome)
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { pickFreePort } from "./lib/freePort.mjs";
import { copyStudyKit } from "./lib/tempStudy.mjs";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.PORT ? Number(process.env.PORT) : await pickFreePort();
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = resolve(process.argv[2] ?? join(APP, "docs", "screens"));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The fixtures date their rounds from the clock, so the page clock is frozen on an HLD day (Thursday). That keeps the
// week strip, the redo due dates and the paused rounds the same on every run. DSA numbers need a username.
const TODAY = "2026-11-12";
const COMMON = `now=${TODAY}&testmode=0&username=example_user&testhooks=1`;
// Wednesday is an LLD day so the Parking Lot round from that day shows as done, and Tuesday shows as missed.
const HOME = `fixture=home&${COMMON}&plan=dsa,hld,lld,hld,dsa,lld,redo`;
const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 2 };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

const clickText = (page, re) =>
  page.evaluate((src) => {
    const el = [...document.querySelectorAll("button")].find((b) => new RegExp(src, "i").test(b.textContent ?? ""));
    el?.click();
    return Boolean(el);
  }, re.source);

// The speech-pack note is asked once per browser, so a fresh profile always shows it. Answering it first keeps the shot clean.
const settleRoom = async (page) => {
  await clickText(page, /^not now$/);
  // The board only fits its view on a change, so a round trip through the other view frames the current step.
  await clickText(page, /^whole board$/);
  await sleep(600);
  await clickText(page, /^this step$/);
  await clickText(page, /^jump to latest$/);
  await sleep(1200);
};

// The step view opens at about 30%. Zooming at the design frame keeps it in place while it grows to fill the canvas, and
// the hand tool carries no hint, so Excalidraw's pan-the-canvas line goes away.
const frameHldBoard = async (page) => {
  await settleRoom(page);
  await page.mouse.move(617, 494);
  await page.keyboard.down("Control");
  for (let i = 0; i < 40; i++) {
    const zoom = await page.evaluate(() => Number(/(\d+)%/.exec(document.body.innerText)?.[1] ?? 100));
    if (zoom >= 38) break;
    await page.mouse.wheel({ deltaY: -20 });
    await sleep(60);
  }
  await page.keyboard.up("Control");
  await clickText(page, /^jump to latest$/);
  await page.mouse.click(438, 127);
  await page.mouse.move(700, 60);
  await sleep(800);
};

const SHOTS = [
  { name: "home-dark", query: HOME },
  { name: "home-light", query: `${HOME}&theme=light` },
  { name: "room-hld", query: `fixture=room-hld&mode=guided&${COMMON}`, room: true, before: frameHldBoard },
  { name: "room-lld", query: `fixture=room-lld&mode=guided&${COMMON}`, room: true, before: settleRoom },
  { name: "debrief", query: `fixture=debrief-hld&mode=guided&${COMMON}`, room: true, before: settleRoom },
  { name: "practice", query: `fixture=gym&${COMMON}` },
  { name: "progress", query: `fixture=progress&${COMMON}` },
  {
    name: "palette",
    query: HOME,
    before: async (page) => {
      await page.keyboard.down("Meta");
      await page.keyboard.press("k");
      await page.keyboard.up("Meta");
      await page.waitForSelector('[role="dialog"], [cmdk-root], input[role="combobox"]', { timeout: 5000 });
      await page.keyboard.type("url", { delay: 40 });
      await sleep(400);
    },
  },
  { name: "today-phone", query: HOME, viewport: PHONE },
];

const work = await mkdtemp(join(tmpdir(), "docs-screens-"));
const study = join(work, "study");
await copyStudyKit(study);
await mkdir(OUT, { recursive: true });

const server = spawn(join(APP, "node_modules", ".bin", "tsx"), ["src/server/index.ts"], {
  cwd: APP,
  env: { ...process.env, PORT: String(PORT), STUDY_ROOT: study, DATA_DIR: join(work, "data"), SPARMATE_FAKE_AGENT: "1" },
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
let failed = false;
try {
  for (const shot of SHOTS) {
    const page = await browser.newPage();
    try {
      await page.setViewport(shot.viewport ?? DESKTOP);
      await page.evaluateOnNewDocument((iso) => {
        const shift = new Date(`${iso}T10:00:00`).getTime() - Date.now();
        const RealDate = Date;
        class FrozenDate extends RealDate {
          constructor(...args) {
            if (args.length === 0) super(RealDate.now() + shift);
            else super(...args);
          }
          static now() {
            return RealDate.now() + shift;
          }
        }
        window.Date = FrozenDate;
      }, TODAY);
      // Reduced motion makes entry animations and number counters jump to their final values.
      await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
      await page.goto(`${BASE}/?${shot.query}`, { waitUntil: "networkidle0" });
      if (shot.room) await page.waitForFunction(() => window.__irBoard || window.__irShell, { timeout: 20000 });
      await page.evaluate(() => document.fonts.ready);
      await sleep(shot.room ? 2500 : 1000);
      await shot.before?.(page);
      await page.evaluate(() => document.fonts.ready);
      await sleep(500);
      await page.screenshot({ path: join(OUT, `${shot.name}.png`) });
      console.log(`wrote ${shot.name}.png`);
    } catch (e) {
      failed = true;
      console.error(`${shot.name} failed: ${e.message}`);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
  await rm(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
