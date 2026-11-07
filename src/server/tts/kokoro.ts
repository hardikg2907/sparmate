import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { kokoroVoiceLang, type TtsRequest } from "./schema";

export interface KokoroPaths {
  python: string;
  onnx: string;
  voices: string;
  workerScript: string;
}

export interface KokoroManagerOptions {
  kokoroHome: string;
  appRoot: string;
  timeoutMs?: number;
  idleTimeoutMs?: number;
}

export function findPython(kokoroHome: string): string {
  if (process.env.SPARMATE_PYTHON_PATH && existsSync(process.env.SPARMATE_PYTHON_PATH)) {
    return process.env.SPARMATE_PYTHON_PATH;
  }
  const venvPython = join(kokoroHome, ".venv", "bin", "python");
  // No fallback to a system python: it would report Kokoro available where kokoro-onnx is not installed.
  return venvPython;
}

export function resolveKokoroPaths(kokoroHome: string, appRoot: string): KokoroPaths {
  return {
    python: findPython(kokoroHome),
    onnx: join(kokoroHome, "kokoro-v1.0.onnx"),
    voices: join(kokoroHome, "voices-v1.0.bin"),
    workerScript: join(appRoot, "scripts", "tts", "kokoro_worker.py"),
  };
}

interface QueuedRequest {
  req: TtsRequest;
  resolve: (wav: Buffer) => void;
  reject: (err: Error) => void;
  signal?: AbortSignal;
}

interface ActiveRequest {
  id: string;
  resolve: (wav: Buffer) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/** Manages a long-lived Kokoro Python worker with serial request queuing, timeout, and process restarts. */
export class KokoroManager {
  private readonly paths: KokoroPaths;
  private readonly timeoutMs: number;
  private readonly idleTimeoutMs: number;
  private worker: ChildProcess | null = null;
  private workerPid: number | null = null;
  private stdoutBuffer = "";
  private queue: QueuedRequest[] = [];
  private activeRequest: ActiveRequest | null = null;
  private isProcessing = false;
  private isClosed = false;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(options: KokoroManagerOptions) {
    this.paths = resolveKokoroPaths(options.kokoroHome, options.appRoot);
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 3 * 60_000;
  }

  /** Returns true only when every required binary, model and worker file is present on disk. */
  isAvailable(): boolean {
    return existsSync(this.paths.python) && existsSync(this.paths.onnx) && existsSync(this.paths.voices) && existsSync(this.paths.workerScript);
  }

  /** Synthesizes text into 16-bit mono WAV audio bytes. */
  synthesize(req: TtsRequest, signal?: AbortSignal): Promise<Buffer> {
    if (this.isClosed) {
      return Promise.reject(new Error("Kokoro manager is shut down"));
    }
    if (signal?.aborted) {
      return Promise.reject(new Error("Request aborted"));
    }
    if (!this.isAvailable()) {
      return Promise.reject(new Error("Kokoro TTS is not available"));
    }
    this.clearIdleTimer();
    return new Promise<Buffer>((resolve, reject) => {
      const item: QueuedRequest = { req, resolve, reject, signal };
      const onAbort = () => {
        const idx = this.queue.indexOf(item);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
          reject(new Error("Request aborted"));
          this.resetIdleTimer();
        }
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.queue.push(item);
      void this.processNext();
    });
  }

  /** Spawns the worker lazily on first request with an explicit argument array. */
  private ensureWorker(): ChildProcess {
    if (this.worker && this.workerPid !== null) {
      return this.worker;
    }
    // Command line arguments pass model paths directly without shell expansion.
    const child = spawn(this.paths.python, ["-I", this.paths.workerScript, this.paths.onnx, this.paths.voices], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.worker = child;
    this.workerPid = child.pid ?? null;
    this.stdoutBuffer = "";
    let stderrTail = "";
    // An unread stderr pipe fills up on model warnings and then blocks the worker mid-request.
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString("utf8")).slice(-2000);
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString("utf8");
      let newlineIdx: number;
      while ((newlineIdx = this.stdoutBuffer.indexOf("\n")) !== -1) {
        const line = this.stdoutBuffer.slice(0, newlineIdx).trim();
        this.stdoutBuffer = this.stdoutBuffer.slice(newlineIdx + 1);
        if (line) {
          this.handleWorkerLine(line);
        }
      }
    });

