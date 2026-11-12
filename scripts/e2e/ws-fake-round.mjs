// End-to-end check of the engine with the fake model driver (SPARMATE_FAKE_AGENT=1).
//
//   node scripts/e2e/ws-fake-round.mjs            uses PORT (4750-4799, not 4780), or a free port in that range when PORT is unset
//   node scripts/e2e/ws-fake-round.mjs --keep     keeps the temp folder for inspection
//
// It copies TRACKER.md, REVIEW.md, TEACHING.md, notes/ and lld/compile_flags.txt from the study folder into a
// fresh temp folder, starts the server against that copy, drives an HLD round, an LLD round and a short guided
// round over the WebSocket, drafts and applies the study notes, and checks the files changed exactly as planned.
// The real study folder is only read, and its TRACKER.md hash is compared before and after.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyPatch } from "diff";
import WebSocket from "ws";
import { pickFreePort } from "../lib/freePort.mjs";
import { KIT_DIR, copyStudyKit } from "../lib/tempStudy.mjs";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = process.env.PORT ? Number(process.env.PORT) : await pickFreePort();
const TARGET_EXISTING = Boolean(process.env.TARGET_EXISTING || process.env.NO_SPAWN_SERVER);
// 4780 belongs to the container check, which points this script at its already running server.
if (!(PORT >= 4750 && PORT <= 4799) || (PORT === 4780 && !TARGET_EXISTING)) throw new Error("Use a port from 4750 to 4799, except 4780");
const KEEP = process.argv.includes("--keep");
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = BASE;
// A real 1x1 PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  process.stdout.write(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}\n`);
  return Boolean(ok);
}
const sha = (text) => createHash("sha256").update(text).digest("hex");
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
          const buf = Buffer.concat(chunks);
          let json;
          try {
            json = JSON.parse(buf.toString("utf8"));
          } catch {
            json = null;
          }
          resolvePromise({ status: res.statusCode, headers: res.headers, buf, json });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let TOKEN = "";
const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, { headers: { origin: ORIGIN, "x-csrf-token": TOKEN }, body }),
  delete: (path) => request("DELETE", path, { headers: { origin: ORIGIN, "x-csrf-token": TOKEN } }),
};

class Client {
  constructor(name) {
    this.name = name;
    this.msgs = [];
    this.listeners = new Set();
    this.autoPng = true;
    this.closeInfo = null;
  }

