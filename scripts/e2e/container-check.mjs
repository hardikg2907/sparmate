// Container E2E check: validates containerized server, ws-fake-round, C++ runner,
// sandbox escape tests, and Kokoro TTS inside rootless Linux container.
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { copyStudyKit } from "../lib/tempStudy.mjs";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = Number(process.env.PORT ?? 4780);
const BASE = `http://127.0.0.1:${PORT}`;
const CONTAINER_NAME = process.env.SPARMATE_CONTAINER_NAME ?? `ir-test-check-${Date.now()}`;
const IMAGE_NAME = process.env.SPARMATE_IMAGE_NAME ?? "localhost/ir-test-image:latest";
const KOKORO_VOLUME = process.env.SPARMATE_KOKORO_VOLUME ?? "ir-test-kokoro";
const PODMAN = process.env.PODMAN_BIN ?? "/opt/podman/bin/podman";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  process.stdout.write(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}\n`);
  return Boolean(ok);
}

async function chmodR(dir, mode = 0o777) {
  await chmod(dir, mode).catch(() => {});
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = join(dir, entry.name);
    await chmod(full, mode).catch(() => {});
    if (entry.isDirectory()) await chmodR(full, mode);
  }
}

function request(method, path, { headers = {}, body } = {}) {
  return new Promise((resolvePromise, reject) => {
    const payload = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        method,
        path,
        headers: {
          host: `127.0.0.1:${PORT}`,
          ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
          ...headers,
        },
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

function runCmd(cmd, args, { env = process.env, cwd = APP } = {}) {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => {
      process.stdout.write(d);
      stdout += d;
    });
    proc.stderr.on("data", (d) => {
      process.stderr.write(d);
      stderr += d;
    });
    proc.on("close", (code) => resolvePromise({ code, stdout, stderr }));
    proc.on("error", reject);
  });
}

class WsClient {
  constructor(name) {
    this.name = name;
    this.msgs = [];
    this.listeners = new Set();
    this.closeInfo = null;
  }

  connect(sessionId, token) {
    return new Promise((resolvePromise, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/session/${sessionId}`, {
        origin: BASE,
        maxPayload: 32 * 1024 * 1024,
      });
      this.ws = ws;
      ws.on("open", () => {
        this.send({ type: "hello", token });
        resolvePromise(this);
      });
      ws.on("error", reject);
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

  waitFor(pred, { since = 0, timeout = 25_000, label = "message" } = {}) {
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
          reject(new Error(`socket closed while waiting for ${label}`));
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

  close() {
    try {
      this.ws.close();
    } catch {
      // closed
    }
  }
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "ir-test-temp-"));
  const study = join(root, "study");
  const data = join(root, "data");
  await mkdir(join(study, "lld", "parking-lot"), { recursive: true });
  await mkdir(join(study, "notes"), { recursive: true });
  await mkdir(data, { recursive: true });

  await copyStudyKit(study);
  await writeFile(join(root, "claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "test.person@examplecorp.dev" } }));
  await writeFile(join(root, "denylist.txt"), "secretterm\n");

  // Ensure unprivileged container user 'node' has full write access to mounted volumes
  await chmodR(root, 0o777);

  let containerStarted = false;
  try {
    // Start test container bound strictly to 127.0.0.1:4780
    process.stdout.write(`Starting container ${CONTAINER_NAME} on port ${PORT}...\n`);
    const runRes = await runCmd(PODMAN, [
      "run",
      "-d",
      "--name",
      CONTAINER_NAME,
      "-p",
      `127.0.0.1:${PORT}:4780`,
      "-e",
      "SPARMATE_IN_CONTAINER=1",
      "-e",
      "SPARMATE_FAKE_AGENT=1",
      "-e",
      "PORT=4780",
      "-e",
      "STUDY_ROOT=/study",
      "-e",
      "DATA_DIR=/data",
      "-e",
      "SPARMATE_CLAUDE_JSON=/home/node/.claude.json",
      "-e",
      "SPARMATE_DENYLIST=/home/node/denylist.txt",
      "-v",
      `${study}:/study`,
      "-v",
      `${data}:/data`,
      "-v",
      `${join(root, "claude.json")}:/home/node/.claude.json:ro`,
      "-v",
      `${join(root, "denylist.txt")}:/home/node/denylist.txt:ro`,
      "-v",
      `${KOKORO_VOLUME}:/kokoro:ro`,
      IMAGE_NAME,
    ]);

    if (runRes.code !== 0) {
      throw new Error(`Failed to start container: ${runRes.stderr || runRes.stdout}`);
    }
    containerStarted = true;

    // Poll until container responds on /api/bootstrap
    let token = "";
    for (let i = 0; i < 40; i++) {
      try {
        const res = await request("GET", "/api/bootstrap");
        if (res.status === 200 && res.json?.csrfToken) {
          token = res.json.csrfToken;
          break;
        }
      } catch {
        // waiting
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    check("containerized server started and responds to bootstrap", Boolean(token), `token: ${token ? "received" : "none"}`);
    if (!token) throw new Error("Server did not become ready in container");

    // 1. ws-fake-round end-to-end check against container
    process.stdout.write("Running ws-fake-round against container...\n");
    const wsRound = await runCmd(process.execPath, [join(APP, "scripts", "e2e", "ws-fake-round.mjs")], {
      env: {
        ...process.env,
        PORT: String(PORT),
        TARGET_EXISTING: "1",
        STUDY_ROOT: study,
        DATA_DIR: join(root, "data"),
      },
    });
    check("ws-fake-round against container passes", wsRound.code === 0, wsRound.code !== 0 ? wsRound.stderr || wsRound.stdout.slice(-500) : "ok");

    // 2. C++ runner and sandbox escape checks
    const created = await request("POST", "/api/sessions", {
      headers: { origin: BASE, "x-csrf-token": token },
      body: { problemId: "b3-parking-lot", mode: "interview" },
    });
    check("LLD session created for runner & sandbox checks", created.status === 200, JSON.stringify(created.json));
    const sessionId = created.json.sessionId;

    const ws = new WsClient("runner-check");
    await ws.connect(sessionId, token);
    await ws.waitFor((m) => m.type === "session.state");

    let codeVer = 0;
    async function runCodeSnippet(label, cppCode) {
      codeVer += 1;
      let mark = ws.mark();
      ws.send({ type: "code.update", version: codeVer, content: cppCode });
      await ws.waitFor((m) => m.type === "code.diagnostics" && m.version === codeVer, { since: mark, timeout: 20_000, label: `${label} diagnostics` });
      mark = ws.mark();
      ws.send({ type: "code.run" });
      const res = await ws.waitFor((m) => m.type === "code.run.result" || m.type === "error", {
        since: mark,
        timeout: 25_000,
        label: `${label} run result`,
      });
      return res;
    }

    // Normal C++ execution check
    const normalRes = await runCodeSnippet(
      "normal C++",
      `#include <iostream>\nint main() { std::cout << "NORMAL_CPP_RUN_OK" << std::endl; return 0; }\n`,
    );
    const normalOk =
      normalRes.type === "code.run.result" &&
      normalRes.result.compile.ok &&
      normalRes.result.run?.exitCode === 0 &&
      normalRes.result.run.stdout.includes("NORMAL_CPP_RUN_OK");
    check("C++ runner compiles and runs inside container sandbox", normalOk, normalRes.result?.run?.stdout ?? normalRes.message);

    // Sandbox Escape 1: open a TCP connection (must fail)
    const tcpRes = await runCodeSnippet(
      "escape TCP",
      `#include <iostream>\n#include <sys/socket.h>\n#include <netinet/in.h>\n#include <arpa/inet.h>\n#include <unistd.h>\nint main() {\n  int s = socket(AF_INET, SOCK_STREAM, 0);\n  if (s < 0) return 1;\n  sockaddr_in addr{}; addr.sin_family = AF_INET; addr.sin_port = htons(80);\n  inet_pton(AF_INET, "1.1.1.1", &addr.sin_addr);\n  if (connect(s, (sockaddr*)&addr, sizeof(addr)) == 0) {\n    std::cout << "ESCAPE_TCP_OPEN" << std::endl;\n    close(s);\n    return 0;\n  }\n  close(s);\n  return 2;\n}\n`,
    );
    const tcpEscaped = tcpRes.result?.run?.stdout?.includes("ESCAPE_TCP_OPEN") && tcpRes.result?.run?.exitCode === 0;
    check("sandbox escape: open TCP connection is blocked", !tcpEscaped, `exitCode: ${tcpRes.result?.run?.exitCode}`);

    // Sandbox Escape 2: read study folder outside build directory (must fail)
    const readRes = await runCodeSnippet(
      "escape read",
      `#include <iostream>\n#include <fstream>\n#include <string>\nint main() {\n  for (const auto* p : {"/home/node/study/TRACKER.md", "/study/TRACKER.md"}) {\n    std::ifstream f(p);\n    if (f.is_open()) {\n      std::string s; if (std::getline(f, s)) { std::cout << "ESCAPE_READ_STUDY:" << s << std::endl; return 0; }\n    }\n  }\n  return 1;\n}\n`,
    );
    const readEscaped = readRes.result?.run?.stdout?.includes("ESCAPE_READ_STUDY") && readRes.result?.run?.exitCode === 0;
    check("sandbox escape: read file from study folder outside build dir is blocked", !readEscaped, `exitCode: ${readRes.result?.run?.exitCode}`);

    // Sandbox Escape 3: write outside build directory (must fail)
    const writeRes = await runCodeSnippet(
      "escape write",
      `#include <iostream>\n#include <fstream>\nint main() {\n  for (const auto* p : {"/home/node/escape.txt", "/data/escape.txt", "/study/escape.txt", "/app/sparmate/escape.txt"}) {\n    std::ofstream f(p);\n    if (f.is_open()) { f << "pwned\\n"; f.close(); std::cout << "ESCAPE_WRITE_OUTSIDE" << std::endl; return 0; }\n  }\n  return 1;\n}\n`,
    );
    const writeEscaped = writeRes.result?.run?.stdout?.includes("ESCAPE_WRITE_OUTSIDE") && writeRes.result?.run?.exitCode === 0;
    check("sandbox escape: write outside build dir is blocked", !writeEscaped, `exitCode: ${writeRes.result?.run?.exitCode}`);

    // Sandbox Escape 5: the server's environment, token included, must not be visible through /proc.
    const procRes = await runCodeSnippet(
      "escape proc",
      `#include <dirent.h>\n#include <fstream>\n#include <iostream>\n#include <iterator>\n#include <string>\nint main() {\n  DIR* d = opendir("/proc");\n  if (!d) return 1;\n  while (dirent* e = readdir(d)) {\n    std::string p = std::string("/proc/") + e->d_name + "/environ";\n    std::ifstream f(p, std::ios::binary);\n    std::string s((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());\n    if (s.find("SPARMATE_IN_CONTAINER") != std::string::npos) { std::cout << "ESCAPE_SERVER_ENV" << std::endl; return 0; }\n  }\n  return 2;\n}\n`,
    );
    const procEscaped = procRes.result?.run?.stdout?.includes("ESCAPE_SERVER_ENV");
    check("sandbox escape: the server's environment is not readable through /proc", procRes.type === "code.run.result" && !procEscaped, `exitCode: ${procRes.result?.run?.exitCode}`);

    // Sandbox Escape 4: fork bomb or run past time limit (must fail/time out)
    const timeoutRes = await runCodeSnippet(
      "escape timeout",
      `#include <chrono>\n#include <thread>\nint main() {\n  while (true) { std::this_thread::sleep_for(std::chrono::milliseconds(200)); }\n  return 0;\n}\n`,
    );
    const timedOut = timeoutRes.result?.run?.timedOut === true;
    check("sandbox escape: loop/fork past time limit is killed by runner timeout", timedOut, `timedOut: ${timedOut}`);

    ws.close();

    // 3. Real Kokoro TTS synthesis via POST /api/tts
    const ttsRes = await request("POST", "/api/tts", {
      headers: {
        origin: BASE,
        "x-csrf-token": token,
        "content-type": "application/json",
      },
      body: {
        text: "Sparmate running Kokoro synthesis inside container.",
        voice: "bm_george",
        speed: 1.0,
      },
    });
    const ttsOk =
      ttsRes.status === 200 &&
      ttsRes.headers["content-type"] === "audio/wav" &&
      ttsRes.buf.length > 1000 &&
      ttsRes.buf.subarray(0, 4).toString("ascii") === "RIFF";
    check("real Kokoro TTS synthesis via POST /api/tts in container succeeds", ttsOk, `bytes: ${ttsRes.buf.length}`);
  } finally {
    if (containerStarted) {
      process.stdout.write(`Cleaning up container ${CONTAINER_NAME}...\n`);
      await runCmd(PODMAN, ["rm", "-f", CONTAINER_NAME]);
    }
    await rm(root, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    process.stderr.write(`\n${failed.length} test(s) failed in container-check.\n`);
    process.exit(1);
  }
  process.stdout.write("\nAll container-check tests passed successfully.\n");
}

main().catch((err) => {
  process.stderr.write(`Unhandled error in container-check: ${err.stack || err}\n`);
  process.exit(1);
});
