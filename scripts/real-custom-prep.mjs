import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { copyStudyKit } from "./lib/tempStudy.mjs";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4767;
const BASE = `http://127.0.0.1:${PORT}`;

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
          host: `127.0.0.1:${PORT}`,
          origin: BASE,
          ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const text = buf.toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {}
          resolvePromise({ status: res.statusCode, headers: res.headers, text, json });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const work = await mkdtemp(join(tmpdir(), "ir-real-prep-"));
  const study = join(work, "study");
  const data = join(work, "data");
  await mkdir(join(study, "lld"), { recursive: true });
  await mkdir(data, { recursive: true });

  await copyStudyKit(study);

  const env = { ...process.env, PORT: String(PORT), STUDY_ROOT: study, DATA_DIR: data };
  delete env.SPARMATE_FAKE_AGENT;

  console.log(`Starting real server on port ${PORT}...`);
  const server = spawn(process.execPath, [join(APP, "node_modules", "tsx", "dist", "cli.mjs"), join(APP, "src", "server", "index.ts")], {
    cwd: APP,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  server.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
  server.stderr.on("data", (d) => process.stderr.write(`[server err] ${d}`));

  let csrfToken = "";
  for (let i = 0; i < 40; i++) {
    try {
      const boot = await request("GET", "/api/bootstrap");
      if (boot.status === 200 && boot.json?.csrfToken) {
        csrfToken = boot.json.csrfToken;
        console.log(`Server ready. Fake agent: ${boot.json.fakeAgent}`);
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!csrfToken) {
    console.error("Failed to connect to server");
    server.kill("SIGTERM");
    await rm(work, { recursive: true, force: true });
    process.exit(1);
  }

  const runPrep = async (label, prompt, track = "hld") => {
    console.log(`\n========================================`);
    console.log(`Starting ${label}: "${prompt}"`);
    console.log(`========================================`);
    const startMs = Date.now();

    const postRes = await request("POST", "/api/custom-problems", {
      headers: { "x-csrf-token": csrfToken },
      body: { prompt, track },
    });

    if (postRes.status !== 201) {
      console.error("POST failed:", postRes.status, postRes.text);
      return null;
    }

    const { jobId } = postRes.json;
    console.log(`Job ID: ${jobId}`);

    let lastStage = "";
    let lastSearches = -1;
    let lastPages = -1;
    let finalStatus = null;

    while (true) {
      const res = await request("GET", `/api/custom-problems/${jobId}`, {
        headers: { "x-csrf-token": csrfToken },
      });

      if (res.status === 200 && res.json) {
        const s = res.json;
        if (s.stage !== lastStage || s.searches !== lastSearches || s.pages !== lastPages) {
          console.log(`[${Math.round((Date.now() - startMs) / 1000)}s] Stage: ${s.stage} | Searches: ${s.searches} | Pages: ${s.pages}`);
          lastStage = s.stage;
          lastSearches = s.searches;
          lastPages = s.pages;
        }

        if (s.stage === "ready" || s.stage === "failed") {
          finalStatus = s;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    const durationSec = Math.round((Date.now() - startMs) / 1000);
    console.log(`\nResult for ${label}:`);
    console.log(`Stage: ${finalStatus.stage}`);
    console.log(`Time taken: ${durationSec}s`);
    console.log(`Searches: ${finalStatus.searches}`);
    console.log(`Pages: ${finalStatus.pages}`);
    console.log(`Corrections count: ${finalStatus.corrections?.length ?? 0}`);
    console.log(`Corrections:`, JSON.stringify(finalStatus.corrections, null, 2));
    console.log(`Confidence: ${finalStatus.confidence}`);
    console.log(`Cost (USD): $${finalStatus.costUsd?.toFixed(4) ?? "unknown"}`);

    if (finalStatus.problemId) {
      const problemPath = join(data, "custom-problems", `${finalStatus.problemId}.md`);
      const fileContent = await readFile(problemPath, "utf8").catch(() => "");
      console.log(`Problem file: ${problemPath}`);
      console.log(`Problem title: ${finalStatus.title}`);
      return {
        label,
        prompt,
        durationSec,
        finalStatus,
        fileContent,
      };
    }
    return { label, prompt, durationSec, finalStatus };
  };

  try {
    // Run 1: Niche problem
    const nicheResult = await runPrep(
      "Niche Problem",
      "Design the backend for a live sports score app with 10 million concurrent viewers",
      "hld"
    );

    // Run 2: Classic problem
    const classicResult = await runPrep(
      "Classic Problem",
      "Design an in-memory key-value database with persistence and replication (like Redis)",
      "hld"
    );

    console.log("\n========================================");
    console.log("SUMMARY OF REAL RUNS:");
    console.log("========================================");
    console.log(JSON.stringify({ niche: nicheResult?.finalStatus, classic: classicResult?.finalStatus }, null, 2));
  } finally {
    console.log("Stopping server...");
    server.kill("SIGTERM");
    await new Promise((r) => server.on("close", r));
    await rm(work, { recursive: true, force: true });
    console.log("Cleaned up temp directories.");
  }
}

main().catch((err) => {
  console.error("Error in real prep:", err);
  process.exit(1);
});
