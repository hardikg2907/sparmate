import type { FastifyInstance, FastifyReply } from "fastify";
import { CreateSessionSchema, PrepareCustomProblemSchema, type BootstrapResponse } from "../../shared/protocol";
import { DrillReviseSchema, DrillSubmitSchema, DrillTargetSchema } from "../../shared/drills";
import { SettingsSchema } from "../../shared/types";
import type { ServerConfig } from "../engine/config";
import type { DrillService } from "../engine/drills";
import type { Logger } from "../engine/log";
import { HttpError, type SessionManager } from "../engine/sessions";
import type { SettingsStore } from "../engine/settings";
import { SESSION_ID, type SessionStore } from "../engine/store";
import type { KokoroManager } from "../tts/kokoro";
import { TtsRequestSchema } from "../tts/schema";
import type { UsageLedger } from "../engine/usage-ledger";
import type { SetupStatus } from "../setup/checks";
import type { LeetcodeService } from "../leetcode/service";
import { withDefaultCountFrom } from "../../shared/dsa";
import { localDay } from "../../shared/week";

export interface RouteDeps {
  config: ServerConfig;
  csrfToken: string;
  manager: SessionManager;
  settings: SettingsStore;
  store: SessionStore;
  kokoro?: KokoroManager;
  log: Logger;
  usageLedger?: UsageLedger;
  setupStatus?: SetupStatus;
  leetcode?: LeetcodeService;
  drills?: DrillService;
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: "Not found" });
}

