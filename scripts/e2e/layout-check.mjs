// Puppeteer layout & scroll verification across required screen sizes, themes, and pages.
// Fails with non-zero exit code if:
// 1. Body or document horizontally overflows (bodyHOverflow).
// 2. Visible elements overflow the viewport horizontally without an ancestor clip.
// 3. Nested scroll containers scroll in the same direction as the page / ancestor.
// 4. The room page scrolls as a whole (instead of individual panes).
// 5. A jump inside a page (sub-nav, #hash link) scrolls the window, body or app root, or moves the bar off the top.
// 6. A scroller scrolls past its own content into blank space.
// PORT sets the port; when it is unset the script picks a free port from 4750 to 4799 (not 4780).

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { pickFreePort } from "../lib/freePort.mjs";
import { copyStudyKit } from "../lib/tempStudy.mjs";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = process.env.PORT ? Number(process.env.PORT) : await pickFreePort();
const BASE = `http://127.0.0.1:${PORT}`;
// CHROME_PATH overrides the usual install path for the platform.
const CHROME =
  process.env.CHROME_PATH ??
  {
    darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    linux: "/usr/bin/google-chrome",
    win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  }[process.platform];
if (!CHROME || !existsSync(CHROME)) {
  console.error(`Google Chrome was not found at ${CHROME ?? "(no default for this platform)"}. Install it, or set CHROME_PATH.`);
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
];

const THEMES = ["light", "dark"];

const work = await mkdtemp(join(tmpdir(), "ir-layout-check-"));
const study = join(work, "study");
await mkdir(join(study, "lld"), { recursive: true });
await copyStudyKit(study);

