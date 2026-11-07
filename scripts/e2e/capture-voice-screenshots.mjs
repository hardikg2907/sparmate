import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { copyStudyKit } from "../lib/tempStudy.mjs";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 4761;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = "/tmp/ir-voice";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const work = await mkdtemp(join(tmpdir(), "ir-voice-screen-"));
const study = join(work, "study");
await mkdir(join(study, "lld"), { recursive: true });
await mkdir(OUT, { recursive: true });

await copyStudyKit(study);

const server = spawn(
  process.execPath,
  [join(APP, "node_modules", "tsx", "dist", "cli.mjs"), join(APP, "src", "server", "index.ts")],
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
  throw new Error(`Server failed to start on ${PORT}:\n${log}`);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-first-run", "--use-fake-ui-for-media-stream"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await page.evaluateOnNewDocument(() => {
    class MockSpeechRecognition {
      static available() {
        return Promise.resolve("available");
      }
      constructor() {
        this.lang = "en-US";
        this.processLocally = true;
        this.continuous = true;
        this.interimResults = true;
      }
      start() {
        setTimeout(() => {
          if (this.onspeechstart) this.onspeechstart();
          if (this.onresult) {
            this.onresult({
              resultIndex: 0,
              results: [
                Object.assign(
                  [{ transcript: "Let's start by clarifying the functional and non-functional requirements." }],
                  { isFinal: false },
                ),
              ],
            });
          }
        }, 120);
      }
      stop() {
        if (this.onend) this.onend();
      }
      abort() {
        if (this.onend) this.onend();
      }
    }
    window.SpeechRecognition = MockSpeechRecognition;
    window.webkitSpeechRecognition = MockSpeechRecognition;
  });

  await page.goto(`${BASE}/?fixture=room-hld`, { waitUntil: "networkidle0" });
  await sleep(1500);

  // Capture mic idle screenshot.
  const idlePath = join(OUT, "room-mic-idle.png");
  await page.screenshot({ path: idlePath });
  console.log(`Saved idle screenshot to ${idlePath}`);

  // Trigger listening mode via Ctrl+M.
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyM");
  await page.keyboard.up("Control");

  await sleep(500);

  // Capture listening screenshot with live interim transcript in chat input.
  const listeningPath = join(OUT, "room-mic-listening.png");
  await page.screenshot({ path: listeningPath });
  console.log(`Saved listening screenshot to ${listeningPath}`);
} finally {
  await browser.close();
  server.kill();
  await rm(work, { recursive: true, force: true });
}
