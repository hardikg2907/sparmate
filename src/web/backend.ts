import type { BootstrapResponse, ClientMsg, CreateSessionRequest, CustomProblemJobStatus, ServerMsg } from "../shared/protocol";
import type { Mode, Track } from "../shared/phases";
import type { ProblemSummary, PublicSession, SessionStatus, Settings, Verdict } from "../shared/types";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Bootstrap and the CSRF token. The token lives in this module's memory only: reading it from storage
// would let any script on the origin replay it, and a reload fetches a fresh one anyway.

let bootstrap: Promise<BootstrapResponse> | null = null;

export function getBootstrap(refresh = false): Promise<BootstrapResponse> {
  if (!bootstrap || refresh) {
    const pending = requestJson<BootstrapResponse>("GET", "/api/bootstrap", undefined, null);
    bootstrap = pending;
    // A failed fetch must not stay cached, or Retry would keep returning the same rejection.
    pending.catch(() => {
      if (bootstrap === pending) bootstrap = null;
    });
  }
  return bootstrap;
}

async function readError(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object") {
      const { error, message } = body as { error?: unknown; message?: unknown };
      if (typeof message === "string" && message) return message;
      if (typeof error === "string" && error) return error;
    }
  } catch {
    // Not JSON; fall through to the generic text.
  }
  if (res.status === 404) return "Not found";
  if (res.status === 403) return "The page is out of date. Reload and try again.";
  if (res.status >= 500) return "The server hit an error.";
  return "The request failed.";
}

async function requestJson<T>(method: string, path: string, body: unknown, token: string | null): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (token) headers["x-csrf-token"] = token;
  if (body !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "Cannot reach the Sparmate server.");
  }
  if (!res.ok) throw new ApiError(res.status, await readError(res));
  return (await res.json()) as T;
}

async function request<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  if (method === "GET") return requestJson<T>(method, path, undefined, null);
  const send = async (refresh: boolean) => requestJson<T>(method, path, body, (await getBootstrap(refresh)).csrfToken);
  try {
    return await send(false);
  } catch (error) {
    // The token changes on every server start, so a 403 after a restart is fixed by one refresh.
    if (error instanceof ApiError && error.status === 403) return send(true);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// REST helpers

export interface SessionHistoryItem {
  id: string;
  problemId: string;
  title: string;
  track: Track;
  mode: Mode;
  createdAt: string;
  status: SessionStatus;
  verdict: Verdict | null;
  /** Set while paused: why, and the round time left (null in a guided round). */
  pause: { reason: NonNullable<PublicSession["pauseReason"]>; timeLeftMs: number | null } | null;
  notesSaved: boolean;
}

export interface BoardSnapshot {
  version: number;
  elements: Record<string, unknown>[];
}

export interface CodeSnapshot {
  version: number;
  content: string;
  path: string;
}

const enc = encodeURIComponent;

export const api = {
  problems: () => request<ProblemSummary[]>("GET", "/api/problems"),
  history: () => request<SessionHistoryItem[]>("GET", "/api/sessions"),
  createSession: (body: CreateSessionRequest) => request<{ sessionId: string }>("POST", "/api/sessions", body),
  prepareCustomProblem: (body: { prompt: string; track: Track }) =>
    request<{ jobId: string }>("POST", "/api/custom-problems", body),
  currentCustomProblemJob: () => request<{ job: CustomProblemJobStatus | null }>("GET", "/api/custom-problems"),
  customProblemJob: (jobId: string) =>
    request<CustomProblemJobStatus>("GET", `/api/custom-problems/${enc(jobId)}`),
  cancelCustomProblemJob: (jobId: string) =>
    request<CustomProblemJobStatus>("DELETE", `/api/custom-problems/${enc(jobId)}`),
  discardSession: (id: string) => request<{ ok: true }>("DELETE", `/api/sessions/${enc(id)}`),
  session: (id: string) => request<PublicSession>("GET", `/api/sessions/${enc(id)}`),
  board: (id: string) => request<BoardSnapshot>("GET", `/api/sessions/${enc(id)}/board`),
  code: (id: string) => request<CodeSnapshot>("GET", `/api/sessions/${enc(id)}/code`),
  boardPngUrl: (id: string) => `/api/sessions/${enc(id)}/board-final.png`,
  settings: () => request<Settings>("GET", "/api/settings"),
  saveSettings: (settings: Settings) => request<unknown>("PUT", "/api/settings", settings),
  ttsStatus: () => request<{ available: boolean }>("GET", "/api/tts/status"),
  synthesizeSpeech: async (
    body: { text: string; voice: string; speed: number },
    signal?: AbortSignal,
  ): Promise<Blob> => {
    const send = async (refresh: boolean) => {
      const token = (await getBootstrap(refresh)).csrfToken;
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "audio/wav",
        "x-csrf-token": token,
      };
      const res = await fetch("/api/tts", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        credentials: "same-origin",
        cache: "no-store",
        signal,
      });
      if (!res.ok) {
        throw new ApiError(res.status, await readError(res));
      }
      return res.blob();
    };
    try {
      return await send(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) return send(true);
      throw err;
    }
  },
  usage: () => request<UsageSummaryResponse>("GET", "/api/usage"),
  sessionUsage: (id: string) => request<SessionUsageResponse>("GET", `/api/sessions/${enc(id)}/usage`),
};

