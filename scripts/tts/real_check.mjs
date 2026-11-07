// Real verification script for Kokoro TTS integration on port 4763.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { copyStudyKit } from "../lib/tempStudy.mjs";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 4763;
const KOKORO_HOME = process.env.SPARMATE_KOKORO_HOME;
if (!KOKORO_HOME) throw new Error("Set SPARMATE_KOKORO_HOME to a folder that holds kokoro-v1.0.onnx and voices-v1.0.bin");
const HOST = `127.0.0.1:${PORT}`;
const BASE = `http://${HOST}`;

function request(method, path, { headers = {}, body } = {}) {
  return new Promise((resolvePromise, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        method,
        path,
        headers: {
          host: HOST,
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

async function prepare() {
  const root = await mkdtemp(join(tmpdir(), "ir-kokoro-check-"));
  const study = join(root, "study");
  const data = join(root, "data");
  await mkdir(join(study, "lld"), { recursive: true });
  await mkdir(data, { recursive: true });
  await copyStudyKit(study);
  await writeFile(join(root, "claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "test@example.com" } }));
  await writeFile(join(root, "denylist.txt"), "secretterm\n");
  return { root, study, data };
}

async function main() {
  const dirs = await prepare();
  const sampleDir = "/tmp/ir-voice";
  await mkdir(sampleDir, { recursive: true });
  const samplePath = join(sampleDir, "kokoro-sample.wav");

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
      SPARMATE_KOKORO_HOME: KOKORO_HOME,
    },
  });

  let output = "";
  child.stdout?.on("data", (d) => (output += d));
  child.stderr?.on("data", (d) => (output += d));

  const cleanupServer = async () => {
    if (child.exitCode !== null) return;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      try {
        process.kill(child.pid, "SIGTERM");
      } catch {}
    }
    for (let i = 0; i < 40 && child.exitCode === null; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        try {
          process.kill(child.pid, "SIGKILL");
        } catch {}
      }
    }
  };

  try {
    // Wait for server bootstrap
    let bootstrap = null;
    for (let i = 0; i < 80; i++) {
      try {
        const res = await request("GET", "/api/bootstrap");
        if (res.status === 200 && res.json?.csrfToken) {
          bootstrap = res.json;
          break;
        }
      } catch {}
      if (child.exitCode !== null) {
        throw new Error(`Server failed to start:\n${output}`);
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    if (!bootstrap) throw new Error(`Timed out waiting for server:\n${output}`);

    // Check /api/tts/status
    const statusRes = await request("GET", "/api/tts/status");
    if (statusRes.status !== 200 || !statusRes.json?.available) {
      throw new Error(`TTS status check failed: ${JSON.stringify(statusRes.json)}`);
    }

    // Call POST /api/tts and measure time to first audio
    const t0 = performance.now();
    const ttsRes = await request("POST", "/api/tts", {
      headers: {
        origin: BASE,
        "x-csrf-token": bootstrap.csrfToken,
      },
      body: {
        text: "System design interviews require structure, clarity, and thoughtful tradeoffs.",
        voice: "bm_george",
        speed: 0.95,
      },
    });
    const t1 = performance.now();
    const durationMs = Math.round(t1 - t0);

    if (ttsRes.status !== 200) {
      throw new Error(`POST /api/tts returned ${ttsRes.status}: ${ttsRes.buf.toString("utf8")}`);
    }

    const wavBuf = ttsRes.buf;
    if (wavBuf.length < 44 || wavBuf.subarray(0, 4).toString("ascii") !== "RIFF") {
      throw new Error(`Invalid WAV buffer returned, length: ${wavBuf.length}`);
    }

    await writeFile(samplePath, wavBuf);

    process.stdout.write(
      JSON.stringify({
        ok: true,
        durationMs,
        samplePath,
        bytes: wavBuf.length,
      }) + "\n",
    );
  } finally {
    await cleanupServer();
    await rm(dirs.root, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  process.stderr.write(`Real check failed: ${err.message}\n`);
  process.exit(1);
});