const server = spawn(join(APP, "node_modules", ".bin", "tsx"), ["src/server/index.ts"], {
  cwd: APP,
  env: { ...process.env, PORT: String(PORT), STUDY_ROOT: study, DATA_DIR: join(work, "data"), SPARMATE_FAKE_AGENT: "1" },
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
    { name: "today (with unfinished)", url: (theme) => `/?fixture=home&theme=${theme}` },
    { name: "today (without unfinished)", url: (theme) => `/?fixture=home&unfinished=0&theme=${theme}` },
    { name: "library", url: (theme) => `/?fixture=library&theme=${theme}` },
    { name: "library (new question)", url: (theme) => `/?fixture=library-new&theme=${theme}` },
    { name: "progress", url: (theme) => `/?fixture=progress&theme=${theme}` },
    { name: "history", url: (theme) => `/?fixture=history&theme=${theme}` },
    { name: "settings", url: (theme) => `/?fixture=settings&theme=${theme}` },
    { name: "gym", url: (theme) => `/?fixture=gym&theme=${theme}` },
    { name: "dsa", url: (theme) => `/?fixture=dsa&theme=${theme}` },
    { name: "drill dialogue", url: (theme) => `/?fixture=drill-dialogue&theme=${theme}` },
    { name: "room-hld", url: (theme) => `/?fixture=room-hld&theme=${theme}` },
    { name: "room-lld", url: (theme) => `/?fixture=room-lld&theme=${theme}` },
    { name: "debrief-hld", url: (theme) => `/?fixture=debrief-hld&theme=${theme}` },
    { name: "debrief-hld (coach full screen)", url: (theme) => `/?fixture=debrief-hld&focus=coach&theme=${theme}` },
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

        const checkResult = await page.evaluate(
          (isRoomTarget) => {
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

            // Check if any v-scroller has an ancestor that also has active v-scroll. A block marked data-nested-scroll
            // (the debrief's coach chat on a phone) scrolls inside a scrolling page on purpose.
            for (const sc of vScrollers) {
              if (sc.el.closest("[data-nested-scroll]")) continue;
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

            // 4. A scroller must not scroll past its own content. An absolutely positioned descendant whose containing
            // block lies outside an inner scroller (screen-reader text is the usual one) can stretch an outer scroller
            // into blank space, which nothing else here would notice.
            for (const sc of vScrollers) {
              const el = sc.el;
              const top = el.getBoundingClientRect().top + el.clientTop - el.scrollTop;
              let contentBottom = 0;
              for (const child of el.children) {
                const cs = window.getComputedStyle(child);
                if (cs.position === "absolute" || cs.position === "fixed" || cs.display === "none") continue;
                contentBottom = Math.max(contentBottom, child.getBoundingClientRect().bottom - top + parseFloat(cs.marginBottom || "0"));
              }
              const extra = el.scrollHeight - (contentBottom + parseFloat(window.getComputedStyle(el).paddingBottom || "0"));
              if (extra > 4) {
                errors.push(`Scroller scrolls ${Math.round(extra)}px past its content: <${el.tagName} class="${el.className}">`);
              }
            }

            // 5. Elements overflowing the viewport
            function isClipped(el) {
              let p = el.parentElement;
              while (p && p !== body && p !== doc) {
                const st = window.getComputedStyle(p);
                const clips =
                  st.overflow === "hidden" ||
                  st.overflowX === "hidden" ||
                  st.overflow === "clip" ||
                  st.overflowX === "clip" ||
                  st.overflow === "auto" ||
                  st.overflowX === "auto" ||
                  st.overflow === "scroll" ||
                  st.overflowX === "scroll";
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
          },
          target.name.includes("room") || target.name.includes("round"),
        );

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

  // A jump to a section must scroll only the page's own scroller. A short last section cannot reach the top, and
  // `scrollIntoView` then moves the app frame instead, which pushes the bar out of the window.
  const frameOffsets = () =>
    page.evaluate(() => ({
      window: document.scrollingElement?.scrollTop ?? 0,
      body: document.body.scrollTop,
      root: document.querySelector("#root")?.scrollTop ?? 0,
      headerTop: document.querySelector("header")?.getBoundingClientRect().top ?? 0,
    }));
  const checkFrame = async (label) => {
    const o = await frameOffsets();
    if (o.window !== 0 || o.body !== 0 || o.root !== 0 || o.headerTop !== 0) {
      totalFailures += 1;
      console.error(`FAIL: ${label}: window=${o.window} body=${o.body} root=${o.root} headerTop=${o.headerTop}`);
    } else {
      console.log(`PASS: ${label}`);
    }
  };
  // The 390 run is a smoke check: on a phone the last section can reach the top, so the old bug does not show there.
  // The 1280 run also makes a raw `scrollIntoView` call that skips the helper, which proves the frame itself cannot scroll.
  for (const vp of [VIEWPORTS[0], { width: 390, height: 844 }]) {
    await page.setViewport(vp);
    const at = `@ ${vp.width}x${vp.height}`;
    await page.goto(`${BASE}/?fixture=progress&theme=dark`, { waitUntil: "networkidle0" });
    await sleep(350);
    for (const label of ["This week", "Skills", "DSA", "History"]) {
      await page.evaluate((l) => [...document.querySelectorAll(".progress-subnav a")].find((a) => a.textContent === l)?.click(), label);
      await sleep(1200);
      await checkFrame(`progress sub-nav "${label}" ${at}`);
    }
    const current = await page.evaluate(() => document.querySelector('.progress-subnav a[aria-current="true"]')?.textContent);
    if (current !== "History") {
      totalFailures += 1;
      console.error(`FAIL: progress ${at}: "${current}" is current after a click on "History"`);
    }
    if (vp.width === VIEWPORTS[0].width) {
      await page.evaluate(() => document.getElementById("history")?.scrollIntoView());
      await sleep(300);
      await checkFrame(`progress raw scrollIntoView on #history ${at}`);
    }
    await page.goto(`${BASE}/?fixture=progress&theme=dark#history`, { waitUntil: "networkidle0" });
    await sleep(800);
    await checkFrame(`progress#history ${at}`);
    await page.goto(`${BASE}/?fixture=settings&theme=dark#folder`, { waitUntil: "networkidle0" });
    await sleep(1200);
    await checkFrame(`settings#folder ${at}`);
  }

  // On a phone the board or code shows above a chat strip, and the "chat" option of the Room view gives the chat the screen.
  const logHeightNow = () => page.evaluate(() => document.querySelector('[role="log"]')?.getBoundingClientRect().height ?? 0);
  for (const name of ["room-hld", "room-lld"]) {
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(`${BASE}/?fixture=${name}&theme=dark`, { waitUntil: "networkidle0" });
    await sleep(350);
    const stripHeight = await logHeightNow();
    if (stripHeight < 80) {
      totalFailures += 1;
      console.error(`FAIL: ${name} @ 390x844: the chat strip under the work area is ${Math.round(stripHeight)}px tall, under 80px`);
    } else {
      console.log(`PASS: ${name} @ 390x844: chat strip ${Math.round(stripHeight)}px tall`);
    }
    await page.evaluate(() => [...document.querySelectorAll('[role="radio"]')].find((el) => /chat$/.test(el.textContent ?? ""))?.click());
    await sleep(350);
    const logHeight = await logHeightNow();
    if (logHeight < 120) {
      totalFailures += 1;
      console.error(`FAIL: ${name} @ 390x844: the message list is ${Math.round(logHeight)}px tall, under 120px`);
    } else {
      console.log(`PASS: ${name} @ 390x844: message list ${Math.round(logHeight)}px tall`);
    }
  }

  // The symptoms the phone and tablet widths showed: a header box over a tab, a clipped week, one-letter plan cells, cut skill names.
  const fail = (message) => {
    totalFailures += 1;
    console.error(`FAIL: ${message}`);
  };
  // The skip link is screen-reader text until it takes focus; then its own top and left place it, not the pin that
  // keeps hidden text inside its box.
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${BASE}/?theme=dark`, { waitUntil: "networkidle0" });
  await sleep(350);
  const skip = await page.evaluate(() => {
    const a = [...document.querySelectorAll("a")].find((el) => /Skip to main content/.test(el.textContent ?? ""));
    if (!a) return null;
    a.focus();
    const r = a.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width };
  });
  if (!skip || skip.left !== 12 || skip.top !== 12 || skip.width < 40) fail(`skip link on focus sits at ${JSON.stringify(skip)}, not 12px in`);
  else console.log("PASS: the skip link shows 12px in from the corner on focus");

  for (const width of [640, 768, 1024]) {
    await page.setViewport({ width, height: 900 });
    await page.goto(`${BASE}/?fixture=home&theme=dark`, { waitUntil: "networkidle0" });
    await sleep(350);
    const overlap = await page.evaluate(() => {
      const jump = [...document.querySelectorAll("header button")].find((b) => /Jump to/.test(b.textContent ?? ""))?.getBoundingClientRect();
      if (!jump) return "no Jump box";
      for (const a of document.querySelectorAll('header nav[aria-label="Main"] a')) {
        const r = a.getBoundingClientRect();
        if (r.right > jump.left && r.left < jump.right) return `"${a.textContent}" runs under the Jump box`;
      }
      return "";
    });
    if (overlap) fail(`header @ ${width}px: ${overlap}`);
    else console.log(`PASS: header tabs clear of the Jump box @ ${width}px`);
  }

  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${BASE}/?fixture=home&theme=dark`, { waitUntil: "networkidle0" });
  await sleep(350);
  const week = await page.evaluate(() =>
    [...document.querySelectorAll('ol[aria-label="This week\'s plan"] > li')].map((li) => {
      const r = li.getBoundingClientRect();
      return { left: r.left, right: r.right };
    }),
  );
  if (week.length !== 7 || week.some((c) => c.left < 0 || c.right > 390)) fail(`today @ 390px: the week strip shows ${week.length} cells and some leave the screen`);
  else console.log("PASS: today @ 390px: the whole week fits the screen");

  await page.goto(`${BASE}/?fixture=settings&theme=dark`, { waitUntil: "networkidle0" });
  await sleep(350);
  const planWidths = await page.evaluate(() =>
    [...([...document.querySelectorAll("span")].find((el) => el.textContent === "Mon")?.parentElement?.parentElement?.children ?? [])].map(
      (el) => el.getBoundingClientRect().width,
    ),
  );
  if (planWidths.length !== 7 || planWidths.some((w) => w < 90))
    fail(`settings @ 390px: the weekly plan has ${planWidths.length} cells, ${planWidths.map(Math.round).join(", ")}px wide, under 90px`);
  else console.log("PASS: settings @ 390px: the weekly plan is readable");

  for (const width of [390, 768, 1024]) {
    await page.setViewport({ width, height: 900 });
    await page.goto(`${BASE}/?fixture=debrief-hld&theme=dark`, { waitUntil: "networkidle0" });
    await sleep(500);
    const cut = await page.evaluate(() =>
      [...document.querySelectorAll('[role="group"][aria-label="Scores by dimension"] button > span:first-child')]
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => el.textContent),
    );
    if (cut.length > 0) fail(`debrief @ ${width}px: skill names are cut: ${cut.join(", ")}`);
    else console.log(`PASS: debrief @ ${width}px: skill names are whole`);
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
