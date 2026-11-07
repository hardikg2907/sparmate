// End-to-end check of pausing and discarding with the fake model driver (SPARMATE_FAKE_AGENT=1).
//
//   PORT=4758 node scripts/e2e/ws-fake-pause.mjs     port from 4750 to 4759; 4758 when PORT is unset
//   node scripts/e2e/ws-fake-pause.mjs --keep        keeps the temp folder for inspection
//
// It starts the server against a temp copy of the study folder with SPARMATE_AWAY_MS shortened to a few seconds, then
// checks: a user pause and resume in both modes, the automatic "away" pause (and that a quick reconnect cancels
// it), discard over the WebSocket and over REST with the session folder gone afterwards, and what a discard does
// to an LLD attempt file. The real study folder is only read.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { KIT_DIR, copyStudyKit } from "../lib/tempStudy.mjs";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = Number(process.env.PORT ?? 4758);
if (!(PORT >= 4750 && PORT <= 4759)) throw new Error("Use a port from 4750 to 4759");
const KEEP = process.argv.includes("--keep");
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = BASE;
const AWAY_MS = 2_000;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  process.stdout.write(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}\n`);
  return Boolean(ok);
}
const sha = (data) => createHash("sha256").update(data).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (path) =>
  stat(path).then(
    () => true,
    () => false,
  );
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ---------------------------------------------------------------------------
// HTTP and WebSocket helpers

function request(method, path, { headers = {}, body } = {}) {
  return new Promise((resolvePromise, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        method,
        path,
        headers: { host: `127.0.0.1:${PORT}`, ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}), ...headers },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          let json;
          try {
            json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            json = null;
          }
          resolvePromise({ status: res.statusCode, json });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let TOKEN = "";
const good = () => ({ origin: ORIGIN, "x-csrf-token": TOKEN });
const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, { headers: good(), body }),
  del: (path, headers = good()) => request("DELETE", path, { headers }),
};

class Client {
  constructor(name) {
    this.name = name;
    this.msgs = [];
    this.listeners = new Set();
    this.closeInfo = null;
  }

  connect(sessionId) {
    return new Promise((resolvePromise, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/session/${sessionId}`, { origin: ORIGIN });
      this.ws = ws;
      ws.on("open", () => resolvePromise(this));
      ws.on("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      ws.on("error", (err) => reject(err));
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString("utf8"));
        this.msgs.push(msg);
        for (const l of [...this.listeners]) l();
      });
      ws.on("close", (code, reason) => {
        this.closeInfo = { code, reason: reason.toString() };
        for (const l of [...this.listeners]) l();
      });
    });
  }

  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }

  mark() {
    return this.msgs.length;
  }

  waitFor(pred, { since = 0, timeout = 15_000, label = "a message" } = {}) {
    return new Promise((resolvePromise, reject) => {
      let timer = null;
      const cleanup = () => {
        clearTimeout(timer);
        this.listeners.delete(scan);
      };
      const scan = () => {
        for (let i = since; i < this.msgs.length; i++) {
          if (pred(this.msgs[i])) {
            cleanup();
            resolvePromise(this.msgs[i]);
            return true;
          }
        }
        if (this.closeInfo) {
          cleanup();
          reject(new Error(`socket closed (${this.closeInfo.code}) while waiting for ${label}`));
          return true;
        }
        return false;
      };
      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`timed out waiting for ${label}`));
      }, timeout);
      if (!scan()) this.listeners.add(scan);
    });
  }

  waitClose(timeout = 8_000) {
    return new Promise((resolvePromise) => {
      if (this.closeInfo) return resolvePromise(this.closeInfo);
      const timer = setTimeout(() => resolvePromise(null), timeout);
      const l = () => {
        if (!this.closeInfo) return;
        clearTimeout(timer);
        this.listeners.delete(l);
        resolvePromise(this.closeInfo);
      };
      this.listeners.add(l);
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // already closed
    }
  }
}