function badRequest(reply: FastifyReply, message = "The request is not valid.") {
  return reply.code(400).send({ error: message });
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { config, manager, store, settings } = deps;

  app.get("/api/bootstrap", async (): Promise<BootstrapResponse> => ({
    csrfToken: deps.csrfToken,
    version: config.version,
    studyRoot: config.studyRoot,
    fakeAgent: config.fakeAgent,
    setup: (await deps.setupStatus?.get()) ?? [],
  }));

  app.get("/api/problems", async () => manager.problemSummaries());

  app.post("/api/custom-problems", async (req, reply) => {
    const parsed = PrepareCustomProblemSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(reply);
    try {
      const job = manager.startCustomProblemJob(parsed.data.prompt, parsed.data.track);
      return reply.code(201).send({ jobId: job.jobId });
    } catch (err) {
      if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  app.get("/api/custom-problems", async () => ({ job: manager.currentCustomProblemJob() }));

  app.get<{ Params: { jobId: string } }>("/api/custom-problems/:jobId", async (req, reply) => {
    const status = manager.getCustomProblemJob(req.params.jobId);
    if (!status) return notFound(reply);
    return status;
  });

  app.delete<{ Params: { jobId: string } }>("/api/custom-problems/:jobId", async (req, reply) => {
    const status = manager.cancelCustomProblemJob(req.params.jobId);
    if (!status) return notFound(reply);
    return status;
  });

  app.post("/api/sessions", async (req, reply) => {
    const parsed = CreateSessionSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(reply);
    try {
      const sessionId = await manager.create(parsed.data);
      return { sessionId };
    } catch (err) {
      if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  app.get("/api/sessions", async () => manager.history());

  app.get<{ Params: { id: string } }>("/api/sessions/:id", async (req, reply) => {
    if (!SESSION_ID.test(req.params.id)) return notFound(reply);
    const session = await manager.publicSession(req.params.id);
    return session ?? notFound(reply);
  });

  app.delete<{ Params: { id: string } }>("/api/sessions/:id", async (req, reply) => {
    if (!SESSION_ID.test(req.params.id)) return notFound(reply);
    try {
      await manager.discard(req.params.id);
      return { ok: true };
    } catch (err) {
      if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>("/api/sessions/:id/end", async (req, reply) => {
    if (!SESSION_ID.test(req.params.id)) return notFound(reply);
    try {
      await manager.end(req.params.id);
      return { ok: true };
    } catch (err) {
      if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  app.get<{ Params: { id: string } }>("/api/sessions/:id/board", async (req, reply) => {
    if (!SESSION_ID.test(req.params.id) || !(await manager.session(req.params.id))) return notFound(reply);
    return store.readBoard(req.params.id);
  });

  app.get<{ Params: { id: string } }>("/api/sessions/:id/board-final.png", async (req, reply) => {
    if (!SESSION_ID.test(req.params.id)) return notFound(reply);
    const png = await store.readFinalPng(req.params.id);
    if (!png) return notFound(reply);
    return reply.type("image/png").header("Cache-Control", "no-store").send(png);
  });

  app.get<{ Params: { id: string } }>("/api/sessions/:id/code", async (req, reply) => {
    if (!SESSION_ID.test(req.params.id)) return notFound(reply);
    const rt = await manager.open(req.params.id);
    const snapshot = rt ? await rt.codeSnapshot() : null;
    return snapshot ?? notFound(reply);
  });

  app.get("/api/gym", async (_req, reply) => {
    if (!deps.drills) return notFound(reply);
    return deps.drills.summary();
  });

  app.post("/api/gym/prompt", async (req, reply) => {
    const parsed = DrillTargetSchema.safeParse(req.body);
    if (!parsed.success || !deps.drills) return badRequest(reply);
    try {
      return await deps.drills.prompt(parsed.data);
    } catch (err) {
      if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  app.post("/api/gym/submit", async (req, reply) => {
    const parsed = DrillSubmitSchema.safeParse(req.body);
    const typed = (req.body as { answer?: unknown } | null)?.answer;
    if (typeof typed === "string" && typed.trim() === "") return badRequest(reply, "Write an answer first.");
    if (!parsed.success || !deps.drills) return badRequest(reply, "Write an answer of up to 8000 characters.");
    const { answer, elapsedSeconds, ...target } = parsed.data;
    try {
      return await deps.drills.submit(target, answer, elapsedSeconds);
    } catch (err) {
      if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  app.post("/api/gym/revise", async (req, reply) => {
    const parsed = DrillReviseSchema.safeParse(req.body);
    const typed = (req.body as { answer?: unknown } | null)?.answer;
    if (typeof typed === "string" && typed.trim() === "") return badRequest(reply, "Write an answer first.");
    if (!parsed.success || !deps.drills) return badRequest(reply, "Write an answer of up to 8000 characters.");
    try {
      return await deps.drills.revise(parsed.data.attemptId, parsed.data.answer, parsed.data.elapsedSeconds);
    } catch (err) {
      if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  app.get("/api/settings", async () => settings.get());

  app.put("/api/settings", async (req, reply) => {
    const parsed = SettingsSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(reply, "Those settings are not valid.");
    return settings.save(withDefaultCountFrom(parsed.data, localDay(new Date())));
  });

  app.get("/api/dsa", async (_req, reply) => {
    if (!deps.leetcode) return reply.code(503).send({ error: "LeetCode progress is not available." });
    return deps.leetcode.get();
  });

  // A POST, so the CSRF check applies. The service still enforces its minimum wait between reads.
  app.post("/api/dsa/refresh", async (_req, reply) => {
    if (!deps.leetcode) return reply.code(503).send({ error: "LeetCode progress is not available." });
    return deps.leetcode.get({ force: true });
  });

  app.get("/api/tts/status", async () => {
    return { available: deps.kokoro?.isAvailable() ?? false };
  });

  app.post("/api/tts", async (req, reply) => {
    const parsed = TtsRequestSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(reply);
    if (!deps.kokoro || !deps.kokoro.isAvailable()) {
      return reply.code(503).send({ error: "Kokoro TTS is not available." });
    }
    const abortCtrl = new AbortController();
    req.raw.on("close", () => {
      if (!reply.raw.writableEnded) {
        abortCtrl.abort();
      }
    });
    try {
      const wav = await deps.kokoro.synthesize(parsed.data, abortCtrl.signal);
      return reply.code(200).type("audio/wav").header("Cache-Control", "no-store").send(wav);
    } catch (err) {
      if (abortCtrl.signal.aborted) return;
      deps.log.error("TTS generation failed", err);
      return reply.code(500).send({ error: "TTS generation failed." });
    }
  });

  app.get("/api/usage", async () => {
    if (!deps.usageLedger) {
      return {
        totals: {
          cost: 0,
          costUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          cacheHitRate: 0,
          calls: 0,
          rounds: 0,
          failedCalls: 0,
          estimatedCalls: 0,
        },
        bySession: [],
        byProblem: [],
        byRole: [],
        byModel: [],
        byDay: [],
        trackingSince: null,
      };
    }
    return deps.usageLedger.summary();
  });

  app.get<{ Params: { id: string } }>("/api/sessions/:id/usage", async (req, reply) => {
    if (!SESSION_ID.test(req.params.id)) return notFound(reply);
    if (!deps.usageLedger) {
      return { sessionId: req.params.id, hasData: false, totals: null, byRole: [] };
    }
    return deps.usageLedger.sessionSummary(req.params.id);
  });
}
