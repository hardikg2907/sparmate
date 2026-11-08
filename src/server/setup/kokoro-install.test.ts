import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KokoroAsset } from "../tts/kokoro-assets";
import { downloadVerified, findQualifyingPython, installKokoro, parsePythonVersion, versionAtLeast, type DownloadOptions } from "./kokoro-install";

const BODY = Buffer.from("pretend model bytes ".repeat(5000));
const HASH = createHash("sha256").update(BODY).digest("hex");

let dir: string;
let server: Server;
let base: string;
let hits: number;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kokoro-install-"));
  hits = 0;
  server = createServer((req, res) => {
    hits++;
    if (req.url === "/model") {
      res.writeHead(200, { "content-length": BODY.length });
      res.end(BODY);
    } else if (req.url === "/bad") {
      res.writeHead(200);
      res.end(Buffer.from("something else"));
    } else if (req.url === "/gone") {
      res.writeHead(404);
      res.end();
    } else {
      res.writeHead(500);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

const local = (extra: Partial<DownloadOptions> = {}): DownloadOptions => ({ url: `${base}/model`, dest: join(dir, "model.bin"), sha256: HASH, allowHttp: true, ...extra });

describe("downloadVerified", () => {
  it("writes the file only after the checksum matches, and reports progress", async () => {
    const seen: number[] = [];
    await downloadVerified(local({ onProgress: (received) => seen.push(received) }));
    expect(await readFile(join(dir, "model.bin"))).toEqual(BODY);
    expect(existsSync(join(dir, "model.bin.part"))).toBe(false);
    expect(seen.at(-1)).toBe(BODY.length);
  });

  it("deletes the partial file and fails on a checksum mismatch", async () => {
    await expect(downloadVerified(local({ url: `${base}/bad` }))).rejects.toThrow(/checksum/);
    expect(await readdir(dir)).toEqual([]);
  });

  it("fails on an error status without leaving files", async () => {
    await expect(downloadVerified(local({ url: `${base}/gone` }))).rejects.toThrow(/404/);
    expect(await readdir(dir)).toEqual([]);
  });

  it("refuses a plain HTTP address before any request", async () => {
    await expect(downloadVerified({ ...local(), allowHttp: false })).rejects.toThrow(/HTTPS/);
    expect(hits).toBe(0);
  });

  it("refuses an answer that arrived over plain HTTP after a redirect", async () => {
    const fetchImpl = (async () => new Response(BODY, { status: 200 })) as unknown as typeof fetch;
    const fakeRedirected = (async () => {
      const response = await fetchImpl("https://example.test/model");
      Object.defineProperty(response, "url", { value: `${base}/model` });
      return response;
    }) as unknown as typeof fetch;
    await expect(downloadVerified({ ...local({ url: "https://example.test/model" }), allowHttp: false, fetchImpl: fakeRedirected })).rejects.toThrow(/not HTTPS/);
    expect(await readdir(dir)).toEqual([]);
  });
});

describe("installKokoro", () => {
  const asset = (name: string): KokoroAsset => ({ fileName: name, url: `${base}/model`, sha256: HASH });

  it("fetches missing files, skips verified ones and replaces a wrong one", async () => {
    await writeFile(join(dir, "good.bin"), BODY);
    await writeFile(join(dir, "wrong.bin"), "stale");
    const commands: string[] = [];
    const log: string[] = [];
    await installKokoro({
      kokoroHome: dir,
      python: "python3.12",
      log: (line) => log.push(line),
      runVisible: async (command, args) => {
        commands.push([command, ...args].join(" "));
        return 0;
      },
      assets: [asset("good.bin"), asset("wrong.bin"), asset("new.bin")],
      allowHttp: true,
    });
    expect(hits).toBe(2);
    for (const name of ["good.bin", "wrong.bin", "new.bin"]) expect(await readFile(join(dir, name))).toEqual(BODY);
    expect(commands[0]).toBe(`python3.12 -m venv ${join(dir, ".venv")}`);
    expect(commands[1]).toBe(`${join(dir, ".venv", "bin", "pip")} install kokoro-onnx==0.4.7 soundfile==0.13.1`);
    expect(log.some((line) => line.includes("good.bin is already downloaded"))).toBe(true);
  });

  it("fails when pip fails", async () => {
    await expect(
      installKokoro({ kokoroHome: dir, python: "python3.12", log: () => {}, runVisible: async (command) => (command.endsWith("pip") ? 1 : 0), assets: [], allowHttp: true }),
    ).rejects.toThrow(/packages/);
  });
});

describe("python discovery", () => {
  it("parses versions", () => {
    expect(parsePythonVersion("3.12\n")).toEqual({ major: 3, minor: 12 });
    expect(parsePythonVersion("nonsense")).toBeNull();
    expect(versionAtLeast({ major: 3, minor: 11 }, { major: 3, minor: 11 })).toBe(true);
    expect(versionAtLeast({ major: 3, minor: 9 }, { major: 3, minor: 11 })).toBe(false);
  });

  it("picks the first candidate that is new enough, skipping missing and old ones", async () => {
    const versions: Record<string, string | null> = { "python3.13": null, "python3.12": "3.12", python3: "3.9" };
    const spawn = async (command: string) => {
      const v = versions[command];
      return v ? { finished: true, exitCode: 0, stdout: `${v}\n` } : { finished: false, exitCode: null, stdout: "" };
    };
    expect(await findQualifyingPython(spawn)).toBe("python3.12");
  });

  it("returns null when none qualifies", async () => {
    const spawn = async (command: string) => (command === "python3" ? { finished: true, exitCode: 0, stdout: "3.9\n" } : { finished: false, exitCode: null, stdout: "" });
    expect(await findQualifyingPython(spawn)).toBeNull();
  });
});