async function openRoom(sessionId, name) {
  const c = new Client(name);
  await c.connect(sessionId);
  c.send({ type: "hello", token: TOKEN });
  await c.waitFor((m) => m.type === "session.state", { label: `${name} session.state` });
  return c;
}

const isInterviewerMsg = (m) => m.type === "chat.message" && m.entry.channel === "interview" && m.entry.role === "interviewer";

async function say(c, text, id) {
  const mark = c.mark();
  c.send({ type: "chat.send", channel: "interview", clientMsgId: id, text });
  return c.waitFor(isInterviewerMsg, { since: mark, label: `reply to ${id}` });
}

async function pollSession(id, pred, { timeout = 12_000, every = 100 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const res = await api.get(`/api/sessions/${id}`);
    if (pred(res)) return res;
    if (Date.now() > end) return null;
    await sleep(every);
  }
}

// ---------------------------------------------------------------------------
// Server process

async function prepare() {
  const root = await mkdtemp(join(tmpdir(), "ir-e2e-pause-"));
  const study = join(root, "study");
  const data = join(root, "data");
  await mkdir(join(study, "lld"), { recursive: true });
  await mkdir(data, { recursive: true });
  await copyStudyKit(study);
  await writeFile(join(root, "claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "test.person@examplecorp.dev" } }));
  await writeFile(join(root, "denylist.txt"), "secretterm\n");
  return { root, study, data };
}

function startServer(dirs) {
  const child = spawn(process.execPath, [join(APP, "node_modules", "tsx", "dist", "cli.mjs"), join(APP, "src", "server", "index.ts")], {
    cwd: APP,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      SPARMATE_FAKE_AGENT: "1",
      SPARMATE_AWAY_MS: String(AWAY_MS),
      PORT: String(PORT),
      STUDY_ROOT: dirs.study,
      DATA_DIR: dirs.data,
      SPARMATE_CLAUDE_JSON: join(dirs.root, "claude.json"),
      SPARMATE_DENYLIST: join(dirs.root, "denylist.txt"),
    },
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  return { child, output: () => output };
}

async function waitForServer(server) {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await request("GET", "/api/bootstrap");
      if (res.status === 200) return res;
    } catch {
      // not listening yet
    }
    if (server.child.exitCode !== null) throw new Error(`server exited:\n${server.output()}`);
    await sleep(250);
  }
  throw new Error(`server did not start:\n${server.output()}`);
}

async function stopServer(server) {
  if (server.child.exitCode !== null) return;
  try {
    process.kill(-server.child.pid, "SIGTERM");
  } catch {
    return;
  }
  for (let i = 0; i < 40 && server.child.exitCode === null; i++) await sleep(125);
  if (server.child.exitCode === null) {
    try {
      process.kill(-server.child.pid, "SIGKILL");
    } catch {
      // gone
    }
  }
}

// ---------------------------------------------------------------------------
// Scenarios

async function userPause(mode) {
  const created = await api.post("/api/sessions", { problemId: "c2-url-shortener", mode });
  const id = created.json.sessionId;
  const c = await openRoom(id, `${mode}-pause`);
  await c.waitFor(isInterviewerMsg, { label: "opening line" });

  let mark = c.mark();
  c.send({ type: "session.pause" });
  const paused = await c.waitFor((m) => m.type === "session.state" && m.session.status === "paused", { since: mark, label: "paused state" });
  check(
    `${mode} round: pause stops the clock with reason "user"`,
    paused.session.pauseReason === "user" && paused.session.pauseStartedAt !== null,
    String(paused.session.pauseReason),
  );

  mark = c.mark();
  c.send({ type: "chat.send", channel: "interview", clientMsgId: "p1", text: "anyone there?" });
  const refused = await c.waitFor((m) => m.type === "error", { since: mark, label: "chat refused" });
  check(`${mode} round: chat is refused while paused`, refused.code === "paused" && /resume/i.test(refused.message), refused.message);

  // Longer than the away window: a user pause must not turn into anything else, with the socket still open.
  await sleep(AWAY_MS + 800);
  const still = await api.get(`/api/sessions/${id}`);
  check(`${mode} round: stays paused with reason "user"`, still.json.status === "paused" && still.json.pauseReason === "user", `${still.json.status}/${still.json.pauseReason}`);

  mark = c.mark();
  c.send({ type: "session.resume" });
  const live = await c.waitFor((m) => m.type === "session.state" && m.session.status === "live", { since: mark, label: "live again" });
  check(
    `${mode} round: resume clears the reason and adds the pause to pausedMs`,
    live.session.pauseReason === null && live.session.pauseStartedAt === null && live.session.pausedMs >= AWAY_MS,
    `${live.session.pausedMs} ms`,
  );
  const reply = await say(c, "Back again. Let me start with requirements.", "p2");
  check(`${mode} round: the interviewer answers after resume`, reply.entry.text.length > 0);
  c.close();
}

async function awayPause() {
  const created = await api.post("/api/sessions", { problemId: "c2-url-shortener", mode: "interview" });
  const id = created.json.sessionId;
  const c = await openRoom(id, "away");
  await c.waitFor(isInterviewerMsg, { label: "opening line" });

  c.close();
  await c.waitClose();
  await sleep(AWAY_MS / 3);
  const early = await api.get(`/api/sessions/${id}`);
  check("a round with no socket is still live before the window ends", early.json.status === "live", early.json.status);

  const settled = await pollSession(id, (r) => r.json?.status === "paused");
  check(
    'a round left with no socket becomes paused with reason "away"',
    settled?.json.status === "paused" && settled.json.pauseReason === "away",
    `${settled?.json.status}/${settled?.json.pauseReason}`,
  );

  const back = await openRoom(id, "away-return");
  const state = back.msgs.find((m) => m.type === "session.state");
  check("a returning socket sees the pause and its reason", state.session.status === "paused" && state.session.pauseReason === "away");
  await sleep(AWAY_MS + 500);
  const still = await api.get(`/api/sessions/${id}`);
  check("coming back does not resume the round by itself", still.json.status === "paused" && still.json.pauseReason === "away", `${still.json.status}/${still.json.pauseReason}`);
  const mark = back.mark();
  back.send({ type: "session.resume" });
  const live = await back.waitFor((m) => m.type === "session.state" && m.session.status === "live", { since: mark, label: "resumed after away" });
  check("resume after an away pause clears the reason", live.session.pauseReason === null && live.session.pausedMs > 0);
  const reply = await say(back, "Right, requirements first.", "a1");
  check("the interviewer answers after an away pause", reply.entry.text.length > 0);

  // A reconnect inside the window cancels the timer.
  back.close();
  await back.waitClose();
  await sleep(AWAY_MS / 4);
  const again = await openRoom(id, "away-quick-return");
  await sleep(AWAY_MS * 2);
  const live2 = await api.get(`/api/sessions/${id}`);
  check(
    "a socket that reconnects inside the window keeps the round live",
    live2.json.status === "live" && live2.json.pauseReason === null,
    `${live2.json.status}/${live2.json.pauseReason}`,
  );
  again.close();
}

async function discardOverWs(dirs) {
  const created = await api.post("/api/sessions", { problemId: "c2-url-shortener", mode: "interview" });
  const id = created.json.sessionId;
  const dir = join(dirs.data, "sessions", id);
  check("the session folder exists before the discard", await exists(dir));
  const first = await openRoom(id, "discard-ws-1");
  const second = await openRoom(id, "discard-ws-2");
  await first.waitFor(isInterviewerMsg, { label: "opening line" });

  first.send({ type: "session.discard" });
  await first.waitFor((m) => m.type === "session.discarded", { label: "discarded on the first socket" });
  await second.waitFor((m) => m.type === "session.discarded", { label: "discarded on the second socket" });
  check("discard over the WebSocket reaches every socket on the session", true);
  const [c1, c2] = await Promise.all([first.waitClose(), second.waitClose()]);
  check("and closes them with the not-found code", c1?.code === 4404 && c2?.code === 4404, `${c1?.code} ${c2?.code}`);
  check("the session folder is gone", !(await exists(dir)));
  const gone = await api.get(`/api/sessions/${id}`);
  const history = await api.get("/api/sessions");
  check("the round no longer loads or appears in the history", gone.status === 404 && !history.json.some((h) => h.id === id), `status ${gone.status}`);
  const late = new Client("discard-late");
  await late.connect(id);
  late.send({ type: "hello", token: TOKEN });
  const closed = await late.waitClose();
  check("a socket opened afterwards is refused", closed?.code === 4404, JSON.stringify(closed));
}

async function discardOverRest(dirs) {
  const created = await api.post("/api/sessions", { problemId: "c2-url-shortener", mode: "interview" });
  const id = created.json.sessionId;
  const dir = join(dirs.data, "sessions", id);
  const c = await openRoom(id, "discard-rest");
  await c.waitFor(isInterviewerMsg, { label: "opening line" });

  const noOrigin = await api.del(`/api/sessions/${id}`, { "x-csrf-token": TOKEN });
  const foreign = await api.del(`/api/sessions/${id}`, { origin: "http://evil.example", "x-csrf-token": TOKEN });
  const noToken = await api.del(`/api/sessions/${id}`, { origin: ORIGIN });
  const badToken = await api.del(`/api/sessions/${id}`, { origin: ORIGIN, "x-csrf-token": "z".repeat(43) });
  const badHost = await api.del(`/api/sessions/${id}`, { ...good(), host: "attacker.example" });
  check(
    "DELETE without Origin, with a foreign Origin, or with a bad token is refused with 403",
    [noOrigin, foreign, noToken, badToken].every((r) => r.status === 403),
    [noOrigin, foreign, noToken, badToken].map((r) => r.status).join(","),
  );
  check("DELETE with a foreign Host gets 421", badHost.status === 421, `status ${badHost.status}`);
  const badId = await api.del("/api/sessions/not-a-session-id");
  const traversal = await api.del("/api/sessions/..%2F..%2Fsettings.json");
  const unknown = await api.del("/api/sessions/20200101-0000-c2-url-shortener-zzzz");
  check("an invalid or unknown id gets 404", badId.status === 404 && traversal.status === 404 && unknown.status === 404, `${badId.status},${traversal.status},${unknown.status}`);
  check("the round survives every refused request", await exists(dir));

  const ok = await api.del(`/api/sessions/${id}`);
  check("DELETE with Origin and token succeeds", ok.status === 200 && ok.json?.ok === true, JSON.stringify(ok.json));
  await c.waitFor((m) => m.type === "session.discarded", { label: "discarded after REST delete" });
  const closed = await c.waitClose();
  check("the open socket hears about it and is closed", closed?.code === 4404, JSON.stringify(closed));
  check("the session folder is gone after REST delete", !(await exists(dir)));
  const again = await api.del(`/api/sessions/${id}`);
  check("deleting it again gets 404", again.status === 404, `status ${again.status}`);
}

async function discardLld(dirs) {
  const header = `// Parking Lot — ${today()}`;
  // Header only: the attempt file goes with the round.
  const a = await api.post("/api/sessions", { problemId: "b3-parking-lot", mode: "interview" });
  const aId = a.json.sessionId;
  const aState = await api.get(`/api/sessions/${aId}`);
  const aFile = join(dirs.study, aState.json.code.path);
  check("a new LLD round starts with a header-only attempt file", (await readFile(aFile, "utf8")).trim() === header);
  const ca = await openRoom(aId, "lld-discard-a");
  ca.send({ type: "session.discard" });
  await ca.waitFor((m) => m.type === "session.discarded", { label: "LLD discarded" });
  check("discarding removes a header-only attempt file", !(await exists(aFile)));
  check("the problem's folder under lld/ is left in place", await exists(join(dirs.study, "lld", "parking-lot")));

  // Code in the file: it stays.
  const b = await api.post("/api/sessions", { problemId: "b3-parking-lot", mode: "interview" });
  const bId = b.json.sessionId;
  const bState = await api.get(`/api/sessions/${bId}`);
  const bFile = join(dirs.study, bState.json.code.path);
  const cb = await openRoom(bId, "lld-discard-b");
  const code = `${header}\nint main() { return 0; }\n`;
  cb.send({ type: "code.update", version: 1, content: code });
  cb.send({ type: "session.discard" });
  await cb.waitFor((m) => m.type === "session.discarded", { label: "LLD with code discarded" });
  check("discarding keeps an attempt file that has code, even when the code was sent just before", (await readFile(bFile, "utf8").catch(() => null)) === code);
  check("and still deletes the round", !(await exists(join(dirs.data, "sessions", bId))));

  // Edited in an editor outside the app: it stays too.
  const c = await api.post("/api/sessions", { problemId: "b3-parking-lot", mode: "interview" });
  const cId = c.json.sessionId;
  const cState = await api.get(`/api/sessions/${cId}`);
  const cFile = join(dirs.study, cState.json.code.path);
  await writeFile(cFile, `${header}\n// my notes\n`);
  const res = await api.del(`/api/sessions/${cId}`);
  check("REST discard keeps an attempt file edited outside the app", res.status === 200 && (await readFile(cFile, "utf8")) === `${header}\n// my notes\n`);
}

// ---------------------------------------------------------------------------

async function main() {
  const trackerHash = sha(await readFile(join(KIT_DIR, "TRACKER.md")));
  const dirs = await prepare();
  process.stdout.write(`temp folder: ${dirs.root}\n`);
  const server = startServer(dirs);
  const studyBefore = {};
  try {
    const boot = await waitForServer(server);
    TOKEN = boot.json.csrfToken;
    check("server starts in fake mode", boot.json.fakeAgent === true);
    for (const f of ["TRACKER.md", "REVIEW.md"]) studyBefore[f] = sha(await readFile(join(dirs.study, f)));

    for (const [name, fn] of [
      ["interview pause", () => userPause("interview")],
      ["guided pause", () => userPause("guided")],
      ["away pause", () => awayPause()],
      ["discard over WebSocket", () => discardOverWs(dirs)],
      ["discard over REST", () => discardOverRest(dirs)],
      ["discard of LLD rounds", () => discardLld(dirs)],
    ]) {
      try {
        await fn();
      } catch (err) {
        check(`${name} finished`, false, String(err));
      }
    }

    const same = [];
    for (const f of ["TRACKER.md", "REVIEW.md"]) same.push(sha(await readFile(join(dirs.study, f))) === studyBefore[f]);
    check("TRACKER.md and REVIEW.md in the study folder were not touched by any discard", same.every(Boolean));
    const log = await readFile(join(dirs.data, "logs", "server.log"), "utf8").catch(() => "");
    check("server log holds no token and no deny-listed term", log.length > 0 && !log.includes(TOKEN) && !/secretterm|examplecorp/i.test(log));
  } finally {
    await stopServer(server);
    check("the starter kit TRACKER.md did not change", sha(await readFile(join(KIT_DIR, "TRACKER.md"))) === trackerHash);
    if (!KEEP) await rm(dirs.root, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  process.stdout.write(`\n${results.length - failed.length} passed, ${failed.length} failed\n`);
  if (failed.length > 0) {
    for (const f of failed) process.stdout.write(`  FAIL ${f.name}${f.detail ? ` — ${f.detail}` : ""}\n`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  process.stderr.write(`${err?.stack ?? err}\n`);
  process.exitCode = 1;
});
