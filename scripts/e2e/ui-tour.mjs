// Screenshot tour of the real app with the fake model driver, against a temp copy of the study folder.
//   node scripts/e2e/ui-tour.mjs [outDir]     (PORT defaults to 4756; needs `npx vite build` first)
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { copyStudyKit } from "../lib/tempStudy.mjs";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = Number(process.env.PORT ?? 4756);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.argv[2] ?? "/tmp/ir-tour";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const work = await mkdtemp(join(tmpdir(), "ir-tour-"));
const study = join(work, "study");
await mkdir(join(study, "lld"), { recursive: true });
await mkdir(OUT, { recursive: true });
await copyStudyKit(study);

const server = spawn(join(APP, "node_modules", ".bin", "tsx"), ["src/server/index.ts"], { cwd: APP, env: { ...process.env, PORT: String(PORT), STUDY_ROOT: study, DATA_DIR: join(work, "data"), IR_FAKE_AGENT: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));
for (let i = 0; i < 60 && !log.includes("running at"); i++) await sleep(500);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-first-run"] });
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("esm.sh")) errors.push(m.text());
  });

  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  await sleep(800);
  await page.screenshot({ path: join(OUT, "1-home.png") });

  const token = await page.evaluate(async () => (await (await fetch("/api/bootstrap")).json()).csrfToken);
  const create = (problemId) =>
    page.evaluate(
      async (id, t) => (await (await fetch("/api/sessions", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": t }, body: JSON.stringify({ problemId: id, mode: "interview" }) })).json()).sessionId,
      problemId,
      token,
    );

  const hld = await create("c2-url-shortener");
  await page.goto(`${BASE}/session/${hld}?testhooks=1`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => window.__irBoard && window.__irShell, { timeout: 20000 });
  await sleep(1500);
  await page.evaluate(() => {
    const b = window.__irBoard;
    b.insertShape("client", "Client");
    b.insertShape("load_balancer", "Load balancer");
    b.insertShape("service", "Redirect service");
    b.insertShape("cache", "Redis");
    b.insertShape("database", "Postgres");
    b.connect("Client", "Load balancer", "HTTPS");
    b.connect("Load balancer", "Redirect service", "GET /{code}");
    b.connect("Redirect service", "Redis", "get");
    b.connect("Redirect service", "Postgres", "on miss");
  });
  await page.evaluate(() => window.__irShell.sendChat("I'd like to start with requirements. How many new links a month, and what's the read to write ratio?"));
  await sleep(3500);
  await page.screenshot({ path: join(OUT, "2-room-hld.png") });

  const lld = await create("b3-parking-lot");
  await page.goto(`${BASE}/session/${lld}?testhooks=1`, { waitUntil: "networkidle0" });
  await sleep(2500);
  await page.screenshot({ path: join(OUT, "3-room-lld.png") });

  await page.goto(`${BASE}/session/${hld}?testhooks=1`, { waitUntil: "networkidle0" });
  await sleep(1500);
  await page.evaluate(async (t) => {
    void t;
  }, token);
  // End through the UI's own socket: the shell exposes no end hook, so click the button and confirm.
  const ended = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /end interview/i.test(b.textContent ?? ""));
    btn?.click();
    return Boolean(btn);
  });
  await sleep(600);
  await page.evaluate(() => {
    const confirm = [...document.querySelectorAll("button")].filter((b) => /^end( interview)?$|end now|yes/i.test((b.textContent ?? "").trim())).pop();
    confirm?.click();
  });
  await page.waitForFunction(() => /What the judge saw|Strengths|Teach me/i.test(document.body.innerText), { timeout: 60000 }).catch(() => {});
  await sleep(1500);
  await page.screenshot({ path: join(OUT, "4-debrief.png") });
  await page.screenshot({ path: join(OUT, "5-debrief-full.png"), fullPage: true });
  console.log(JSON.stringify({ out: OUT, endClicked: ended, errors: errors.slice(0, 10) }, null, 2));
} finally {
  await browser.close();
  server.kill("SIGTERM");
  await rm(work, { recursive: true, force: true });
}