    child.on("error", (err) => {
      this.handleWorkerCrash(err);
    });

    child.on("exit", (code, signal) => {
      this.handleWorkerCrash(new Error(`Worker exited with code ${code ?? signal ?? "unknown"}: ${stderrTail.trim()}`));
    });

    return child;
  }

  private handleWorkerLine(line: string): void {
    if (!this.activeRequest) return;
    try {
      const res = JSON.parse(line) as { id?: string; ok?: boolean; wavBase64?: string; error?: string };
      if (res.id !== this.activeRequest.id) return;

      const current = this.activeRequest;
      clearTimeout(current.timer);
      this.activeRequest = null;

      if (res.ok && typeof res.wavBase64 === "string") {
        current.resolve(Buffer.from(res.wavBase64, "base64"));
      } else {
        current.reject(new Error(res.error || "TTS generation failed"));
      }
    } catch {
      const current = this.activeRequest;
      if (current) {
        clearTimeout(current.timer);
        this.activeRequest = null;
        current.reject(new Error("Invalid response from TTS worker"));
      }
    } finally {
      this.isProcessing = false;
      void this.processNext();
    }
  }

  private handleTimeout(): void {
    if (!this.activeRequest) return;
    const current = this.activeRequest;
    this.activeRequest = null;
    clearTimeout(current.timer);

    this.killWorker();
    current.reject(new Error("TTS request timed out"));

    this.isProcessing = false;
    void this.processNext();
  }

  private handleWorkerCrash(err: Error): void {
    this.killWorker();
    if (this.activeRequest) {
      clearTimeout(this.activeRequest.timer);
      const current = this.activeRequest;
      this.activeRequest = null;
      current.reject(err);
      this.isProcessing = false;
      void this.processNext();
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    if (this.worker && this.queue.length === 0 && !this.activeRequest && !this.isProcessing) {
      this.idleTimer = setTimeout(() => {
        this.killWorker();
      }, this.idleTimeoutMs);
      this.idleTimer.unref?.();
    }
  }

  /** Terminates only the recorded worker PID. */
  private killWorker(): void {
    this.clearIdleTimer();
    const pid = this.workerPid;
    const child = this.worker;
    this.worker = null;
    this.workerPid = null;
    this.stdoutBuffer = "";

    if (child) {
      try {
        child.removeAllListeners();
        if (pid && typeof child.kill === "function") {
          child.kill("SIGKILL");
        }
      } catch {
        // Child process was already terminated.
      }
    }
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing || this.isClosed) return;
    if (this.queue.length === 0) {
      this.resetIdleTimer();
      return;
    }
    this.clearIdleTimer();
    this.isProcessing = true;
    const item = this.queue.shift()!;
    if (item.signal?.aborted) {
      this.isProcessing = false;
      item.reject(new Error("Request aborted"));
      void this.processNext();
      return;
    }

    try {
      const child = this.ensureWorker();
      const id = randomUUID();
      const lang = kokoroVoiceLang(item.req.voice);
      const payload =
        JSON.stringify({
          id,
          text: item.req.text,
          voice: item.req.voice,
          speed: item.req.speed,
          lang,
        }) + "\n";

      const timer = setTimeout(() => {
        this.handleTimeout();
      }, this.timeoutMs);

      this.activeRequest = {
        id,
        resolve: item.resolve,
        reject: item.reject,
        timer,
      };

      child.stdin?.write(payload);
    } catch (err) {
      this.isProcessing = false;
      item.reject(err instanceof Error ? err : new Error(String(err)));
      void this.processNext();
    }
  }

  /** Closes any running worker and empties pending requests. */
  shutdown(): void {
    this.isClosed = true;
    this.clearIdleTimer();
    this.killWorker();

    if (this.activeRequest) {
      clearTimeout(this.activeRequest.timer);
      this.activeRequest.reject(new Error("Kokoro manager is shut down"));
      this.activeRequest = null;
    }

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      item.reject(new Error("Kokoro manager is shut down"));
    }
    this.isProcessing = false;
  }
}
