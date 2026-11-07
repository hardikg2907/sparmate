// Puppeteer layout & scroll verification across required screen sizes, themes, and pages.
// Fails with non-zero exit code if:
// 1. Body or document horizontally overflows (bodyHOverflow).
// 2. Visible elements overflow the viewport horizontally without an ancestor clip.
// 3. Nested scroll containers scroll in the same direction as the page / ancestor.
// 4. The room page scrolls as a whole (instead of individual panes).

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { copyStudyKit } from "../lib/tempStudy.mjs";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = Number(process.env.PORT ?? 4764);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 1024, height: 768 },
];

const THEMES = ["light", "dark"];

const work = await mkdtemp(join(tmpdir(), "ir-layout-check-"));
const study = join(work, "study");
await mkdir(join(study, "lld"), { recursive: true });
await copyStudyKit(study);

const server = spawn(join(APP, "node_modules", ".bin", "tsx"), ["src/server/index.ts"], {
  cwd: APP,
  env: { ...process.env, PORT: String(PORT), STUDY_ROOT: study, DATA_DIR: join(work, "data"), IR_FAKE_AGENT: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
for (let i = 0; i < 60 && !serverLog.includes("running at"); i++) await sleep(200);

if (!serverLog.includes("running at")) {
  console.error("Server failed to start:", serverLog);
  server.kill();
  await rm(work, { recursive: true, force: true });
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-first-run", "--no-default-browser-check"],
});

let totalFailures = 0;

try {
  const page = await browser.newPage();

  // Create a real session on the server for the real round test
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  const token = await page.evaluate(async () => (await (await fetch("/api/bootstrap")).json()).csrfToken);
  const realSessionRes = await page.evaluate(
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

  const TARGET_PAGES = [
    { name: "home (with unfinished)", url: (theme) => `/?fixture=home&theme=${theme}` },
    { name: "home (without unfinished)", url: (theme) => `/?fixture=home&unfinished=0&theme=${theme}` },
    { name: "room-hld", url: (theme) => `/?fixture=room-hld&theme=${theme}` },
    { name: "room-lld", url: (theme) => `/?fixture=room-lld&theme=${theme}` },
    { name: "debrief-hld", url: (theme) => `/?fixture=debrief-hld&theme=${theme}` },
    { name: "real fake-model round", url: (theme) => `/session/${realSessionRes}?theme=${theme}` },
    { name: "usage", url: (theme) => `/usage?theme=${theme}` },
  ];

  for (const target of TARGET_PAGES) {
    for (const theme of THEMES) {
      for (const vp of VIEWPORTS) {
        await page.setViewport(vp);
        const url = `${BASE}${target.url(theme)}`;
        await page.goto(url, { waitUntil: "networkidle0" });
        await sleep(350);

        const checkResult = await page.evaluate((isRoomTarget) => {
          const doc = document.documentElement;
          const body = document.body;
          const root = document.querySelector("#root");
          const errors = [];

          // 1. Horizontal overflow of body or document
          const hOverflow = doc.scrollWidth > window.innerWidth || body.scrollWidth > window.innerWidth;
          if (hOverflow) {
            errors.push(`Horizontal overflow: doc.scrollWidth=${doc.scrollWidth}, body.scrollWidth=${body.scrollWidth}, innerWidth=${window.innerWidth}`);
          }

          // 2. Room page must never scroll as a whole; only panes scroll
          if (isRoomTarget) {
            if (doc.scrollHeight > window.innerHeight) {
              errors.push(`Room page doc scrolls: doc.scrollHeight=${doc.scrollHeight} > innerHeight=${window.innerHeight}`);
            }
            if (body.scrollHeight > window.innerHeight) {
              errors.push(`Room page body scrolls: body.scrollHeight=${body.scrollHeight} > innerHeight=${window.innerHeight}`);
            }
            if (root && root.scrollHeight > root.clientHeight) {
              errors.push(`Room page #root scrolls: root.scrollHeight=${root.scrollHeight} > clientHeight=${root.clientHeight}`);
            }
            const roomView = document.querySelector("main")?.closest(".flex.h-full");
            if (roomView && roomView.scrollHeight > roomView.clientHeight + 1) {
              errors.push(`Room view root scrolls as a whole: scrollHeight=${roomView.scrollHeight} > clientHeight=${roomView.clientHeight}`);
            }
          }

          // 3. Nested scroll containers scrolling in same direction
          const allEls = Array.from(document.querySelectorAll("*"));
          const vScrollers = [];
          for (const el of allEls) {
            if (el.closest("[inert]") || el.closest(".pane-hidden") || el.classList.contains("sr-only")) continue;
            const style = window.getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden") continue;

            const hasVScroll = (style.overflowY === "auto" || style.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1;
            if (hasVScroll) {
              vScrollers.push({ el, tag: el.tagName, cls: el.className, scrollH: el.scrollHeight, clientH: el.clientHeight });
            }
          }

          // Check if any v-scroller has an ancestor that also has active v-scroll
          for (const sc of vScrollers) {
            let parent = sc.el.parentElement;
            while (parent) {
              const pStyle = window.getComputedStyle(parent);
              if ((pStyle.overflowY === "auto" || pStyle.overflowY === "scroll") && parent.scrollHeight > parent.clientHeight + 1) {
                errors.push(`Nested vertical scroll container: <${sc.tag} class="${sc.cls}"> inside <${parent.tagName} class="${parent.className}">`);
                break;
              }
              parent = parent.parentElement;
            }
          }

          // 4. Elements overflowing the viewport
          function isClipped(el) {
            let p = el.parentElement;
            while (p && p !== body && p !== doc) {
              const st = window.getComputedStyle(p);
              const clips = st.overflow === "hidden" || st.overflowX === "hidden" || st.overflow === "clip" || st.overflowX === "clip" ||
                            st.overflow === "auto" || st.overflowX === "auto" || st.overflow === "scroll" || st.overflowX === "scroll";
              if (clips) {
                const pr = p.getBoundingClientRect();
                if (pr.right <= window.innerWidth + 1) return true;
              }
              p = p.parentElement;
            }
            return false;
          }

          for (const el of allEls) {
            if (el.closest("[inert]") || el.closest(".pane-hidden") || el.classList.contains("sr-only")) continue;
            const st = window.getComputedStyle(el);
            if (st.display === "none" || st.visibility === "hidden") continue;
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && r.right > window.innerWidth + 1) {
              if (!isClipped(el)) {
                errors.push(`Element overflows viewport horizontally: <${el.tagName} class="${el.className}"> right=${r.right} > innerWidth=${window.innerWidth}`);
              }
            }
          }

          return errors;
        }, target.name.includes("room") || target.name.includes("round"));

        if (checkResult.length > 0) {
          totalFailures += checkResult.length;
          console.error(`FAIL: ${target.name} [${theme}] @ ${vp.width}x${vp.height}:`);
          for (const err of checkResult) console.error(`  - ${err}`);
        } else {
          console.log(`PASS: ${target.name} [${theme}] @ ${vp.width}x${vp.height}`);
        }
      }
    }
  }
} finally {
  await browser.close();
  server.kill();
  await rm(work, { recursive: true, force: true });
}

if (totalFailures > 0) {
  console.error(`Layout check failed with ${totalFailures} error(s).`);
  process.exit(1);
} else {
  console.log("All layout and scroll checks passed successfully.");
  process.exit(0);
}
