import { existsSync } from "node:fs";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { LIMITS } from "../../shared/protocol";
import type { ServerConfig } from "../engine/config";
import type { Logger } from "../engine/log";
import type { SessionManager } from "../engine/sessions";
import type { SettingsStore } from "../engine/settings";
import type { SessionStore } from "../engine/store";
import type { KokoroManager } from "../tts/kokoro";
import type { UsageLedger } from "../engine/usage-ledger";
import { registerRoutes } from "./routes";
import { registerSecurity } from "./security";
import { registerSocket } from "./socket";

export interface AppDeps {
  config: ServerConfig;
  csrfToken: string;
  manager: SessionManager;
  settings: SettingsStore;
  store: SessionStore;
  kokoro?: KokoroManager;
  log: Logger;
  usageLedger?: UsageLedger;
}

// The largest browser message is a board PNG; the scene and JSON framing ride on top of it.
const WS_MAX_PAYLOAD = LIMITS.pngBase64Bytes + LIMITS.sceneBytes + 64 * 1024;

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, log } = deps;
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024, trustProxy: false });

  registerSecurity(app, { port: config.port, csrfToken: deps.csrfToken, onReject: (reason, url) => log.warn(`Refused a request to ${url} (${reason})`) });

  app.setErrorHandler((err, req, reply) => {
    const status = typeof (err as { statusCode?: unknown }).statusCode === "number" ? (err as { statusCode: number }).statusCode : 500;
    if (status >= 500) log.error(`Request ${req.method} ${req.url.split("?")[0]} failed`, err);
    const message = status === 413 ? "The request is too large." : status === 415 ? "Send JSON." : status < 500 ? "The request is not valid." : "Something went wrong.";
    return reply.code(status >= 400 && status < 600 ? status : 500).send({ error: message });
  });

  await app.register(fastifyWebsocket, { options: { maxPayload: WS_MAX_PAYLOAD } });
  registerSocket(app, { csrfToken: deps.csrfToken, manager: deps.manager, log });
  registerRoutes(app, deps);

  const haveWeb = existsSync(join(config.webDist, "index.html"));
  if (haveWeb) {
    await app.register(fastifyStatic, { root: config.webDist, prefix: "/", dotfiles: "deny" });
  } else {
    log.warn(`No web build at ${config.webDist}; run "npm run build" first`);
  }
  if (existsSync(config.excalidrawAssets)) {
    await app.register(fastifyStatic, { root: config.excalidrawAssets, prefix: "/excalidraw-assets/", decorateReply: false, dotfiles: "deny" });
  }

  app.setNotFoundHandler(async (req, reply) => {
    const path = req.url.split("?")[0] ?? "";
    const isPage = (req.method === "GET" || req.method === "HEAD") && !path.startsWith("/api") && !path.startsWith("/ws") && !path.startsWith("/excalidraw-assets");
    if (isPage && haveWeb) return reply.type("text/html").header("Cache-Control", "no-cache").sendFile("index.html");
    if (isPage) return reply.code(503).type("text/plain").send('The web app is not built yet. Run "npm run build", then reload.');
    return reply.code(404).send({ error: "Not found" });
  });

  return app;
}
