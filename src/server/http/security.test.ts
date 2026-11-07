import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { DEV_PORT, allowedHosts, allowedOrigins, checkRequest, hostAllowed, newCsrfToken, originAllowed, registerSecurity, tokenMatches } from "./security";

const PORT = 4750;
const TOKEN = newCsrfToken();
const good = { host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}` };

describe("allowlists", () => {
  it("accepts only the four local hosts", () => {
    for (const h of [`127.0.0.1:${PORT}`, `localhost:${PORT}`, "127.0.0.1:5173", "localhost:5173", `LOCALHOST:${PORT}`]) expect(hostAllowed(h, PORT), h).toBe(true);
    for (const h of [undefined, "evil.example", `evil.example:${PORT}`, "127.0.0.1", `0.0.0.0:${PORT}`, `127.0.0.1:${PORT}.evil`])
      expect(hostAllowed(h, PORT), String(h)).toBe(false);
  });

  it("accepts only http origins of those hosts", () => {
    expect(originAllowed(`http://localhost:${PORT}`, PORT)).toBe(true);
    expect(originAllowed(`https://localhost:${PORT}`, PORT)).toBe(false);
    expect(originAllowed("null", PORT)).toBe(false);
    expect(originAllowed(undefined, PORT)).toBe(false);
  });
});

describe("CSRF token", () => {
  it("is 32 random bytes in base64url", () => {
    expect(TOKEN).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newCsrfToken()).not.toBe(TOKEN);
  });

  it("compares safely, including wrong lengths and types", () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(tokenMatches(TOKEN, `${TOKEN}x`)).toBe(false);
    expect(
      tokenMatches(
        TOKEN,
        TOKEN.replace(/.$/, (c) => (c === "A" ? "B" : "A")),
      ),
    ).toBe(false);
    expect(tokenMatches(TOKEN, undefined)).toBe(false);
    expect(tokenMatches(TOKEN, ["x"])).toBe(false);
  });
});

describe("checkRequest", () => {
  const req = (method: string, url: string, headers: Record<string, string | undefined>) => checkRequest({ method, url, headers }, PORT, TOKEN);

  it("rejects an unknown host with 421 before anything else", () => {
    expect(req("GET", "/", { host: "attacker.example" })).toEqual({ ok: false, status: 421, reason: "host" });
  });

  it("needs a same-origin Origin and the token on writes", () => {
    expect(req("POST", "/api/sessions", { host: good.host })).toMatchObject({ ok: false, reason: "origin" });
    expect(req("POST", "/api/sessions", { host: good.host, origin: "http://evil.example" })).toMatchObject({ ok: false, reason: "origin" });
    expect(req("POST", "/api/sessions", { ...good })).toMatchObject({ ok: false, reason: "csrf" });
    expect(req("PUT", "/api/settings", { ...good, "x-csrf-token": "nope" })).toMatchObject({ ok: false, reason: "csrf" });
    expect(req("POST", "/api/sessions", { ...good, "x-csrf-token": TOKEN })).toEqual({ ok: true });
  });

  it("holds DELETE to the same Origin and token rules as the other writes", () => {
    const url = "/api/sessions/20261030-0900-c2-url-shortener-abcd";
    expect(req("DELETE", url, { host: good.host })).toMatchObject({ ok: false, reason: "origin" });
    expect(req("DELETE", url, { host: good.host, origin: "http://evil.example", "x-csrf-token": TOKEN })).toMatchObject({ ok: false, reason: "origin" });
    expect(req("DELETE", url, { ...good })).toMatchObject({ ok: false, reason: "csrf" });
    expect(req("DELETE", url, { host: "attacker.example", origin: good.origin, "x-csrf-token": TOKEN })).toMatchObject({ ok: false, status: 421 });
    expect(req("DELETE", url, { ...good, "x-csrf-token": TOKEN })).toEqual({ ok: true });
  });

  it("checks Origin on WebSocket upgrades but leaves the token to the hello message", () => {
    expect(req("GET", "/ws/session/x", { host: good.host, upgrade: "websocket" })).toMatchObject({ ok: false, reason: "origin" });
    expect(req("GET", "/ws/session/x", { ...good, upgrade: "WebSocket" })).toEqual({ ok: true });
  });

  it("lets plain reads through but refuses cross-site API reads", () => {
    expect(req("GET", "/", { host: good.host })).toEqual({ ok: true });
    expect(req("GET", "/api/bootstrap", { host: good.host })).toEqual({ ok: true });
    expect(req("GET", "/api/bootstrap", { host: good.host, origin: "http://evil.example" })).toMatchObject({ ok: false });
    expect(req("GET", "/api/bootstrap", { host: good.host, "sec-fetch-site": "cross-site" })).toMatchObject({ ok: false });
  });
});