export interface UsageTotals {
  cost: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cacheHitRate: number;
  calls: number;
  rounds: number;
  /** Absent from a server that predates the counts. */
  failedCalls?: number;
  estimatedCalls?: number;
}

export interface SessionUsageSummary {
  sessionId: string;
  problemId: string | null;
  problemTitle: string;
  date: string;
  mode: Mode | null;
  track: Track | null;
  cost: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cacheHitRate: number;
  calls: number;
  durationMs: number;
}

export interface ProblemUsageSummary {
  problemId: string;
  problemTitle: string;
  track: Track | null;
  cost: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cacheHitRate: number;
  calls: number;
  rounds: number;
}

export interface RoleUsageSummary {
  role: string;
  cost: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cacheHitRate: number;
  calls: number;
}

export interface ModelUsageSummary {
  model: string;
  cost: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cacheHitRate: number;
  calls: number;
}

export interface DayUsageSummary {
  date: string;
  cost: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cacheHitRate: number;
  calls: number;
}

export interface UsageSummaryResponse {
  totals: UsageTotals;
  bySession: SessionUsageSummary[];
  byProblem: ProblemUsageSummary[];
  byRole: RoleUsageSummary[];
  byModel: ModelUsageSummary[];
  byDay: DayUsageSummary[];
  trackingSince: string | null;
}

export interface SessionUsageResponse {
  sessionId: string;
  hasData: boolean;
  totals: UsageTotals | null;
  byRole: RoleUsageSummary[];
}

// ---------------------------------------------------------------------------
// WebSocket

export type SocketStatus = "connecting" | "open" | "reconnecting" | "closed";

type ServerType = ServerMsg["type"];
export type ServerHandler<T extends ServerType> = (msg: Extract<ServerMsg, { type: T }>) => void;

/** What the session hook needs from a socket, so a scripted one can stand in without a server. */
export interface SocketLike {
  readonly connected: boolean;
  readonly status: SocketStatus;
  on<T extends ServerType>(type: T, handler: ServerHandler<T>): () => void;
  onStatus(handler: (status: SocketStatus) => void): () => void;
  send(msg: ClientMsg): boolean;
  connect(): void;
  close(): void;
}

export interface SocketDeps {
  url: string;
  /** `refresh` is true on retries, because a restarted server has a new token. */
  getToken: (refresh: boolean) => Promise<string>;
  createSocket?: (url: string) => WebSocket;
}

const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 10_000;
const QUICK_RETRY_MS = 300;
/** Consecutive attempts that never heard from the server before the socket stops and asks the user. */
const MAX_SILENT_ATTEMPTS = 8;
/** Close codes the server uses: a stale or missing token, and a session that does not exist. */
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_NOT_FOUND = 4404;

export class SessionSocket implements SocketLike {
  status: SocketStatus = "closed";
  private ws: WebSocket | null = null;
  private authed = false;
  private heard = false;
  private everHeard = false;
  private needFreshToken = false;
  private silentAttempts = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private generation = 0;
  private readonly handlers = new Map<string, Set<(msg: ServerMsg) => void>>();
  private readonly statusHandlers = new Set<(status: SocketStatus) => void>();

