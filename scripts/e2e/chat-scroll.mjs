// Browser test: while a reply streams in, a small scroll up keeps its place, and scrolling back to the end follows again.
//   node scripts/e2e/chat-scroll.mjs     PORT, or a free port from 4750 to 4799 (not 4780); starts its own fake-agent server
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { pickFreePort } from "../lib/freePort.mjs";
import { copyStudyKit } from "../lib/tempStudy.mjs";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = process.env.PORT ? Number(process.env.PORT) : await pickFreePort();
if (!(PORT >= 4750 && PORT <= 4799) || PORT === 4780) throw new Error("Use a port from 4750 to 4799, except 4780");
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const work = await mkdtemp(join(tmpdir(), "ir-chat-scroll-"));
const study = join(work, "study");
await mkdir(join(study, "lld"), { recursive: true });
await copyStudyKit(study);

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
  server.kill();
  throw new Error(`Server failed to start on port ${PORT}:\n${log}`);
}

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-first-run"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  const token = await page.evaluate(async () => (await (await fetch("/api/bootstrap")).json()).csrfToken);
  const sessionId = await page.evaluate(
    async (t) =>
      (
        await (
          await fetch("/api/sessions", {
            method: "POST",
            headers: { "content-type": "application/json", "x-csrf-token": t },
            body: JSON.stringify({ problemId: "c2-url-shortener", mode: "guided" }),
          })
        ).json()
      ).sessionId,
    token,
  );
  await page.goto(`${BASE}/session/${sessionId}`, { waitUntil: "networkidle0" });

  const log$ = '[role="log"]';
  const box = "textarea";
  await page.waitForSelector(box);
  const replies = () => page.$$eval(`${log$} li`, (l) => l.length);
  const send = async (text) => {
    await page.click(box);
    await page.type(box, text);
    await page.keyboard.press("Enter");
  };
  const idle = async () => {
    for (let i = 0; i < 80; i++) {
      await sleep(100);
      const busy = await page.evaluate(() => document.body.innerText.includes("Thinking"));
      if (!busy) return;
    }
  };
  const view = () => page.$eval(log$, (el) => ({ top: el.scrollTop, fromEnd: el.scrollHeight - el.scrollTop - el.clientHeight }));

  // Fill the log well past one screen so there is room to scroll.
  await idle();
  for (let i = 0; i < 8; i++) {
    await send(`Requirement question number ${i}: how many links are created each month, and how often is each opened?`);
    await sleep(200);
    await idle();
  }
  check("the log is taller than its view", (await view()).fromEnd === 0 && (await replies()) > 8, await view());

  // Scroll up a little, inside the old snap-back distance, while the next reply streams in.
  const before = await replies();
  await send("And how fast must a redirect be?");
  await page.hover(log$);
  await page.mouse.wheel({ deltaY: -40 });
  await sleep(150);
  const held = await view();
  await idle();
  await sleep(200);
  const after = await view();
  check("a reply streamed in after the scroll", (await replies()) > before + 1, { before, now: await replies() });
  check("the small scroll up keeps its place while the reply streams", after.top <= held.top + 2 && after.fromEnd > 2, { held, after });
  check("Jump to latest shows", await page.evaluate(() => document.body.innerText.includes("Jump to latest")), null);

  // Scrolling back to the end follows new text again.
  await page.mouse.wheel({ deltaY: 4000 });
  await sleep(300);
  await send("What happens when a link expires?");
  await idle();
  await sleep(200);
  check("after scrolling to the end, the next reply is followed", (await view()).fromEnd <= 2, await view());
} finally {
  await browser.close();
  server.kill();
  await rm(work, { recursive: true, force: true });
}
if (failed > 0) {
  console.log(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("All chat scroll checks passed");
