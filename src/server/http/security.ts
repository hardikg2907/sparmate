import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { FastifyInstance } from "fastify";

/** Vite's dev server proxies to us from this port. */
export const DEV_PORT = 5173;

export function allowedHosts(port: number, inContainer: boolean = process.env.SPARMATE_IN_CONTAINER === "1"): Set<string> {
  if (inContainer) {
    return new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  }
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`, `127.0.0.1:${DEV_PORT}`, `localhost:${DEV_PORT}`]);
}

export function allowedOrigins(port: number, inContainer: boolean = process.env.SPARMATE_IN_CONTAINER === "1"): Set<string> {
  return new Set([...allowedHosts(port, inContainer)].map((h) => `http://${h}`));
}

/** Exact Host match defeats DNS rebinding: a rebound name still arrives with the attacker's host name. */
export function hostAllowed(host: string | undefined, port: number, inContainer: boolean = process.env.SPARMATE_IN_CONTAINER === "1"): boolean {
  return host !== undefined && allowedHosts(port, inContainer).has(host.toLowerCase());
}

export function originAllowed(origin: string | undefined, port: number, inContainer: boolean = process.env.SPARMATE_IN_CONTAINER === "1"): boolean {
  return origin !== undefined && allowedOrigins(port, inContainer).has(origin.toLowerCase());
}

export function newCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenMatches(expected: string, provided: unknown): boolean {
  if (typeof provided !== "string") return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  // timingSafeEqual throws on different lengths, and the length of a fixed-size token reveals nothing.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function isUpgrade(headers: IncomingHttpHeaders): boolean {
  return typeof headers.upgrade === "string" && headers.upgrade.toLowerCase() === "websocket";
}

export function contentSecurityPolicy(port: number): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    `connect-src 'self' ws://127.0.0.1:${port} ws://localhost:${port}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
}

export function securityHeaders(port: number): Record<string, string> {
  return {
    "Content-Security-Policy": contentSecurityPolicy(port),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "microphone=(self)",
  };
}

export type RequestVerdict = { ok: true } | { ok: false; status: 403 | 421; reason: string };

/** The request checks of every route and upgrade, as one pure decision. */
export function checkRequest(
  req: { method: string; url: string; headers: IncomingHttpHeaders },
  port: number,
  csrfToken: string,
  inContainer: boolean = process.env.SPARMATE_IN_CONTAINER === "1",
): RequestVerdict {
  if (!hostAllowed(req.headers.host, port, inContainer)) return { ok: false, status: 421, reason: "host" };
  const upgrade = isUpgrade(req.headers);
  const safeMethod = req.method === "GET" || req.method === "HEAD";
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  if (upgrade || !safeMethod) {
    if (!originAllowed(origin, port, inContainer)) return { ok: false, status: 403, reason: "origin" };
  }
  if (!upgrade && !safeMethod && !tokenMatches(csrfToken, req.headers["x-csrf-token"])) {
    return { ok: false, status: 403, reason: "csrf" };
  }
  if (safeMethod && req.url.startsWith("/api/")) {
    // Reads carry no side effects, but there is no reason to answer another site at all.
    if (origin !== undefined && !originAllowed(origin, port, inContainer)) return { ok: false, status: 403, reason: "origin" };
    if (req.headers["sec-fetch-site"] === "cross-site") return { ok: false, status: 403, reason: "fetch-site" };
  }
  return { ok: true };
}

export function registerSecurity(app: FastifyInstance, opts: { port: number; csrfToken: string; onReject?: (reason: string, url: string) => void }): void {
  const headers = securityHeaders(opts.port);
  app.addHook("onRequest", async (req, reply) => {
    const verdict = checkRequest({ method: req.method, url: req.url, headers: req.headers }, opts.port, opts.csrfToken);
    if (!verdict.ok) {
      opts.onReject?.(verdict.reason, req.url.split("?")[0] ?? "");
      return reply.code(verdict.status).type("application/json").send({ error: verdict.status === 421 ? "Unknown host" : "Forbidden" });
    }
  });
  app.addHook("onSend", async (_req, reply, payload) => {
    for (const [k, v] of Object.entries(headers)) reply.header(k, v);
    return payload;
  });
}