describe("registerSecurity on a Fastify app", () => {
  async function app() {
    const a = Fastify();
    registerSecurity(a, { port: PORT, csrfToken: TOKEN });
    a.get("/api/ping", async () => ({ ok: true }));
    a.post("/api/thing", async () => ({ done: true }));
    await a.ready();
    return a;
  }

  it("sets the security headers and no CORS headers", async () => {
    const a = await app();
    const res = await a.inject({ method: "GET", url: "/api/ping", headers: { host: good.host } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-security-policy"]).toContain(`connect-src 'self' ws://127.0.0.1:${PORT} ws://localhost:${PORT}`);
    expect(res.headers["content-security-policy"]).toContain("media-src 'self' blob:");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(res.headers["permissions-policy"]).toBe("microphone=(self)");
    expect(Object.keys(res.headers).some((h) => h.startsWith("access-control-"))).toBe(false);
    await a.close();
  });

  it("answers 421 and 403 from the hook", async () => {
    const a = await app();
    expect((await a.inject({ method: "GET", url: "/api/ping", headers: { host: "evil.example" } })).statusCode).toBe(421);
    expect((await a.inject({ method: "POST", url: "/api/thing", headers: { host: good.host }, payload: {} })).statusCode).toBe(403);
    const ok = await a.inject({ method: "POST", url: "/api/thing", headers: { ...good, "x-csrf-token": TOKEN }, payload: {} });
    expect(ok.statusCode).toBe(200);
    await a.close();
  });
});

describe("container mode Host and Origin rules", () => {
  it("restricts allowed hosts strictly to 127.0.0.1 and localhost on published port", () => {
    const hosts = allowedHosts(PORT, true);
    expect(hosts).toEqual(new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]));
    expect(hosts.has(`127.0.0.1:${DEV_PORT}`)).toBe(false);
    expect(hosts.has(`localhost:${DEV_PORT}`)).toBe(false);
    expect(hostAllowed(`127.0.0.1:${PORT}`, PORT, true)).toBe(true);
    expect(hostAllowed(`localhost:${PORT}`, PORT, true)).toBe(true);
    expect(hostAllowed(`0.0.0.0:${PORT}`, PORT, true)).toBe(false);
    expect(hostAllowed("evil.example", PORT, true)).toBe(false);
  });

  it("restricts allowed origins to http://127.0.0.1 and http://localhost on published port", () => {
    const origins = allowedOrigins(PORT, true);
    expect(origins).toEqual(new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]));
    expect(originAllowed(`http://127.0.0.1:${PORT}`, PORT, true)).toBe(true);
    expect(originAllowed(`http://localhost:${PORT}`, PORT, true)).toBe(true);
    expect(originAllowed(`http://localhost:${DEV_PORT}`, PORT, true)).toBe(false);
    expect(originAllowed("http://evil.example", PORT, true)).toBe(false);
  });

  it("evaluates checkRequest correctly under container mode", () => {
    expect(checkRequest({ method: "GET", url: "/api/ping", headers: { host: `127.0.0.1:${PORT}` } }, PORT, TOKEN, true)).toEqual({ ok: true });
    expect(checkRequest({ method: "GET", url: "/api/ping", headers: { host: `0.0.0.0:${PORT}` } }, PORT, TOKEN, true)).toEqual({ ok: false, status: 421, reason: "host" });
    expect(checkRequest({ method: "GET", url: "/api/ping", headers: { host: `localhost:${DEV_PORT}` } }, PORT, TOKEN, true)).toEqual({ ok: false, status: 421, reason: "host" });
  });
});
