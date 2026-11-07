// Drives headless Chrome against workspace-dev.html: board test hooks, palette keyboard use, PNG export,
// editor markers and assist features, outside edits, console states, and screenshots.
//
//   npx vite --port 5181 --strictPort &
//   node src/web/dev/check-workspace.mjs http://127.0.0.1:5181
//
// The dev server has no /excalidraw-assets/, so those requests are answered from node_modules here.
import puppeteer from "puppeteer-core";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] ?? "http://127.0.0.1:5181";
const SHOTS = process.argv[3] ?? "/tmp/ir-workspace";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), "../../../node_modules/@excalidraw/excalidraw/dist/prod");
// Set SERVE_ASSETS=0 when the server under test serves /excalidraw-assets/ itself.
const SERVE_ASSETS = process.env.SERVE_ASSETS !== "0";

const results = [];
const pageReports = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-first-run", "--no-default-browser-check"] });

async function openPage(label, query, { width = 1440, height = 900, wait = ["board", "editor"] } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  const report = { label, external: [], assetMisses: [], problems: [] };
  pageReports.push(report);
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = new URL(req.url());
    if (u.protocol.startsWith("http") && u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
      report.external.push(req.url());
      return req.abort();
    }
    if (SERVE_ASSETS && u.pathname.startsWith("/excalidraw-assets/")) {
      const file = resolve(ASSETS, decodeURIComponent(u.pathname.slice("/excalidraw-assets/".length)));
      if (file.startsWith(`${ASSETS}/`) && existsSync(file)) {
        return req.respond({ status: 200, contentType: "font/woff2", body: readFileSync(file) });
      }
      report.assetMisses.push(u.pathname);
      return req.respond({ status: 404, body: "" });
    }
    return req.continue();
  });
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") report.problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (err) => report.problems.push(`pageerror: ${err.message}`));
  await page.evaluateOnNewDocument(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI}`);
    });
  });
  await page.goto(`${BASE}/workspace-dev.html?testhooks=1&${query}`, { waitUntil: "networkidle0", timeout: 90000 });
  await page.waitForFunction(() => window.__irDev, { timeout: 30000 });
  if (wait.includes("board")) await page.waitForFunction(() => window.__irBoard, { timeout: 30000 });
  if (wait.includes("editor")) await page.waitForSelector(".monaco-editor .view-lines", { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await sleep(300);
  return page;
}

async function section(name, fn) {
  try {
    await fn();
  } catch (error) {
    check(`${name} ran to the end`, false, String(error?.stack ?? error).slice(0, 600));
  }
}

const shot = (page, name) => page.screenshot({ path: `${SHOTS}-${name}.png` });
const text = (page, selector) => page.$eval(selector, (el) => el.innerText);

function pngInfo(base64) {
  const bytes = Buffer.from(base64, "base64");
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return { isPng, bytes: bytes.length, width: isPng ? bytes.readUInt32BE(16) : 0, height: isPng ? bytes.readUInt32BE(20) : 0 };
}

// ---------------------------------------------------------------------------
// HLD board, test hooks, palette, export, throttle
await section("HLD board, hooks, palette and export", async () => {
  const page = await openPage("hld", "track=hld&view=both");

  const kinds = await page.$$eval(".ir-palette__item", (els) => els.map((el) => el.dataset.kind));
  const expectedHld = ["client", "load_balancer", "api_gateway", "service", "worker", "database", "cache", "queue", "object_storage", "cdn", "search_index", "external"];
  check("palette lists the 12 HLD kinds in order", JSON.stringify(kinds) === JSON.stringify(expectedHld), kinds);
  const labelled = await page.$$eval(".ir-palette__item", (els) => els.every((el) => el.querySelector("svg") && el.textContent.trim().length > 0));
  check("each palette item has a swatch and a label", labelled);

  await sleep(2000);
  check("loading the page emits no scene change", (await page.evaluate(() => window.__irDev.sceneLog())).length === 0);

  // Text must be measured with the real fonts: insert straight after load and compare with the loaded face.
  const fit = await page.evaluate(() => {
    const b = window.__irBoard;
    b.insertShape("class", ["Circle", "----------------------", "radius: double", "----------------------", "area(): double"].join("\n"));
    b.insertShape("external");
    b.insertShape("object_storage");
    const family = { 3: "Cascadia", 5: "Excalifont" };
    const ctx = document.createElement("canvas").getContext("2d");
    return b.elements().filter((e) => e.type === "text" && e.containerId).map((t) => {
      ctx.font = `${t.fontSize}px ${family[t.fontFamily]}`;
      const real = Math.max(...t.text.split("\n").map((line) => ctx.measureText(line).width));
      return { text: t.text.split("\n")[0], stored: Math.round(t.width), real: Math.round(real), loaded: document.fonts.check(ctx.font, t.text) };
    });
  });
  check("labels are sized with the loaded font, so nothing clips", fit.length === 3 && fit.every((f) => f.loaded && f.stored >= f.real - 1), fit);

  const ids = await page.evaluate(() => {
    const b = window.__irBoard;
    return {
      lb: b.insertShape("load_balancer", "Load balancer"),
      svc: b.insertShape("service", "API service"),
      db: b.insertShape("database", "Postgres"),
      arrow1: b.connect("Load balancer", "API service", "HTTPS"),
      arrow2: b.connect("API service", "Postgres", "SQL"),
    };
  });
  const structure = await page.evaluate((ids) => {
    const els = window.__irBoard.elements();
    const byId = new Map(els.map((e) => [e.id, e]));
    // Bound text stores its wrapped form in `text` and the typed form in `originalText`.
    const textOf = (containerId) => {
      const t = els.find((e) => e.type === "text" && e.containerId === containerId);
      return t && { id: t.id, text: t.originalText ?? t.text };
    };
    const hasBound = (shape, id, type) => (shape.boundElements ?? []).some((b) => b.id === id && b.type === type);
    const out = {};
    for (const [key, kind] of [["lb", "load_balancer"], ["svc", "service"], ["db", "database"]]) {
      const shape = byId.get(ids[key]);
      const label = textOf(shape.id);
      out[key] = { kind: shape.customData?.kind === kind, shapeType: shape.type, labelBound: Boolean(label) && hasBound(shape, label.id, "text"), label: label?.text };
    }
    const arrow1 = byId.get(ids.arrow1);
    const arrow2 = byId.get(ids.arrow2);
    out.arrow1 = {
      type: arrow1.type,
      start: arrow1.startBinding?.elementId === ids.lb,
      end: arrow1.endBinding?.elementId === ids.svc,
      shapesList: hasBound(byId.get(ids.lb), ids.arrow1, "arrow") && hasBound(byId.get(ids.svc), ids.arrow1, "arrow"),
      label: textOf(arrow1.id)?.text,
      labelListed: hasBound(arrow1, textOf(arrow1.id)?.id, "text"),
    };
    out.arrow2 = {
      type: arrow2.type,
      start: arrow2.startBinding?.elementId === ids.svc,
      end: arrow2.endBinding?.elementId === ids.db,
      shapesList: hasBound(byId.get(ids.svc), ids.arrow2, "arrow") && hasBound(byId.get(ids.db), ids.arrow2, "arrow"),
      label: textOf(arrow2.id)?.text,
      labelListed: hasBound(arrow2, textOf(arrow2.id)?.id, "text"),
    };
    // The service sits between the arrows, so it must list both.
    out.serviceListsBoth = hasBound(byId.get(ids.svc), ids.arrow1, "arrow") && hasBound(byId.get(ids.svc), ids.arrow2, "arrow");
    out.counts = { total: els.length, deleted: els.filter((e) => e.isDeleted).length, arrows: els.filter((e) => e.type === "arrow").length };
    return out;
  }, ids);
  check("shapes carry customData.kind", structure.lb.kind && structure.svc.kind && structure.db.kind, structure);
  check("shape types: diamond, rectangle, ellipse", structure.lb.shapeType === "diamond" && structure.svc.shapeType === "rectangle" && structure.db.shapeType === "ellipse");
  check("each shape has a bound label with the text given", structure.lb.labelBound && structure.svc.labelBound && structure.db.labelBound && structure.lb.label === "Load balancer" && structure.db.label === "Postgres", { lb: structure.lb, svc: structure.svc, db: structure.db });
  check("arrows bind start and end to the right shapes", structure.arrow1.start && structure.arrow1.end && structure.arrow2.start && structure.arrow2.end);
  check("shapes list their arrows in boundElements", structure.arrow1.shapesList && structure.arrow2.shapesList && structure.serviceListsBoth);
  check("arrows carry bound labels", structure.arrow1.label === "HTTPS" && structure.arrow2.label === "SQL" && structure.arrow1.labelListed && structure.arrow2.labelListed);
  check("elements() returns only non-deleted elements", structure.counts.deleted === 0 && structure.counts.arrows === 2, structure.counts);

  // Throttle: the five calls above land in one emit about 1.5 s later.
  await sleep(1900);
  let log = await page.evaluate(() => window.__irDev.sceneLog());
  check("one scene change after the burst, version 1", log.length === 1 && log[0].version === 1 && log[0].elements === structure.counts.total, log);
  await page.evaluate(() => window.__irBoard.insertShape("cache"));
  await sleep(200);
  await page.evaluate(() => window.__irBoard.insertShape("queue"));
  await sleep(1900);
  log = await page.evaluate(() => window.__irDev.sceneLog());
  check("second burst gives version 2, at least 1.5 s after the first", log.length === 2 && log[1].version === 2 && log[1].at - log[0].at >= 1450, log);

  // PNG
  const b64 = await page.evaluate(() => window.__irDev.exportPng());
  const info = pngInfo(b64);
  check("exportPng returns a PNG as bare base64", !b64.startsWith("data:") && info.isPng && info.bytes > 5000 && Math.max(info.width, info.height) <= 1568, info);

  // Keyboard on the palette
  await page.focus('.ir-palette__item[data-kind="client"]');
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  const focused = await page.evaluate(() => document.activeElement?.dataset?.kind);
  check("arrow keys move through the palette", focused === "api_gateway", focused);
  const tabStops = await page.$$eval(".ir-palette__item", (els) => els.filter((el) => el.tabIndex === 0).length);
  check("palette is one tab stop", tabStops === 1, tabStops);
  const before = await page.evaluate(() => window.__irBoard.elements().length);
  await page.keyboard.press("Enter");
  await sleep(300);
  const afterKey = await page.evaluate(() => ({ n: window.__irBoard.elements().length, kinds: window.__irBoard.elements().map((e) => e.customData?.kind).filter(Boolean), active: document.activeElement?.dataset?.kind }));
  check("Enter inserts the focused kind and keeps focus on the palette", afterKey.n === before + 2 && afterKey.kinds.includes("api_gateway") && afterKey.active === "api_gateway", afterKey);
  await page.keyboard.press("End");
  const endFocus = await page.evaluate(() => document.activeElement?.dataset?.kind);
  check("End goes to the last item", endFocus === "external", endFocus);

  // Mouse click moves focus to the canvas
  await page.click('.ir-palette__item[data-kind="worker"]');
  await sleep(300);
  const mouseFocus = await page.evaluate(() => ({ inCanvas: Boolean(document.activeElement?.closest(".excalidraw")), tag: document.activeElement?.className }));
  check("a mouse click on the palette hands focus to the canvas", mouseFocus.inCanvas, mouseFocus);
  const liveBefore = await page.evaluate(() => window.__irBoard.elements().length);
  await page.keyboard.down("Meta");
  await page.keyboard.press("z");
  await page.keyboard.up("Meta");
  await sleep(300);
  const liveAfterUndo = await page.evaluate(() => window.__irBoard.elements().length);
  check("an insert is one undo step", liveAfterUndo === liveBefore - 2, { liveBefore, liveAfterUndo });

  // Double-click edit of a default label. The newest shape sits at the canvas centre plus its shift.
  const canvasBox = await page.$eval(".ir-board__canvas-inner", (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.evaluate(() => window.__irBoard.insertShape("service", "Edit me"));
  const target = await page.evaluate(() => {
    const els = window.__irBoard.elements();
    const el = els.filter((e) => e.customData?.kind === "service").at(-1);
    return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
  });
  // The first insert of this page sat at the centre; recover the scroll from it.
  const firstCentre = await page.evaluate(() => {
    const el = window.__irBoard.elements().find((e) => e.customData?.kind);
    return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
  });
  const scroll = { x: canvasBox.w / 2 - firstCentre.x, y: canvasBox.h / 2 - firstCentre.y };
  await page.mouse.click(canvasBox.x + target.x + scroll.x, canvasBox.y + target.y + scroll.y, { count: 2 });
  await sleep(500);
  const editorOpen = await page.$(".excalidraw-textEditorContainer textarea, textarea.excalidraw-wysiwyg");
  check("double-click opens the label editor", Boolean(editorOpen));
  if (editorOpen) {
    await page.keyboard.down("Control");
    await page.keyboard.press("a");
    await page.keyboard.up("Control");
    await page.keyboard.type("Edge cache", { delay: 20 });
    await page.keyboard.press("Escape");
    await sleep(400);
    const renamed = await page.evaluate(() => window.__irBoard.elements().some((e) => e.type === "text" && e.text === "Edge cache"));
    check("the edited label is saved in the bound text", renamed);
  }
  await shot(page, "hooks-pile");
  await page.close();
});

// ---------------------------------------------------------------------------
// Editor: markers, no assist, outside edits, console
await section("editor and console", async () => {
  const page = await openPage("editor", "view=code", { wait: ["editor"] });

  const markers = await page.evaluate(() => window.__irDev.markers());
  check("three markers with owner clang and the right severities", markers.length === 3 && markers.every((m) => m.owner === "clang") && markers.map((m) => m.severity).sort().join() === "2,4,8", markers);
  const squiggles = await page.evaluate(() => ({
    error: document.querySelectorAll(".squiggly-error").length,
    warning: document.querySelectorAll(".squiggly-warning").length,
    info: document.querySelectorAll(".squiggly-info").length,
  }));
  check("squiggles are drawn for each severity", squiggles.error > 0 && squiggles.warning > 0 && squiggles.info > 0, squiggles);

  // No assist while typing. The caret goes to the empty last line, below every marker.
  await page.evaluate(() => window.__irDev.setCursor(16, 1));
  await page.keyboard.type("std::", { delay: 60 });
  await sleep(500);
  const afterScope = await page.evaluate(() => ({
    suggest: Boolean(document.querySelector(".suggest-widget.visible")),
    params: Boolean(document.querySelector(".parameter-hints-widget.visible")),
  }));
  await page.keyboard.type("vec", { delay: 60 });
  await sleep(500);
  await page.keyboard.down("Control");
  await page.keyboard.press("Space");
  await page.keyboard.up("Control");
  await sleep(500);
  await page.keyboard.type("(", { delay: 60 });
  await sleep(400);
  const afterAll = await page.evaluate(() => ({
    suggest: Boolean(document.querySelector(".suggest-widget.visible")),
    params: Boolean(document.querySelector(".parameter-hints-widget.visible")),
    ghost: Boolean(document.querySelector(".ghost-text-decoration, .ghost-text")),
    lightbulb: Boolean(document.querySelector(".codicon-light-bulb")),
  }));
  check("no suggestion widget after typing std::", !afterScope.suggest && !afterScope.params, afterScope);
  check("no suggestion, hint, ghost text or lightbulb after vec, Ctrl+Space and (", !afterAll.suggest && !afterAll.params && !afterAll.ghost && !afterAll.lightbulb, afterAll);

  // Hover is off: pointing at the error squiggle shows nothing.
  const squiggleBox = await page.$eval(".squiggly-error", (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(squiggleBox.x, squiggleBox.y);
  await sleep(900);
  const hover = await page.evaluate(() => [...document.querySelectorAll(".monaco-hover")].some((el) => getComputedStyle(el).visibility !== "hidden" && el.getBoundingClientRect().width > 0 && !el.classList.contains("hidden")));
  check("hovering a squiggle shows no hover widget", !hover);

  // The markers followed the text when a line was added below them.
  const typedMarkers = await page.evaluate(() => window.__irDev.markers());
  check("markers stay put when text is added after them", typedMarkers.map((m) => m.line).sort((a, b) => a - b).join() === "4,12,13", typedMarkers.map((m) => m.line));

  // Outside edit
  await page.evaluate(() => window.__irDev.setCursor(13, 5));
  const cursorBefore = await page.evaluate(() => window.__irDev.cursor());
  const changesBefore = await page.evaluate(() => window.__irDev.editorChanges());
  const markersBefore = await page.evaluate(() => window.__irDev.markers().map((m) => m.line).sort((a, b) => a - b));
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.startsWith("Outside edit")).click());
  await sleep(500);
  const cursorAfter = await page.evaluate(() => window.__irDev.cursor());
  const textAfter = await page.evaluate(() => window.__irDev.editorText());
  const changesAfter = await page.evaluate(() => window.__irDev.editorChanges());
  const markersAfter = await page.evaluate(() => window.__irDev.markers().map((m) => m.line).sort((a, b) => a - b));
  check("outside edit replaces the text", textAfter.startsWith("// edited outside\n#include <iostream>"), textAfter.slice(0, 60));
  check("outside edit keeps the cursor on the same code (one line down, same column)", cursorAfter.line === cursorBefore.line + 1 && cursorAfter.column === cursorBefore.column, { cursorBefore, cursorAfter });
  check("outside edit does not call onChange", changesAfter === changesBefore, { changesBefore, changesAfter });
  check("outside edit moves the markers with their code", markersAfter.every((line, i) => line === markersBefore[i] + 1), { markersBefore, markersAfter });

  // Long file: scroll position survives an outside edit.
  await page.evaluate(() => window.__irDev.setCursor(100000, 1));
  for (let i = 0; i < 45; i += 1) await page.keyboard.press("Enter");
  await page.keyboard.type("// bottom", { delay: 10 });
  await sleep(400);
  const scrolled = await page.evaluate(() => window.__irDev.cursor());
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.startsWith("Outside edit")).click());
  await sleep(500);
  const scrolledAfter = await page.evaluate(() => window.__irDev.cursor());
  check("outside edit keeps the scroll position", scrolled.scrollTop > 100 && Math.abs(scrolledAfter.scrollTop - scrolled.scrollTop) <= 24 && scrolledAfter.line === scrolled.line + 1, { scrolled, scrolledAfter });

  // Console states
  const initialConsole = await text(page, ".ir-console");
  check("console starts with a not-run state and a Run button", /Not run yet/.test(initialConsole) && /Nothing has run yet/.test(initialConsole) && /Run/.test(initialConsole), initialConsole.slice(0, 120));

  async function run(name) {
    await page.evaluate((n) => window.__irDev.pickRun(n), name);
    await sleep(100);
    await page.click(".ir-console__run");
    await sleep(150);
    const during = await page.evaluate(() => ({
      disabled: document.querySelector(".ir-console__run").getAttribute("aria-disabled") === "true",
      focusKept: document.activeElement === document.querySelector(".ir-console__run"),
      label: document.querySelector(".ir-console__run").innerText.trim(),
      status: document.querySelector(".ir-console__status").innerText,
      busy: document.querySelector(".ir-console").getAttribute("aria-busy"),
    }));
    await page.waitForFunction(() => document.querySelector(".ir-console__run").getAttribute("aria-disabled") !== "true", { timeout: 5000 });
    await sleep(150);
    return { during, out: await text(page, ".ir-console"), status: await text(page, ".ir-console__status") };
  }

  const ok = await run("success");
  check("running state marks Run disabled, keeps its focus, and says Running", ok.during.disabled && ok.during.focusKept && /Running/.test(ok.during.label) && /Running/.test(ok.during.status) && ok.during.busy === "true", ok.during);
  check("success shows exit code, duration, stdout", /Exit code 0/.test(ok.out) && /12 ms/.test(ok.out) && /Ticket 1 -> spot 7/.test(ok.out) && /Exit code 0 in 12 ms/.test(ok.status), ok.status);

  const compileFailed = await run("compileError");
  check("compile error lists diagnostics and says the program did not run", /Compile failed: 1 error, 1 warning/.test(compileFailed.status) && /use of undeclared identifier 'total'/.test(compileFailed.out) && /did not run/.test(compileFailed.out), compileFailed.status);
  await shot(page, "editor-compile-error");
  await page.click("button.ir-diag--error");
  await sleep(400);
  const jumped = await page.evaluate(() => ({ cursor: window.__irDev.cursor(), focusInEditor: Boolean(document.activeElement?.closest(".monaco-editor")) }));
  check("clicking a diagnostic puts the cursor on its line and focuses the editor", jumped.cursor.line === 13 && jumped.cursor.column === 16 && jumped.focusInEditor, jumped);

  const code3 = await run("exitCode");
  check("non-zero exit shows the code and stderr", /Exit code 3/.test(code3.out) && /stderr/.test(code3.out) && /lot is full/.test(code3.out));
  const crash = await run("crash");
  check("a crash names the signal", /Crashed with SIGSEGV/.test(crash.out) && /AddressSanitizer/.test(crash.out), crash.status);
  const timeout = await run("timeout");
  check("a timeout is stated plainly", /Timed out/.test(timeout.out) && /stopped after 5\.00 s/.test(timeout.out), timeout.status);
  const long = await run("longOutput");
  check("a cut stream gets a note", /Output was cut/.test(long.out), long.status);
  const silent = await run("silent");
  check("silent program says so", /printed nothing/.test(silent.out));
  const warnings = await run("warnings");
  check("warnings on a good compile show as Compiled with warning", /Compiled|Exit code 0/.test(warnings.out) && /unused variable/.test(warnings.out));

  await run("success");
  await shot(page, "editor-console");
  await page.close();
});

// ---------------------------------------------------------------------------
// Screenshots of the boards and the dark theme
async function pictureBoard(label, query, sampleButton, name) {
  const page = await openPage(label, query, { wait: ["board"] });
  await page.evaluate((text) => {
    window.__irBoard = undefined;
    [...document.querySelectorAll(".dev__bar button")].find((b) => b.textContent === text).click();
  }, sampleButton);
  await page.waitForFunction(() => window.__irBoard, { timeout: 20000 });
  await sleep(1200);
  await page.evaluate(() => document.fonts.ready);
  await shot(page, name);
  const count = await page.evaluate(() => window.__irBoard.elements().length);
  check(`${label}: sample scene loaded`, count > 5, count);
  await page.close();
}
await section("board screenshots", async () => {
  await pictureBoard("hld-light", "track=hld&view=board&theme=light", "Sample: request flow", "hld");
  await pictureBoard("hld-kinds-light", "track=hld&view=board&theme=light", "Sample: every kind", "kinds-light");
  await pictureBoard("hld-kinds-dark", "track=hld&view=board&theme=dark", "Sample: every kind", "kinds-dark");
  await pictureBoard("lld-light", "track=lld&view=board&theme=light", "Sample: classes", "lld");
  await pictureBoard("lld-dark", "track=lld&view=board&theme=dark", "Sample: classes", "lld-dark");
});
await section("dark theme screenshot", async () => {
  const page = await openPage("dark", "view=both&theme=dark&track=hld");
  await page.evaluate(() => {
    window.__irBoard = undefined;
    [...document.querySelectorAll(".dev__bar button")].find((b) => b.textContent === "Sample: request flow").click();
  });
  await page.waitForFunction(() => window.__irBoard, { timeout: 20000 });
  await page.evaluate(() => window.__irDev.pickRun("crash"));
  await page.click(".ir-console__run");
  await page.waitForFunction(() => document.querySelector(".ir-console__run").getAttribute("aria-disabled") !== "true", { timeout: 5000 });
  await sleep(1200);
  await shot(page, "dark");

  // A dark screen must still export light colours on white, so every reader of the image sees the same board.
  const exported = await page.evaluate(async () => {
    const b64 = await window.__irDev.exportPng();
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const corner = ctx.getImageData(2, 2, 1, 1).data;
    const all = ctx.getImageData(0, 0, img.width, img.height).data;
    let bright = 0;
    for (let i = 0; i < all.length; i += 4) if (all[i] > 240 && all[i + 1] > 240 && all[i + 2] > 240) bright += 1;
    return { b64, corner: [...corner], width: img.width, height: img.height, whiteShare: Math.round((bright / (all.length / 4)) * 100) };
  });
  writeFileSync(`${SHOTS}-export-dark.png`, Buffer.from(exported.b64, "base64"));
  check("a dark-theme export is on a white background", exported.corner.join() === "255,255,255,255" && exported.whiteShare > 40, { corner: exported.corner, size: `${exported.width}x${exported.height}`, whiteShare: exported.whiteShare });
  await page.close();
});

// ---------------------------------------------------------------------------
// Read-only board, scene round trip across a remount
await section("remount and read-only", async () => {
  const page = await openPage("readonly", "track=lld&view=board", { wait: ["board"] });
  await page.evaluate(() => {
    window.__irBoard = undefined;
    [...document.querySelectorAll(".dev__bar button")].find((b) => b.textContent === "Sample: classes").click();
  });
  await page.waitForFunction(() => window.__irBoard, { timeout: 20000 });
  await sleep(1000);
  const sampleCount = await page.evaluate(() => window.__irBoard.elements().length);
  await page.evaluate(() => window.__irBoard.insertShape("class", "Fresh"));
  await sleep(100);
  // Switching the layout unmounts the board right after a change; the pending change must still be saved.
  await page.evaluate(() => [...document.querySelectorAll(".dev__bar button")].find((b) => b.textContent === "Code").click());
  await sleep(500);
  const log = await page.evaluate(() => window.__irDev.sceneLog());
  check("leaving the board flushes the pending scene change", log.length === 1 && log[0].elements === sampleCount + 2, log);
  await page.evaluate(() => [...document.querySelectorAll(".dev__bar button")].find((b) => b.textContent === "Board").click());
  await page.waitForFunction(() => window.__irBoard, { timeout: 20000 });
  await sleep(800);
  const restored = await page.evaluate(() => window.__irBoard.elements().length);
  check("a remount restores the saved scene through initialData", restored === sampleCount + 2, { restored, sampleCount });
  const logAfter = await page.evaluate(() => window.__irDev.sceneLog());
  await sleep(1800);
  const logLater = await page.evaluate(() => window.__irDev.sceneLog());
  check("restoring a scene does not emit a change", logAfter.length === logLater.length, { logAfter: logAfter.length, logLater: logLater.length });
  await page.evaluate(() => [...document.querySelectorAll("label")].find((l) => l.textContent.includes("Read-only")).querySelector("input").click());
  await sleep(500);
  const roPalette = await page.$(".ir-palette");
  check("read-only hides the palette", roPalette === null);
  await shot(page, "readonly");
  await page.close();
});

// ---------------------------------------------------------------------------
// LLD palette: relation presets bind to the selected shapes
await section("LLD relations", async () => {
  const page = await openPage("lld-ui", "track=lld&view=board", { wait: ["board"] });
  const kinds = await page.$$eval(".ir-palette__item", (els) => els.map((el) => el.dataset.kind));
  check("LLD palette lists classes and relations", JSON.stringify(kinds) === JSON.stringify(["class", "interface", "enum", "inherits", "implements", "owns", "uses"]), kinds);

  const box = await page.$eval(".ir-board__canvas-inner", (el) => {
    const r = el.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });
  await page.click('.ir-palette__item[data-kind="class"]');
  await page.click('.ir-palette__item[data-kind="interface"]');
  await sleep(300);
  const shapes = await page.evaluate(() => {
    const els = window.__irBoard.elements();
    const pick = (kind) => els.find((e) => e.customData?.kind === kind);
    const cls = pick("class");
    const iface = pick("interface");
    return { cls: cls.id, iface: iface.id, labelBoundOnClass: els.some((e) => e.type === "text" && e.containerId === cls.id && e.text.includes("ClassName")) };
  });
  check("class and interface land with their three-part labels", shapes.labelBoundOnClass);

  const arrowsOf = (kind) =>
    page.evaluate((k) => {
      const els = window.__irBoard.elements();
      return els
        .filter((e) => e.type === "arrow" && e.customData?.kind === k)
        .map((a) => ({
          id: a.id,
          start: a.startBinding?.elementId ?? null,
          end: a.endBinding?.elementId ?? null,
          strokeStyle: a.strokeStyle,
          startArrowhead: a.startArrowhead,
          endArrowhead: a.endArrowhead,
          label: els.find((t) => t.type === "text" && t.containerId === a.id)?.text ?? null,
        }));
    }, kind);

  // Two shapes picked in order: class first, interface second.
  await page.mouse.click(box.cx - 110, box.cy);
  await page.keyboard.down("Shift");
  await page.mouse.click(box.cx + 140, box.cy + 40);
  await page.keyboard.up("Shift");
  await page.click('.ir-palette__item[data-kind="inherits"]');
  await sleep(300);
  const inherits = await arrowsOf("inherits");
  check("inherits joins the first selected shape to the second", inherits.length === 1 && inherits[0].start === shapes.cls && inherits[0].end === shapes.iface, inherits);
  check("inherits is a solid line with a hollow triangle and its label", inherits[0]?.strokeStyle === "solid" && inherits[0]?.endArrowhead === "triangle_outline" && inherits[0]?.label === "inherits", inherits[0]);
  const listed = await page.evaluate((ids) => {
    const els = window.__irBoard.elements();
    const has = (id, arrowId) => (els.find((e) => e.id === id).boundElements ?? []).some((b) => b.id === arrowId && b.type === "arrow");
    const arrow = els.find((e) => e.type === "arrow" && e.customData?.kind === "inherits");
    return has(ids.cls, arrow.id) && has(ids.iface, arrow.id);
  }, shapes);
  check("both shapes list the relation arrow", listed);

  // Nothing selected: a free arrow at the centre, unbound.
  await page.mouse.click(box.cx - 330, box.cy - 250);
  await page.click('.ir-palette__item[data-kind="uses"]');
  await sleep(300);
  const uses = await arrowsOf("uses");
  check("with nothing selected, uses is a free dashed arrow with its label", uses.length === 1 && uses[0].start === null && uses[0].end === null && uses[0].strokeStyle === "dashed" && uses[0].label === "uses", uses);

  // One shape selected: bound at the start, free at the end.
  await page.mouse.click(box.cx - 110, box.cy);
  await page.click('.ir-palette__item[data-kind="owns"]');
  await sleep(300);
  const owns = await arrowsOf("owns");
  check("with one shape selected, owns starts on it and ends free, diamond first", owns.length === 1 && owns[0].start === shapes.cls && owns[0].end === null && owns[0].startArrowhead === "diamond" && owns[0].label === "owns", owns);

  // Moving a bound shape drags its arrow end with it (Excalidraw's own binding takes over).
  const before = await page.evaluate((id) => {
    const els = window.__irBoard.elements();
    const arrow = els.find((e) => e.type === "arrow" && e.customData?.kind === "inherits");
    return { x: arrow.x, y: arrow.y, w: arrow.width, h: arrow.height };
  });
  await page.mouse.click(box.cx - 110, box.cy);
  await page.mouse.move(box.cx - 110, box.cy);
  await page.mouse.down();
  await page.mouse.move(box.cx - 210, box.cy + 80, { steps: 6 });
  await page.mouse.up();
  await sleep(400);
  const after = await page.evaluate(() => {
    const els = window.__irBoard.elements();
    const arrow = els.find((e) => e.type === "arrow" && e.customData?.kind === "inherits");
    return { x: arrow.x, y: arrow.y, w: arrow.width, h: arrow.height };
  });
  check("a bound arrow follows when its shape is dragged", JSON.stringify(before) !== JSON.stringify(after), { before, after });
  await shot(page, "lld-ui");
  await page.close();
});

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results, pages: pageReports }, null, 2));
process.exit(failed.length > 0 ? 1 : 0);