  constructor(private readonly deps: SocketDeps) {}

  get connected(): boolean {
    return this.authed && this.ws?.readyState === 1;
  }

  connect(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.silentAttempts = 0;
    void this.open();
  }

  close(): void {
    this.stopped = true;
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const ws = this.ws;
    this.ws = null;
    this.authed = false;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      ws.close(1000);
    }
    this.setStatus("closed");
  }

  on<T extends ServerType>(type: T, handler: ServerHandler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const stored = handler as (msg: ServerMsg) => void;
    set.add(stored);
    return () => {
      set.delete(stored);
    };
  }

  onStatus(handler: (status: SocketStatus) => void): () => void {
    this.statusHandlers.add(handler);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  send(msg: ClientMsg): boolean {
    if (!this.connected || !this.ws) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  private setStatus(status: SocketStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const handler of [...this.statusHandlers]) handler(status);
  }

  private async open(): Promise<void> {
    const gen = ++this.generation;
    this.setStatus(this.everHeard || this.silentAttempts > 0 ? "reconnecting" : "connecting");
    let token: string;
    try {
      token = await this.deps.getToken(this.silentAttempts > 0 || this.needFreshToken);
      this.needFreshToken = false;
    } catch {
      if (gen === this.generation) this.afterDrop(gen);
      return;
    }
    if (this.stopped || gen !== this.generation) return;

    let ws: WebSocket;
    try {
      ws = this.deps.createSocket ? this.deps.createSocket(this.deps.url) : new WebSocket(this.deps.url);
    } catch {
      this.afterDrop(gen);
      return;
    }
    this.ws = ws;
    this.authed = false;
    this.heard = false;

    ws.onopen = () => {
      if (gen !== this.generation) return;
      ws.send(JSON.stringify({ type: "hello", token }));
      this.authed = true;
      this.setStatus("open");
    };
    ws.onmessage = (event) => {
      if (gen !== this.generation) return;
      let msg: unknown;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object" || typeof (msg as { type?: unknown }).type !== "string") return;
      // The server answers a rejected connection with an error frame and then closes, so an error frame
      // alone does not prove the connection was good.
      if ((msg as { type: string }).type !== "error") {
        this.heard = true;
        this.everHeard = true;
        this.silentAttempts = 0;
      }
      this.dispatch(msg as ServerMsg);
    };
    ws.onclose = (event) => {
      if (gen !== this.generation) return;
      this.ws = null;
      this.authed = false;
      this.afterDrop(gen, event.code);
    };
    // The close event always follows an error, so retry logic lives there only.
    ws.onerror = () => {};
  }

  private afterDrop(gen: number, code?: number): void {
    if (this.stopped || gen !== this.generation) return;
    if (code === CLOSE_NOT_FOUND) {
      // The session is gone; trying again cannot help.
      this.stopped = true;
      this.setStatus("closed");
      return;
    }
    if (code === CLOSE_UNAUTHORIZED) this.needFreshToken = true;
    if (!this.heard) this.silentAttempts += 1;
    if (this.silentAttempts >= MAX_SILENT_ATTEMPTS) {
      this.stopped = true;
      this.setStatus("closed");
      return;
    }
    this.setStatus("reconnecting");
    const delay = this.heard
      ? QUICK_RETRY_MS
      : Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (this.silentAttempts - 1)) * (0.75 + Math.random() * 0.5);
    this.heard = false;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.stopped) void this.open();
    }, delay);
  }

  private dispatch(msg: ServerMsg): void {
    const set = this.handlers.get(msg.type);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        handler(msg);
      } catch (error) {
        console.error("Socket handler failed", error);
      }
    }
  }
}

export function sessionSocketUrl(sessionId: string): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/ws/session/${encodeURIComponent(sessionId)}`;
}

export function createSessionSocket(sessionId: string): SessionSocket {
  return new SessionSocket({
    url: sessionSocketUrl(sessionId),
    getToken: async (refresh) => (await getBootstrap(refresh)).csrfToken,
  });
}
