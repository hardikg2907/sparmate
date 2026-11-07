// End-to-end browser test checking SpeechRecognition lifecycle upon leaving the room.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { copyStudyKit } from "../lib/tempStudy.mjs";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = Number(process.env.PORT ?? 4770);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const work = await mkdtemp(join(tmpdir(), "ir-voice-life-"));
const study = join(work, "study");
await mkdir(join(study, "lld"), { recursive: true });

await copyStudyKit(study);

const server = spawn(
  join(APP, "node_modules", ".bin", "tsx"),
  ["src/server/index.ts"],
  {
    cwd: APP,
    env: {
      ...process.env,
      PORT: String(PORT),
      STUDY_ROOT: study,
      DATA_DIR: join(work, "data"),
      SPARMATE_FAKE_AGENT: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

for (let i = 0; i < 60 && !log.includes("running at"); i++) {
  await sleep(500);
}

if (!log.includes("running at")) {
  server.kill();
  throw new Error(`Server failed to start on port ${PORT}:\n${log}`);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--no-first-run",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ],
});

let failed = false;

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await page.evaluateOnNewDocument(() => {
    window.__speechRegistry = {
      instances: [],
      activeCount: 0,
      totalStarts: 0,
      startsAfterNavigation: 0,
      homeNavigated: false,
    };

    class InstrumentedSpeechRecognition {
      static available() {
        return Promise.resolve("available");
      }

      constructor() {
        this.lang = "en-US";
        this.processLocally = true;
        this.continuous = true;
        this.interimResults = true;
        this.active = false;
        this.starts = 0;
        this.aborts = 0;
        this.stops = 0;
        this.id = window.__speechRegistry.instances.length + 1;
        window.__speechRegistry.instances.push(this);
      }

      start() {
        this.starts++;
        this.active = true;
        window.__speechRegistry.totalStarts++;
        if (window.__speechRegistry.homeNavigated) {
          window.__speechRegistry.startsAfterNavigation++;
        }
        window.__speechRegistry.activeCount = window.__speechRegistry.instances.filter((i) => i.active).length;

        setTimeout(() => {
          if (this.active && this.onspeechstart) {
            this.onspeechstart();
          }
        }, 80);
        // Chrome ends continuous recognition on its own after a silence; that end is what used to restart the mic.
        setTimeout(() => {
          if (!this.active) return;
          this.active = false;
          window.__speechRegistry.activeCount = window.__speechRegistry.instances.filter((i) => i.active).length;
          if (this.onend) this.onend();
        }, 1500);
      }

      stop() {
        this.stops++;
        this.active = false;
        window.__speechRegistry.activeCount = window.__speechRegistry.instances.filter((i) => i.active).length;
        if (this.onend) {
          this.onend();
        }
      }

      abort() {
        this.aborts++;
        this.active = false;
        window.__speechRegistry.activeCount = window.__speechRegistry.instances.filter((i) => i.active).length;
        // In Web Speech API, abort triggers onend if the handler is attached.
        if (this.onend) {
          this.onend();
        }
      }
    }

    window.SpeechRecognition = InstrumentedSpeechRecognition;
    window.webkitSpeechRecognition = InstrumentedSpeechRecognition;
  });

  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  const token = await page.evaluate(async () => (await (await fetch("/api/bootstrap")).json()).csrfToken);

  const sessionId = await page.evaluate(
    async (t) =>
      (
        await (
          await fetch("/api/sessions", {
            method: "POST",
            headers: { "content-type": "application/json", "x-csrf-token": t },
            body: JSON.stringify({ problemId: "c2-url-shortener", mode: "interview" }),
          })
        ).json()
      ).sessionId,
    token,
  );

  await page.goto(`${BASE}/session/${sessionId}?testhooks=1`, { waitUntil: "networkidle0" });
  await sleep(1500);

  // Turn mic on via Ctrl+M.
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyM");
  await page.keyboard.up("Control");
  await sleep(500);

  const activeBefore = await page.evaluate(() => window.__speechRegistry.activeCount);
  if (activeBefore !== 1) {
    throw new Error(`Expected 1 active recognizer in room, found ${activeBefore}`);
  }

  // Navigate back to Home using in-app back button.
  const backClicked = await page.evaluate(() => {
    const btn = document.querySelector('a[aria-label="Back to home"]');
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!backClicked) {
    throw new Error("In-app back button not found");
  }

  await sleep(400);

  // Confirm leave if confirmation modal is shown.
  await page.evaluate(() => {
    const confirm = [...document.querySelectorAll("button")].find((b) => /^leave$/i.test((b.textContent ?? "").trim()));
    confirm?.click();
  });

  await page.waitForFunction(() => window.location.pathname === "/", { timeout: 10000 });
  await page.evaluate(() => {
    window.__speechRegistry.homeNavigated = true;
  });

  // Verify recognition stopped immediately.
  const activeImmediately = await page.evaluate(() => window.__speechRegistry.activeCount);
  if (activeImmediately !== 0) {
    throw new Error(`Expected 0 active recognizers on Home, found ${activeImmediately}`);
  }

  // Monitor over the next 10 seconds that no recognizer restarts.
  for (let second = 1; second <= 10; second++) {
    await sleep(1000);
    const stats = await page.evaluate(() => ({
      active: window.__speechRegistry.activeCount,
      restarts: window.__speechRegistry.startsAfterNavigation,
    }));

    if (stats.active !== 0 || stats.restarts !== 0) {
      throw new Error(`Recognition restarted at second ${second}: active=${stats.active}, restarts=${stats.restarts}`);
    }
  }

  console.log("PASS voice lifecycle: no recognizer active and none restarted over 10 seconds");
} catch (err) {
  failed = true;
  console.error("FAIL voice lifecycle check:", err);
} finally {
  await browser.close().catch(() => {});
  server.kill("SIGTERM");
  await rm(work, { recursive: true, force: true }).catch(() => {});
  if (failed) {
    process.exit(1);
  }
}