  connect(sessionId, { origin = ORIGIN } = {}) {
    return new Promise((resolvePromise, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/session/${sessionId}`, { origin, maxPayload: 32 * 1024 * 1024 });
      this.ws = ws;
      ws.on("open", () => resolvePromise(this));
      ws.on("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      ws.on("error", (err) => reject(err));
      ws.on("message", (data) => this.onMessage(JSON.parse(data.toString("utf8"))));
      ws.on("close", (code, reason) => {
        this.closeInfo = { code, reason: reason.toString() };
        for (const l of [...this.listeners]) l();
      });
    });
  }

  onMessage(msg) {
    this.msgs.push(msg);
    if (msg.type === "board.png.request" && this.autoPng) this.send({ type: "board.png.result", requestId: msg.requestId, pngBase64: PNG, error: null });
    for (const l of [...this.listeners]) l();
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
  const echo = await c.waitFor((m) => m.type === "chat.message" && m.clientMsgId === id, { since: mark, label: `echo of ${id}` });
  const reply = await c.waitFor(isInterviewerMsg, { since: mark, label: `reply to ${id}` });
  const deltas = c.msgs.slice(mark).filter((m) => m.type === "chat.delta" && m.messageId === reply.entry.id);
  return { echo, reply, deltas, mark };
}

async function runDebrief(c, label) {
  const mark = c.mark();
  c.send({ type: "session.end" });
  const ready = await c.waitFor((m) => m.type === "debrief.ready", { since: mark, timeout: 60_000, label: `${label} debrief.ready` });
  const stages = c.msgs
    .slice(mark)
    .filter((m) => m.type === "debrief.progress")
    .map((m) => m.stage);
  const state = await c.waitFor((m) => m.type === "session.state" && m.session.status === "debriefed", { since: mark, timeout: 10_000, label: `${label} debriefed state` });
  return { scorecard: ready.scorecard, stages, state: state.session, mark };
}

async function bookkeeping(c, studyRoot, label) {
  let mark = c.mark();
  c.send({ type: "bookkeeping.draft" });
  const { proposal } = await c.waitFor((m) => m.type === "bookkeeping.proposal", { since: mark, timeout: 30_000, label: `${label} proposal` });
  const before = {};
  for (const { file } of proposal.diffs) before[file] = await readFile(join(studyRoot, file), "utf8").catch(() => null);
  const opIds = proposal.ops.filter((o) => !o.blocked).map((o) => o.id);
  mark = c.mark();
  c.send({ type: "bookkeeping.apply", proposalId: proposal.id, opIds });
  const applied = await c.waitFor((m) => m.type === "bookkeeping.applied", { since: mark, timeout: 20_000, label: `${label} applied` });
  let exact = true;
  const mismatches = [];
  for (const { file, diff } of proposal.diffs) {
    const expected = applyPatch(before[file] ?? "", diff);
    const actual = await readFile(join(studyRoot, file), "utf8").catch(() => null);
    if (expected === false || expected !== actual) {
      exact = false;
      mismatches.push(file);
    }
  }
  return { proposal, applied, exact, mismatches, opIds };
}

// ---------------------------------------------------------------------------
// Scenes and code

function scene() {
  const base = { angle: 0, isDeleted: false, groupIds: [], frameId: null, strokeStyle: "solid", fillStyle: "solid", roughness: 1, opacity: 100, version: 1 };
  return [
    {
      ...base,
      id: "lb",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 180,
      height: 70,
      boundElements: [
        { id: "lb-t", type: "text" },
        { id: "a1", type: "arrow" },
      ],
      customData: { kind: "load_balancer" },
    },
    { ...base, id: "lb-t", type: "text", x: 20, y: 25, width: 140, height: 20, containerId: "lb", text: "Load balancer", originalText: "Load balancer" },
    {
      ...base,
      id: "svc",
      type: "rectangle",
      x: 320,
      y: 0,
      width: 180,
      height: 70,
      boundElements: [
        { id: "svc-t", type: "text" },
        { id: "a1", type: "arrow" },
      ],
      customData: { kind: "service" },
    },
    { ...base, id: "svc-t", type: "text", x: 340, y: 25, width: 140, height: 20, containerId: "svc", text: "Redirect service", originalText: "Redirect service" },
    {
      ...base,
      id: "a1",
      type: "arrow",
      x: 180,
      y: 35,
      width: 140,
      height: 0,
      points: [
        [0, 0],
        [140, 0],
      ],
      startBinding: { elementId: "lb", focus: 0, gap: 1 },
      endBinding: { elementId: "svc", focus: 0, gap: 1 },
      startArrowhead: null,
      endArrowhead: "arrow",
      boundElements: [],
    },
  ];
}

/** The same boxes laid out the way the room does it: one frame per step, a requirement written in its frame. */
function framedScene() {
  const base = { angle: 0, isDeleted: false, groupIds: [], frameId: null, strokeStyle: "solid", fillStyle: "solid", roughness: 1, opacity: 100, version: 1 };
  const frame = (id, step, name, x, y, width, height) => ({ ...base, id, type: "frame", name, x, y, width, height, customData: { step } });
  return [
    frame("f-req", "requirements", "Requirements", 40, 40, 760, 440),
    frame("f-design", "design", "High-level design", 40, 540, 1560, 820),
    { ...base, id: "r1", type: "text", x: 80, y: 100, width: 300, height: 25, text: "Read heavy with viral spikes", originalText: "Read heavy with viral spikes" },
    ...scene().map((el) => ("x" in el ? { ...el, x: el.x + 100, y: el.y + 700 } : el)),
    // A box with no label, so a check of the design step asks for the frame image as well as the text.
    { ...base, id: "blank", type: "ellipse", x: 900, y: 900, width: 120, height: 60 },
  ];
}

const CPP_V1 = (header) => `${header}
#include <iostream>
#include <optional>
#include <vector>

enum class VehicleType { MOTORCYCLE, CAR, TRUCK };

struct Spot {
  int id;
  VehicleType size;
  bool taken = false;
};

class ParkingLot {
  std::vector<Spot> spots;

 public:
  explicit ParkingLot(std::vector<Spot> s) : spots(std::move(s)) {}
  std::optional<int> enter(VehicleType type) {
    for (auto& spot : spots) {
      if (!spot.taken && spot.size >= type) {
        spot.taken = true;
        return spot.id;
      }
    }
    return std::nullopt;
  }
};

int main() {
  ParkingLot lot({{0, VehicleType::MOTORCYCLE}, {1, VehicleType::CAR}, {2, VehicleType::TRUCK}});
  auto a = lot.enter(VehicleType::CAR);
  std::cout << "car got spot " << (a ? *a : -1) << "\\n";
  return 0;
}
`;

// ---------------------------------------------------------------------------
// Server process

async function prepare() {
  if (process.env.STUDY_ROOT && process.env.DATA_DIR) {
    return {
      root: dirname(process.env.STUDY_ROOT),
      study: process.env.STUDY_ROOT,
      data: process.env.DATA_DIR,
    };
  }
  const root = await mkdtemp(join(tmpdir(), "ir-e2e-"));
  const study = join(root, "study");
  const data = join(root, "data");
  await mkdir(join(study, "lld"), { recursive: true });
  await mkdir(data, { recursive: true });
  await copyStudyKit(study);
  // An earlier attempt's notes file makes the scribe append to it instead of creating a new one.
  await writeFile(
    join(study, "notes", "b3-parking-lot.md"),
    "# B3 — Parking Lot\n\n**Date:** 2026-10-25 · **Tracker:** B3 Parking Lot · **Status:** [~]\n\n## What to fix next time\n\n- Write the exit flow first.\n",
    "utf8",
  );
  await writeFile(join(root, "claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "test.person@examplecorp.dev" } }));
  await writeFile(join(root, "denylist.txt"), "secretterm\n");
  return { root, study, data };
}

const started = [];

function startServer(dirs) {
  if (TARGET_EXISTING) {
    return { external: true, child: { exitCode: null }, output: () => "" };
  }
  const child = spawn(process.execPath, [join(APP, "node_modules", "tsx", "dist", "cli.mjs"), join(APP, "src", "server", "index.ts")], {
    cwd: APP,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      SPARMATE_FAKE_AGENT: "1",
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
  const server = { child, output: () => output };
  started.push(server);
  return server;
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
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not start:\n${server.output()}`);
}

async function stopServer(server) {
  if (server.external || server.child.exitCode !== null) return;
  try {
    process.kill(-server.child.pid, "SIGTERM");
  } catch {
    return;
  }
  for (let i = 0; i < 40 && server.child.exitCode === null; i++) await new Promise((r) => setTimeout(r, 125));
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

async function securityChecks() {
  const badHost = await request("GET", "/api/bootstrap", { headers: { host: "attacker.example" } });
  check("unknown Host gets 421", badHost.status === 421, `status ${badHost.status}`);
  const noOrigin = await request("POST", "/api/sessions", { headers: { "x-csrf-token": TOKEN }, body: { problemId: "c2-url-shortener", mode: "interview" } });
  check("POST without Origin gets 403", noOrigin.status === 403, `status ${noOrigin.status}`);
  const badToken = await request("POST", "/api/sessions", {
    headers: { origin: ORIGIN, "x-csrf-token": "x".repeat(43) },
    body: { problemId: "c2-url-shortener", mode: "interview" },
  });
  check("POST with a wrong CSRF token gets 403", badToken.status === 403, `status ${badToken.status}`);
  const badBody = await api.post("/api/sessions", { problemId: "c2-url-shortener", mode: "interview", extra: 1 });
  check("POST with an unknown key gets 400", badBody.status === 400, `status ${badBody.status}`);
  const boot = await api.get("/api/bootstrap");
  check("no CORS headers", !Object.keys(boot.headers).some((h) => h.startsWith("access-control-")));
  check(
    "security headers present",
    boot.headers["x-frame-options"] === "DENY" &&
      boot.headers["cross-origin-opener-policy"] === "same-origin" &&
      String(boot.headers["content-security-policy"]).includes("frame-ancestors 'none'"),
  );
  const page = await api.get("/session/anything");
  check("SPA fallback serves index.html", page.status === 200 && String(page.headers["content-type"]).includes("text/html"), `status ${page.status}`);
}

async function wsSecurityChecks(sessionId) {
  try {
    await new Client("bad-origin").connect(sessionId, { origin: "http://evil.example" });
    check("WebSocket with a foreign Origin is refused", false, "it connected");
  } catch (err) {
    check("WebSocket with a foreign Origin is refused", /403/.test(String(err)), String(err));
  }
  const badHello = new Client("bad-hello");
  await badHello.connect(sessionId);
  badHello.send({ type: "hello", token: "y".repeat(43) });
  const closed1 = await badHello.waitClose();
  check("WebSocket hello with a wrong token is closed", closed1?.code === 4401, JSON.stringify(closed1));
  const badMsg = new Client("bad-msg");
  await badMsg.connect(sessionId);
  badMsg.send({ type: "hello", token: TOKEN });
  await badMsg.waitFor((m) => m.type === "session.state", { label: "state before bad message" });
  badMsg.send({ type: "chat.send", channel: "interview", clientMsgId: "x", text: "hi", sneaky: true });
  const closed2 = await badMsg.waitClose();
  check("an invalid message gets an error and a close", closed2?.code === 4400 && badMsg.msgs.some((m) => m.type === "error"), JSON.stringify(closed2));
}

async function hldRound(dirs) {
  const created = await api.post("/api/sessions", { problemId: "c2-url-shortener", mode: "interview" });
  check("HLD session created", created.status === 200 && typeof created.json?.sessionId === "string", JSON.stringify(created.json));
  const id = created.json.sessionId;
  await wsSecurityChecks(id);

  const c = await openRoom(id, "hld");
  const second = await openRoom(id, "hld-second-tab");
  const opening = await c.waitFor(isInterviewerMsg, { label: "opening line" });
  check("interviewer opens with the brief's opening prompt", opening.entry.text.startsWith("Let's design a URL shortener"), opening.entry.text);

  const first = await say(c, "I'd start with requirements: users create short links and get redirects, about 100 million new links a month.", "c1");
  check("candidate message echoed with its clientMsgId", first.echo.entry.role === "candidate" && first.echo.entry.channel === "interview");
  check(
    "interviewer reply streamed in chunks then stored",
    first.deltas.length >= 2 && first.deltas.map((d) => d.textDelta).join("") === first.reply.entry.text,
    `${first.deltas.length} deltas`,
  );
  check(
    "a second tab receives the broadcast",
    second.msgs.some((m) => m.type === "chat.message" && m.clientMsgId === "c1"),
  );

  let mark = c.mark();
  c.send({ type: "board.update", version: 1, elements: scene() });
  const graph = await c.waitFor((m) => m.type === "board.graph" && m.version === 1, { since: mark, label: "board.graph" });
  check(
    "board update builds the graph text",
    graph.graphText.includes("Load balancer") && graph.graphText.includes("Redirect service"),
    graph.graphText.split("\n").slice(0, 4).join(" | "),
  );
  c.send({ type: "board.update", version: 1, elements: [] });

  const look = await say(c, "Can you look at the board?", "c2");
  const pngAsked = c.msgs.slice(look.mark).some((m) => m.type === "board.png.request");
  check("view_whiteboard asks the browser for a PNG and the model sees it", pngAsked && look.reply.entry.text.startsWith("I can see your board"), look.reply.entry.text);
  check("interview mode never attaches rich blocks even when the driver attempts emit_block", !look.reply.entry.blocks?.length, JSON.stringify(look.reply.entry.blocks));

  // The step checker: chat and frame evidence, the leave-time frame image, and the interview-mode filter.
  c.send({ type: "board.update", version: 2, elements: framedScene() });
  mark = c.mark();
  c.send({ type: "phase.set", phase: "entities" });
  const frameAsked = await c.waitFor((m) => m.type === "board.png.request" && m.frameId === "f-req", { since: mark, label: "frame image for the step he left" });
  check("leaving a step asks the page for that step's frame image", frameAsked.frameId === "f-req");
  // An interview round sends the browser no checklist, so the result is read from the session file once it is saved.
  const readChecks = async () => JSON.parse(await readFile(join(dirs.data, "sessions", id, "session.json"), "utf8")).stepChecks ?? {};
  let savedChecks = {};
  for (let i = 0; i < 50 && savedChecks.requirements?.status !== "done"; i++) {
    await new Promise((r) => setTimeout(r, 200));
    savedChecks = await readChecks();
  }
  const reqItems = Object.values(savedChecks.requirements?.items ?? {});
  check(
    "the checker ticks what his chat and frame cover, with where it was covered",
    reqItems.filter((i) => i.state === "covered").length >= 2 &&
      reqItems.some((i) => i.source === "chat" && i.at !== null) &&
      reqItems.some((i) => i.source === "board") &&
      savedChecks.requirements?.usedImage === true,
    JSON.stringify(reqItems.map((i) => [i.state, i.source])),
  );
  const statesSince = c.msgs.slice(mark).filter((m) => m.type === "session.state");
  check(
    "an interview round sends the browser no checklist and no pins during the round",
    statesSince.length > 0 && statesSince.every((m) => Object.keys(m.session.steps).length === 0 && m.session.pins.length === 0),
  );
  check(
    "a coverage claim with words he never said is refused",
    savedChecks.requirements?.status === "done" && !JSON.stringify(savedChecks).includes("I covered this in detail earlier"),
  );

  mark = c.mark();
  c.send({ type: "phase.set", phase: "design" });
  await c.waitFor((m) => m.type === "session.state" && m.session.phase === "design", { since: mark, label: "state after design" });
  mark = c.mark();
  c.send({
    type: "board.update",
    version: 3,
    elements: [...framedScene(), { angle: 0, isDeleted: false, groupIds: [], frameId: null, id: "blank2", type: "rectangle", x: 1100, y: 900, width: 100, height: 60 }],
  });
  await new Promise((r) => setTimeout(r, 6_000));
  check(
    "drawing in a step does not start a check while he stays in it",
    !c.msgs.slice(mark).some((m) => m.type === "board.png.request" && m.frameId === "f-design") && (await readChecks()).design === undefined,
  );
  c.send({ type: "board.update", version: 4, elements: scene() });

  mark = c.mark();
  c.send({ type: "phase.set", phase: "entities" });
  const changed = await c.waitFor((m) => m.type === "phase.changed", { since: mark, label: "phase.changed" });
  const stateAfter = await c.waitFor((m) => m.type === "session.state" && m.session.phase === "entities", { since: mark, label: "state after phase" });
  check(
    "phase.set records the candidate's move",
    changed.phase === "entities" && changed.by === "candidate" && stateAfter.session.phaseHistory.some((h) => h.phase === "entities" && h.by === "candidate"),
  );

  mark = c.mark();
  c.send({ type: "phase.set", phase: "not-a-phase" });
  const phaseErr = await c.waitFor((m) => m.type === "error", { since: mark, label: "bad phase error" });
  check("an unknown phase is refused with an error, socket stays open", phaseErr.code === "bad_phase" && !c.closeInfo);

  const move = await say(c, "Let's move to API", "c3");
  const byInterviewer = c.msgs.slice(move.mark).find((m) => m.type === "phase.changed");
  check("interviewer's set_phase moves the rail", byInterviewer?.phase === "api" && byInterviewer?.by === "interviewer", JSON.stringify(byInterviewer));

  // Step answers: update, broadcast, version rule, validation, envelope block, persistence.
  const req = "Functional: shorten and redirect.\nNon-functional: redirect p99 under 50 ms.";
  mark = c.mark();
  const secondMark = second.mark();
  c.send({ type: "notes.update", phase: "requirements", text: req, version: 1 });
  const shared = await second.waitFor((m) => m.type === "notes.changed", { since: secondMark, label: "notes.changed on the second tab" });
  check(
    "notes.update is broadcast to the other tab only",
    shared.phase === "requirements" && shared.text === req && shared.version === 1 && !c.msgs.slice(mark).some((m) => m.type === "notes.changed"),
  );
  c.send({ type: "notes.update", phase: "requirements", text: "stale write", version: 1 });
  mark = c.mark();
  c.send({ type: "notes.update", phase: "nope", text: "x", version: 2 });
  const notesErr = await c.waitFor((m) => m.type === "error", { since: mark, label: "bad notes phase error" });
  check("notes for an unknown phase are refused, socket stays open", notesErr.code === "bad_phase" && !c.closeInfo);
  const withNotes = await say(c, "What do my notes say?", "n1");
  check(
    "the interviewer's envelope carries the notes block once",
    withNotes.reply.entry.text.includes("I read your notes") && withNotes.reply.entry.text.includes("[Requirements] / Functional: shorten and redirect."),
    withNotes.reply.entry.text,
  );
  const again = await say(c, "What do my notes say?", "n2");
  check("the notes block is left out while the notes are unchanged", again.reply.entry.text.includes("no notes block"), again.reply.entry.text);
  c.send({ type: "notes.update", phase: "entities", text: "Link: code, long URL, expiry.", version: 2 });
  await new Promise((r) => setTimeout(r, 1500));
  const reopened = await openRoom(id, "hld-reload");
  const reloadState = reopened.msgs.find((m) => m.type === "session.state").session;
  check(
    "notes survive a reload and the stale write was ignored",
    reloadState.stepNotes.requirements === req && reloadState.stepNotes.entities.startsWith("Link:") && reloadState.stepNotesVersion === 2,
    JSON.stringify(reloadState.stepNotes),
  );
  const onDisk = JSON.parse(await readFile(join(dirs.data, "sessions", id, "session.json"), "utf8"));
  check("notes are saved to the session file", onDisk.stepNotes.requirements === req && onDisk.stepNotesVersion === 2);
  reopened.close();
  const tooLong = new Client("too-long");
  await tooLong.connect(id);
  tooLong.send({ type: "hello", token: TOKEN });
  await tooLong.waitFor((m) => m.type === "session.state", { label: "too-long state" });
  tooLong.send({ type: "notes.update", phase: "design", text: "x".repeat(8001), version: 9 });
  const closedLong = await tooLong.waitClose();
  check("a notes text over 8,000 characters is rejected", closedLong?.code === 4400, JSON.stringify(closedLong));

  const sessionBefore = await api.get(`/api/sessions/${id}`);
  check(
    "GET session returns the public session without sdk ids",
    sessionBefore.status === 200 && sessionBefore.json.sdk === undefined && sessionBefore.json.reference === null && Array.isArray(sessionBefore.json.phasePlan),
  );

  const debrief = await runDebrief(c, "HLD");
  check(
    "debrief runs collect, judge, check, done",
    ["collecting", "judging", "checking", "done"].every((s) => debrief.stages.includes(s)),
    debrief.stages.join(","),
  );
  const qc = debrief.scorecard.quoteChecks ?? [];
  const failedQuotes = qc.filter((q) => !q.verified).length;
  check("quote checks: real quotes verified, the invented one failed", qc.length >= 2 && failedQuotes === 1, `${qc.length} checks, ${failedQuotes} failed`);
  check(
    "scorecard has phase timing and lint issues",
    Array.isArray(debrief.scorecard.phaseTiming) && debrief.scorecard.phaseTiming.length === 5 && Array.isArray(debrief.scorecard.lintIssues),
  );
  check("reference answer appears once debriefed", debrief.state.reference && debrief.state.reference.sections.some((s) => s.heading === "Reference design"));
  const png = await api.get(`/api/sessions/${id}/board-final.png`);
  check("final board PNG saved", png.status === 200 && png.headers["content-type"] === "image/png" && png.buf.subarray(1, 4).toString() === "PNG");

  await new Promise((resolve) => setTimeout(resolve, 1_500));
  check(
    "the coach waits for the candidate after the debrief",
    !c.msgs.slice(debrief.mark).some((m) => m.type === "chat.message" && m.entry.channel === "coach" && m.entry.role === "coach"),
  );
  const openMark = c.mark();
  c.send({ type: "coach.open" });
  const coachOpen = await c.waitFor((m) => m.type === "chat.message" && m.entry.channel === "coach" && m.entry.role === "coach", {
    since: openMark,
    timeout: 15_000,
    label: "coach opening",
  });
  check("coach opens on request", coachOpen.entry.text.includes("Let's start with"), coachOpen.entry.text.slice(0, 80));
  check(
    "coach opening attaches structured options block",
    Array.isArray(coachOpen.entry.blocks) && coachOpen.entry.blocks[0]?.kind === "options",
    JSON.stringify(coachOpen.entry.blocks),
  );
  check("coach can read the round's transcript", /I read [1-9]\d* lines of the round/.test(coachOpen.entry.text), coachOpen.entry.text.slice(0, 200));
  mark = c.mark();
  c.send({ type: "chat.send", channel: "coach", clientMsgId: "k1", text: "Can you explain the first gap?" });
  const coachReply = await c.waitFor((m) => m.type === "chat.message" && m.entry.channel === "coach" && m.entry.role === "coach", { since: mark, label: "coach reply" });
  check("coach answers on the coach channel", coachReply.entry.text.length > 20);

  const notesPath = join(dirs.study, "notes", "c2-url-shortener.md");
  const notesBefore = await readFile(notesPath, "utf8").catch(() => null);
  const bk = await bookkeeping(c, dirs.study, "HLD");
  const kinds = bk.proposal.ops.map((o) => o.op.kind);
  check(
    "scribe drafts tracker, log, review and a new notes file",
    ["tracker_update_bullet", "tracker_append_session_log_row", "review_append_entry", "notes_create"].every((k) => kinds.includes(k)) && notesBefore === null,
    kinds.join(","),
  );
  check("every drafted op applied", bk.applied.applied.length === bk.opIds.length && bk.applied.failed.length === 0, JSON.stringify(bk.applied.failed));
  check("files changed exactly as the diffs planned", bk.exact, bk.mismatches.join(","));
  const tracker = await readFile(join(dirs.study, "TRACKER.md"), "utf8");
  check("tracker bullet now carries the mark and suffix", tracker.includes(`- [~] URL Shortener → notes/c2-url-shortener.md · ${today()}`));

  const history = await api.get("/api/sessions");
  check(
    "history lists the session with its verdict",
    history.json.some((h) => h.id === id && h.verdict === "lean_no_hire" && h.status === "debriefed"),
  );
  const savedSession = await api.get(`/api/sessions/${id}`);
  check(
    "the saved state of the study notes survives and shows in history",
    savedSession.json.studyNotes?.status === "applied" &&
      savedSession.json.studyNotes.appliedCount === bk.opIds.length &&
      history.json.find((h) => h.id === id)?.notesSaved === true,
    JSON.stringify(savedSession.json.studyNotes),
  );
  const problems = await api.get("/api/problems");
  const shortener = problems.json.find((p) => p.id === "c2-url-shortener");
  check(
    "each problem carries the first sentence of its opening prompt",
    shortener?.summary === "Let's design a URL shortener, something like bit.ly." && !/Hidden|reference/i.test(shortener.summary),
    shortener?.summary,
  );
  c.close();
  second.close();
}

async function lldRound(dirs) {
  const created = await api.post("/api/sessions", { problemId: "b3-parking-lot", mode: "interview" });
  check("LLD session created", created.status === 200, JSON.stringify(created.json));
  if (created.status !== 200) return;
  const id = created.json.sessionId;
  const code0 = await api.get(`/api/sessions/${id}/code`);
  const header = `// Parking Lot — ${today()}`;
  check(
    "attempt file created with its one-line header",
    code0.status === 200 && code0.json.version === 0 && code0.json.content.trim() === header && code0.json.path.endsWith(`lld/parking-lot/attempt-${today()}.cpp`),
    JSON.stringify(code0.json),
  );
  const attempt = code0.json.path;
  const hostAttempt = attempt.startsWith("/study/") ? join(dirs.study, attempt.slice("/study/".length)) : attempt;

  const c = await openRoom(id, "lld");
  await c.waitFor(isInterviewerMsg, { label: "LLD opening" });

  const v1 = CPP_V1(header);
  let mark = c.mark();
  c.send({ type: "code.update", version: 1, content: v1 });
  let diag = null;
  try {
    diag = await c.waitFor((m) => m.type === "code.diagnostics" && m.version === 1, { since: mark, timeout: 25_000, label: "diagnostics" });
  } catch (err) {
    check("syntax check runs after a code update (C++ runner)", false, String(err));
  }
  if (diag)
    check("syntax check runs after a code update (C++ runner)", diag.diagnostics.filter((d) => d.severity === "error").length === 0, `${diag.diagnostics.length} diagnostics`);
  check("code update written to the attempt file", (await readFile(hostAttempt, "utf8")) === v1);

  const v2 = v1.replace("car got spot", "a car got spot");
  mark = c.mark();
  await writeFile(hostAttempt, v2);
  try {
    const ext = await c.waitFor((m) => m.type === "code.external", { since: mark, timeout: 10_000, label: "code.external" });
    check("an outside edit (as from an editor) is broadcast with a new version", ext.content === v2 && ext.version === 2, `version ${ext.version}`);
  } catch (err) {
    check("an outside edit (as from an editor) is broadcast with a new version", false, String(err));
  }

  mark = c.mark();
  c.send({ type: "code.run" });
  try {
    const run = await c.waitFor((m) => m.type === "code.run.result" || m.type === "error", { since: mark, timeout: 40_000, label: "run result" });
    const ok = run.type === "code.run.result" && run.result.compile.ok && run.result.run?.exitCode === 0 && run.result.run.stdout.includes("a car got spot 1");
    check("code.run compiles and runs the program (C++ runner)", ok, JSON.stringify(run));
  } catch (err) {
    check("code.run compiles and runs the program (C++ runner)", false, String(err));
  }

  const read = await say(c, "Please read my code.", "l1");
  check("interviewer's read_code tool works", read.reply.entry.text.includes("read it"), read.reply.entry.text);

  const debrief = await runDebrief(c, "LLD");
  check("LLD debrief runs the tester", debrief.stages.includes("testing"), debrief.stages.join(","));
  const scen = debrief.scorecard.lldScenarios;
  check(
    "tester scenarios reach the scorecard (one pass, two fails with one cause when the code compiles)",
    scen.length === 3 && scen.filter((s) => s.pass).length === 1 && scen.filter((s) => !s.pass).every((s) => s.cause === "No rejection result in the API"),
    JSON.stringify(scen.map((s) => [s.pass, s.cause ?? null])),
  );
  const frozen = await api.get(`/api/sessions/${id}/code`);
  check("after the round, the code endpoint shows the frozen copy", frozen.json?.content === v2);

  const bk = await bookkeeping(c, dirs.study, "LLD");
  const kinds = bk.proposal.ops.map((o) => o.op.kind);
  check("scribe appends to the existing parking lot notes", kinds.includes("notes_append") && !kinds.includes("notes_create"), kinds.join(","));
  check("LLD files changed exactly as the diffs planned", bk.exact && bk.applied.failed.length === 0, `${bk.mismatches.join(",")} ${JSON.stringify(bk.applied.failed)}`);
  c.close();
}

async function guidedRound() {
  const created = await api.post("/api/sessions", { problemId: "c2-url-shortener", mode: "guided" });
  const id = created.json.sessionId;
  const c = await openRoom(id, "guided");
  await c.waitFor(isInterviewerMsg, { label: "guided opening" });

  let mark = c.mark();
  c.send({ type: "guided.hint" });
  const hint = await c.waitFor(isInterviewerMsg, { since: mark, label: "hint reply" });
  const leaked = c.msgs.some((m) => m.type === "chat.message" && m.entry.hidden) || c.msgs.some((m) => m.type === "session.state" && m.session.hints.length > 0);
  check("a guided hint is answered and recorded out of sight", hint.entry.text.startsWith("Hint 1") && !leaked, hint.entry.text.slice(0, 60));

  c.send({ type: "board.update", version: 1, elements: framedScene() });
  mark = c.mark();
  c.send({ type: "guided.feedback" });
  const fb = await c.waitFor(isInterviewerMsg, { since: mark, label: "feedback reply" });
  check("a step check gets feedback", fb.entry.text.includes("One thing is missing"));
  const named = await c.waitFor((m) => m.type === "session.state" && m.session.stepVerdicts?.requirements?.verdict === "not_yet", {
    since: mark,
    timeout: 10_000,
    label: "step verdict after a guided check",
  });
  check(
    "a step check ends in one step verdict that names a gap",
    typeof named.session.stepVerdicts.requirements.gap === "string" && named.session.stepVerdicts.requirements.gap.length > 0,
  );
  const pinned = await c.waitFor((m) => m.type === "session.state" && m.session.pins.length > 0, { since: mark, label: "guide pin" });
  check(
    "the guide pins a real box and its made-up id is refused",
    pinned.session.pins.length === 1 && pinned.session.pins[0].elementId === "lb" && pinned.session.pins[0].phase === "design" && pinned.session.pins[0].tone === "note",
    JSON.stringify(pinned.session.pins),
  );
  check("a live guided round sends no checklist", Object.keys(pinned.session.steps).length === 0);

  // Walk up to the third-rung hint so the guide emits an options block, then send its reply text with no client flag:
  // the server must match optionText itself and keep those words out of step checks and debrief quotes.
  mark = c.mark();
  c.send({ type: "guided.hint" });
  await c.waitFor(isInterviewerMsg, { since: mark, label: "hint 2 reply" });
  mark = c.mark();
  c.send({ type: "guided.hint" });
  const h3 = await c.waitFor(isInterviewerMsg, { since: mark, label: "hint 3 reply" });
  const optReplyText = h3.entry.blocks?.[0]?.kind === "options" ? h3.entry.blocks[0].items[0]?.reply : undefined;
  check("third-rung hint attaches an options block", typeof optReplyText === "string" && optReplyText.length > 0, JSON.stringify(h3.entry.blocks));

  mark = c.mark();
  c.send({
    type: "chat.send",
    channel: "interview",
    clientMsgId: "opt-req",
    text: optReplyText,
  });
  const optEcho = await c.waitFor((m) => m.type === "chat.message" && m.clientMsgId === "opt-req", { since: mark, label: "option-chip echo" });
  check("an unmarked option-chip reply is matched by the server with optionText", optEcho.entry.optionText === optReplyText, JSON.stringify(optEcho.entry));
  await c.waitFor(isInterviewerMsg, { since: mark, label: "reply to option-chip click" });

  mark = c.mark();
  c.send({ type: "guided.feedback" });
  const held = await c.waitFor(isInterviewerMsg, { since: mark, label: "reply to a check with nothing new" });
  check(
    "a pass the step's reading does not support is refused",
    held.entry.text.includes("does not pass yet") && c.msgs.filter((m) => m.type === "session.state").at(-1)?.session.stepVerdicts?.requirements?.verdict === "not_yet",
    held.entry.text.slice(0, 80),
  );

  // He states the core requirements, so the next check has the evidence a pass needs.
  mark = c.mark();
  c.send({
    type: "chat.send",
    channel: "interview",
    clientMsgId: "req1",
    text: "Create a short link for a long URL, with an optional custom alias and an optional expiry. Redirect a short link to its long URL, and an expired link stops redirecting. About 100 million new links a month and about 100 redirects per link. A redirect adds under 50 ms at p99.",
  });
  await c.waitFor(isInterviewerMsg, { since: mark, label: "reply to the requirements" });

  mark = c.mark();
  c.send({ type: "guided.feedback" });
  const passed = await c.waitFor((m) => m.type === "session.state" && m.session.stepVerdicts?.requirements?.verdict === "pass", {
    since: mark,
    timeout: 10_000,
    label: "pass after a second check",
  });
  check("a pass replaces a not_yet and drops its gap", passed.session.stepVerdicts.requirements.gap === undefined);
  await c.waitFor(isInterviewerMsg, { since: mark, label: "reply to the second check" });

  const guidedLook = await say(c, "Can you look at the board?", "g-look");
  check(
    "guided look-at-board attaches a board anchor block",
    Array.isArray(guidedLook.reply.entry.blocks) &&
      guidedLook.reply.entry.blocks[0]?.kind === "anchor" &&
      guidedLook.reply.entry.blocks[0]?.target?.kind === "board" &&
      guidedLook.reply.entry.blocks[0]?.target?.elementId === "lb",
    JSON.stringify(guidedLook.reply.entry.blocks),
  );

  mark = c.mark();
  c.send({ type: "guided.stuck" });
  const stuck = await c.waitFor(isInterviewerMsg, { since: mark, label: "model answer" });
  const assisted = await c.waitFor((m) => m.type === "session.state" && m.session.assistCount === 1, { since: mark, label: "assist count" });
  check(
    "'I'm stuck' gets a model answer and the server counts the assist",
    stuck.entry.text.includes("model answer") && assisted.session.assistCount === 1 && !("assists" in assisted.session),
    stuck.entry.text.slice(0, 60),
  );
  check(
    "guided model answer attaches a flow diagram block",
    Array.isArray(stuck.entry.blocks) && stuck.entry.blocks[0]?.kind === "diagram" && stuck.entry.blocks[0]?.layout === "flow",
    JSON.stringify(stuck.entry.blocks),
  );

  mark = c.mark();
  c.send({ type: "session.pause" });
  await c.waitFor((m) => m.type === "session.state" && m.session.status === "paused", { since: mark, label: "paused" });
  c.send({ type: "chat.send", channel: "interview", clientMsgId: "g1", text: "hello?" });
  const pausedErr = await c.waitFor((m) => m.type === "error", { since: mark, label: "paused error" });
  check("chat is refused while paused", pausedErr.code === "paused");
  mark = c.mark();
  c.send({ type: "session.resume" });
  const resumed = await c.waitFor((m) => m.type === "session.state" && m.session.status === "live", { since: mark, label: "resumed" });
  check("resume adds the pause to pausedMs", resumed.session.pausedMs > 0 && resumed.session.pauseStartedAt === null);

  const debrief = await runDebrief(c, "guided");
  check("guided rounds are capped at [~]", debrief.scorecard.trackerMark === "[~]");
  check(
    "a guided debrief gets a readiness call that names the assisted step, and keeps the judge's verdict in the data",
    debrief.scorecard.readiness?.call === "not_yet" && debrief.scorecard.readiness.reasons.includes("Requirements was assisted.") && Boolean(debrief.scorecard.verdict.sde2),
    JSON.stringify(debrief.scorecard.readiness),
  );
  check("debrief does not quote option-chip text as candidate evidence", !JSON.stringify(debrief.scorecard.dimensions).includes("Option-chip pick"));
  check(
    "hints show up once the round is over",
    debrief.state.hints.length === 3 && debrief.state.hints.map((h) => h.level).join(",") === "1,2,3",
    JSON.stringify(debrief.state.hints),
  );
  const judgePins = debrief.state.pins.filter((p) => p.by === "judge");
  check(
    "the judge pins what held and a gap, and the debrief shows every pin",
    judgePins.some((p) => p.tone === "held") && judgePins.some((p) => p.tone === "gap") && debrief.state.pins.some((p) => p.by === "guide"),
    JSON.stringify(debrief.state.pins.map((p) => [p.by, p.tone, p.elementId])),
  );
  c.close();
}

async function gapRound() {
  const focus = { title: "Hot key skew", goodLooksLike: "Split the hot key across shards and add a local cache." };
  const created = await api.post("/api/sessions", { problemId: "c2-url-shortener", mode: "guided", focus });
  check("a gap round starts as a 20-minute guided round", created.status === 200, JSON.stringify(created.json));
  const session = (await api.get(`/api/sessions/${created.json.sessionId}`)).json;
  check(
    "the gap round keeps its focus and its short length",
    session.mode === "guided" && session.durationMs === 20 * 60_000 && session.focus?.title === focus.title,
    JSON.stringify(session.focus),
  );
  const wrong = await api.post("/api/sessions", { problemId: "c2-url-shortener", mode: "interview", focus });
  check("a focus on an interview round is refused", wrong.status === 400);
  const normal = (await api.get(`/api/sessions/${(await api.post("/api/sessions", { problemId: "c2-url-shortener", mode: "guided" })).json.sessionId}`)).json;
  check("a normal round has no focus", normal.focus === null);

  await practisedGap();
}

/** A gap round that passes its gap's step marks the gap "practised" on the round it came from, until it is discarded. */
async function practisedGap() {
  const title = "Asking for the scale first";
  const source = (await api.get("/api/sessions")).json.find((h) => h.problemId === "c2-url-shortener" && h.status === "debriefed" && h.gaps?.some((g) => g.title === title));
  check("a debriefed round holds a gap tagged with its step", Boolean(source), JSON.stringify(source?.gaps?.map((g) => g.title)));
  if (!source) return;
  const created = await api.post("/api/sessions", {
    problemId: "c2-url-shortener",
    mode: "guided",
    focus: { title, goodLooksLike: "Ask for the load first.", sourceSessionId: source.id },
  });
  const id = created.json.sessionId;
  const round = (await api.get(`/api/sessions/${id}`)).json;
  check("the gap round links to its source gap and step", round.focus?.source?.sessionId === source.id && round.focus.source.step === "requirements", JSON.stringify(round.focus));
  const c = await openRoom(id, "practice");
  await c.waitFor(isInterviewerMsg, { label: "practice opening" });
  let mark = c.mark();
  c.send({
    type: "chat.send",
    channel: "interview",
    clientMsgId: "prq1",
    text: "Create a short link for a long URL, with an optional custom alias and an optional expiry. Redirect a short link to its long URL, and an expired link stops redirecting. About 100 million new links a month and about 100 redirects per link. A redirect adds under 50 ms at p99.",
  });
  await c.waitFor(isInterviewerMsg, { since: mark, label: "practice requirements reply" });
  for (const label of ["first practice check", "second practice check"]) {
    mark = c.mark();
    c.send({ type: "guided.feedback" });
    await c.waitFor(isInterviewerMsg, { since: mark, label });
  }
  const practised = await pollFor(async () => (await api.get(`/api/sessions/${source.id}`)).json.gapPractice?.[title]?.sessionId === id);
  check("a passed gap round marks its source gap practised", practised);
  const done = await pollFor(async () => (await api.get("/api/sessions")).json.find((h) => h.id === source.id)?.gaps?.find((g) => g.title === title)?.done === true);
  check("history counts the practised gap as done", done);
  c.close();
  const gone = await api.delete(`/api/sessions/${id}`);
  const cleared = await pollFor(async () => (await api.get(`/api/sessions/${source.id}`)).json.gapPractice?.[title] === undefined);
  check("discarding the gap round takes the mark away", gone.status < 300 && cleared, String(gone.status));
}

async function pollFor(test, ms = 8_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await test()) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

async function interviewModeRules() {
  const created = await api.post("/api/sessions", { problemId: "c2-url-shortener", mode: "interview" });
  const c = await openRoom(created.json.sessionId, "rules");
  await c.waitFor(isInterviewerMsg, { label: "rules opening" });
  const mark = c.mark();
  c.send({ type: "session.pause" });
  const paused = await c.waitFor((m) => m.type === "session.state" && m.session.status === "paused", { since: mark, label: "interview pause" });
  check("interview rounds can be paused by the user", paused.session.pauseReason === "user" && paused.session.pauseStartedAt !== null, paused.session.pauseReason);
  const listed = (await api.get("/api/sessions")).json.find((h) => h.id === created.json.sessionId);
  check(
    "history says why a round paused and how much time is left",
    listed?.pause?.reason === "user" && listed.pause.timeLeftMs > 40 * 60_000 && listed.pause.timeLeftMs <= 45 * 60_000,
    JSON.stringify(listed?.pause),
  );
  c.close();
}

async function customPrompt(dirs) {
  // Test preparation job API (POST /api/custom-problems, GET /api/custom-problems/:jobId)
  const jobRes = await api.post("/api/custom-problems", { prompt: "Design an analytics counter service.", track: "hld" });
  check("POST /api/custom-problems starts a preparation job", jobRes.status === 201 && typeof jobRes.json?.jobId === "string", JSON.stringify(jobRes.json));
  const jobId = jobRes.json.jobId;

  // Poll until ready
  let jobStatus;
  for (let i = 0; i < 40; i++) {
    const res = await api.get(`/api/custom-problems/${jobId}`);
    jobStatus = res.json;
    if (jobStatus.stage === "ready" || jobStatus.stage === "failed") break;
    await new Promise((r) => setTimeout(r, 100));
  }
  check("preparation job reaches ready stage", jobStatus?.stage === "ready", JSON.stringify(jobStatus));
  check(
    "preparation job reports research and check stats",
    (jobStatus?.searches ?? 0) >= 1 && (jobStatus?.pages ?? 0) >= 1,
    `searches=${jobStatus?.searches}, pages=${jobStatus?.pages}`,
  );
  check("preparation job returns problem metadata", typeof jobStatus?.problemId === "string" && typeof jobStatus?.title === "string", JSON.stringify(jobStatus));

  const jobSession = await api.post("/api/sessions", { problemId: jobStatus.problemId, mode: "interview" });
  check("session starts from ready custom problem id", jobSession.status === 200, JSON.stringify(jobSession.json));

  // Start a custom question preparation job and cancel it
  const cancelJobRes = await api.post("/api/custom-problems", { prompt: "Design a notification service for mobile push notifications.", track: "hld" });
  check("POST /api/custom-problems starts a job to be cancelled", cancelJobRes.status === 201 && typeof cancelJobRes.json?.jobId === "string", JSON.stringify(cancelJobRes.json));
  const cancelJobId = cancelJobRes.json.jobId;

  const cancelRes = await api.delete(`/api/custom-problems/${cancelJobId}`);
  check("DELETE /api/custom-problems/:jobId cancels the job", cancelRes.status === 200 && cancelRes.json?.stage === "cancelled", JSON.stringify(cancelRes.json));

  const pollAfterCancel = await api.get(`/api/custom-problems/${cancelJobId}`);
  check("cancelled job status reports cancelled stage", pollAfterCancel.status === 200 && pollAfterCancel.json?.stage === "cancelled", JSON.stringify(pollAfterCancel.json));

  // Legacy direct session creation with customPrompt
  const created = await api.post("/api/sessions", { customPrompt: "Design a pastebin where people share text snippets by link.", customTrack: "hld", mode: "interview" });
  check("a pasted prompt becomes a session through the brief-writer", created.status === 200, JSON.stringify(created.json));
  const problems = await api.get("/api/problems");
  const custom = problems.json.find((p) => p.custom);
  check(
    "the custom problem is listed without a tracker mark",
    custom && custom.trackerMark === null && custom.badge === null && custom.id.startsWith("custom-"),
    JSON.stringify(custom),
  );
  const file = await readFile(join(dirs.data, "custom-problems", `${custom?.id}.md`), "utf8").catch(() => "");
  check("the custom problem file is saved in the data folder", file.startsWith("---\n") && file.includes("## Opening prompt"));
}

/** Stops the server in the middle of a round and checks the round comes back paused and can carry on. */
async function restartMidRound(dirs, server) {
  if (server.external) {
    check("restart mid-round skipped against external container", true);
    return server;
  }
  const created = await api.post("/api/sessions", { problemId: "c2-url-shortener", mode: "interview" });
  const id = created.json.sessionId;
  const c = await openRoom(id, "before-restart");
  await c.waitFor(isInterviewerMsg, { label: "opening before restart" });
  await say(c, "First, requirements.", "r1");
  c.close();
  await stopServer(server);

  const next = startServer(dirs);
  const boot = await waitForServer(next);
  TOKEN = boot.json.csrfToken;
  const saved = await api.get(`/api/sessions/${id}`);
  check("a live round comes back paused after a restart", saved.json.status === "paused" && saved.json.pauseStartedAt !== null, saved.json.status);
  check("the pause is marked as caused by the restart", saved.json.pauseReason === "restart", String(saved.json.pauseReason));
  const c2 = new Client("after-restart");
  await c2.connect(id);
  c2.send({ type: "hello", token: TOKEN });
  const state = await c2.waitFor((m) => m.type === "session.state", { label: "state after restart" });
  check("the browser is told why it is paused", state.session.status === "paused" && state.session.pauseReason === "restart", String(state.session.pauseReason));
  let mark = c2.mark();
  c2.send({ type: "session.resume" });
  await c2.waitFor((m) => m.type === "session.state" && m.session.status === "live", { since: mark, label: "live again" });
  const reply = await say(c2, "Next, the core entities.", "r2");
  check("the round carries on after the restart", reply.reply.entry.text.length > 0 && !reply.reply.entry.text.includes("carry on"), reply.reply.entry.text);
  c2.close();
  return next;
}

// ---------------------------------------------------------------------------

async function main() {
  const kitTrackerHash = sha(await readFile(join(KIT_DIR, "TRACKER.md")));
  const dirs = await prepare();
  process.stdout.write(`temp folder: ${dirs.root}\n`);
  let server = startServer(dirs);
  try {
    const boot = await waitForServer(server);
    TOKEN = boot.json.csrfToken;
    check("server starts in fake mode", boot.json.fakeAgent === true && boot.json.studyRoot.endsWith("/study"));
    const problems = await api.get("/api/problems");
    const next = problems.json.filter((p) => p.badge === "next").map((p) => p.id);
    check("problem list has both fixtures and one next pick", problems.json.length >= 2 && next.length === 1, next.join(","));

    await securityChecks();
    for (const [name, fn] of [
      ["HLD round", () => hldRound(dirs)],
      ["LLD round", () => lldRound(dirs)],
      ["guided round", () => guidedRound()],
      ["gap round", () => gapRound()],
      ["interview rules", () => interviewModeRules()],
      ["custom prompt", () => customPrompt(dirs)],
    ]) {
      try {
        await fn();
      } catch (err) {
        check(`${name} finished`, false, String(err));
      }
    }
    try {
      server = await restartMidRound(dirs, server);
    } catch (err) {
      check("restart mid-round finished", false, String(err));
    }

    const log = await readFile(join(dirs.data, "logs", "server.log"), "utf8").catch(() => "");
    check("server log holds no token and no deny-listed term", log.length > 0 && !log.includes(TOKEN) && !/secretterm|examplecorp/i.test(log));

    const usageFile = await readFile(join(dirs.data, "usage.jsonl"), "utf8").catch(() => "");
    const usageLines = usageFile.trim().split("\n").filter(Boolean);
    check("the round wrote usage lines to data/usage.jsonl", usageLines.length > 0, `${usageLines.length} lines`);
    const checkerLines = usageLines.map((l) => JSON.parse(l)).filter((u) => u.role === "checker");
    check(
      "checker calls are on the usage ledger, on Sonnet",
      checkerLines.length > 0 && checkerLines.every((u) => u.model === "claude-sonnet-5-5"),
      `${checkerLines.length} checker calls`,
    );

    const usageRes = await api.get("/api/usage");
    check(
      "/api/usage reports the rounds and model calls, and a fake call costs nothing",
      usageRes.status === 200 &&
        usageRes.json?.totals?.calls > 0 &&
        usageRes.json?.totals?.costUsd === 0 &&
        usageRes.json?.totals?.inputTokens > 0 &&
        usageRes.json?.bySession?.length > 0 &&
        typeof usageRes.json?.totals?.cacheHitRate === "number",
      JSON.stringify(usageRes.json?.totals),
    );
  } finally {
    for (const s of started) await stopServer(s);
    const after = sha(await readFile(join(KIT_DIR, "TRACKER.md")));
    check("the starter kit TRACKER.md did not change", after === kitTrackerHash);
    // A server this script did not start still uses these folders; its owner removes them.
    if (!KEEP && !TARGET_EXISTING) await rm(dirs.root, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  process.stdout.write(`\n${results.length - failed.length} passed, ${failed.length} failed\n`);
  if (failed.length > 0) {
    for (const f of failed) process.stdout.write(`  FAIL ${f.name}${f.detail ? ` — ${f.detail}` : ""}\n`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`${err?.stack ?? err}\n`);
  process.exit(1);
});
