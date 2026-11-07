// Headless Chrome smoke check of a running server: the home page renders its problem lists,
// nothing is fetched from the internet, and the console stays clean.
// Usage: node scripts/smoke-ui.mjs [url] [screenshot]
import puppeteer from "puppeteer-core";

const url = process.argv[2] ?? "http://127.0.0.1:4747/";
const shot = process.argv[3] ?? "/tmp/interview-room-smoke.png";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Excalidraw lists a CDN copy of every font as a fallback; the CSP blocks it on purpose.
const expectedNoise = (text) => text.includes("https://esm.sh/");

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-first-run"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const external = [];
const problems = [];
await page.setRequestInterception(true);
page.on("request", (req) => {
  const u = new URL(req.url());
  if (u.protocol.startsWith("http") && u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
    external.push(req.url());
    return req.abort();
  }
  return req.continue();
});
page.on("console", (msg) => {
  if ((msg.type() === "error" || msg.type() === "warning") && !expectedNoise(msg.text())) problems.push(`${msg.type()}: ${msg.text()}`);
});
page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));

await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
await page.waitForFunction(() => document.body.innerText.includes("Interview Room"), { timeout: 30000 });
const text = await page.evaluate(() => document.body.innerText);
await page.screenshot({ path: shot });
await browser.close();

const ok = external.length === 0 && problems.length === 0;
console.log(JSON.stringify({ ok, screenshot: shot, external, problems, textSample: text.slice(0, 400) }, null, 2));
process.exit(ok ? 0 : 1);
