import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { stringify as toYaml } from "yaml";
import type { Mode, Track } from "../../shared/phases";
import type { CustomProblemJobStatus } from "../../shared/protocol";
import type { Problem } from "../../shared/problem";
import { parseProblem, type ProblemCatalog } from "./problems";
import { commonVars, sectionList, type PromptLoader } from "./prompts";
import {
  BriefCheckerOutputSchema,
  BriefWriterOutputSchema,
  toApiSchema,
  toCompatSchema,
  type BriefCheckerOutput,
  type BriefCorrection,
  type BriefWriterOutput,
} from "./schemas";
import type { ProblemMeta } from "../../shared/problem";
import { DriverError, type Driver, type OneShotResult } from "./driver";
import { dataPaths, type ServerConfig } from "./config";
import { writeFileAtomic } from "./fsutil";
import { localDate } from "./fsutil";
import type { Logger } from "./log";
import { REDACTED, type PrivacyGuard } from "../guard/privacy";
import type { SettingsStore } from "./settings";
import { HttpError } from "./sessions";

const CUSTOM_ID = /^[a-z0-9][a-z0-9-]{1,80}$/;

/** A failure whose text is safe to show on the page as it is. */
class JobFailure extends Error {}

const UNUSABLE_TITLE = "The problem title is not usable after privacy filtering. Rephrase the prompt.";
const UNSAVABLE_PROBLEM = "The prepared problem could not be saved after privacy filtering. Rephrase the prompt.";

/** A title with every redacted term removed, so neither the page nor the id carries a placeholder. */
function cleanTitle(guard: PrivacyGuard, title: string): string {
  return guard.redact(title).split(REDACTED).join(" ").replace(/\s+/g, " ").trim();
}

/** Redacts the free text of a problem and drops the items a redaction would break (links, tags), before any file is built. */
function redactMeta(guard: PrivacyGuard, meta: ProblemMeta): ProblemMeta {
  const clean = (text: string): boolean => guard.findViolations(text).length === 0;
  return {
    ...meta,
    tags: meta.tags.filter(clean),
    ...(meta.sources ? { sources: meta.sources.filter((source) => clean(source.title) && clean(source.url)) } : {}),
    ...(meta.confidence !== undefined ? { confidence: guard.redact(meta.confidence) } : {}),
    ...(meta.corrections
      ? {
          corrections: meta.corrections.map((c) => ({
            section: guard.redact(c.section),
            claim: guard.redact(c.claim),
            fix: guard.redact(c.fix),
            source: guard.redact(c.source),
          })),
        }
      : {}),
  };
}

export function validateProblemBody(
  body: string,
  track: Track,
  id = "test-problem",
  file = "custom-problems/test-problem.md",
): { valid: boolean; error?: string } {
  try {
    const dummyMeta: ProblemMeta = {
      id,
      track,
      title: "Validation Test",
      difficulty: "medium",
      tags: ["test"],
      tracker: null,
      notesFile: `notes/${id}.md`,
      ...(track === "lld" ? { lldFolder: id } : {}),
    };
    const text = `---\n${toYaml(dummyMeta)}---\n\n${body.trim()}\n`;
    const p = parseProblem(text, file, true);
    const words = p.body.split(/\s+/).length;
    if (words < 900) return { valid: false, error: `Body is thin (${words} words)` };
    for (const [heading, text] of Object.entries(p.sections)) {
      if (text.trim().length < 40) return { valid: false, error: `Section "${heading}" is nearly empty` };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, error: (err as Error).message };
  }
}

export function mergeCheckerBrief(
  original: BriefWriterOutput,
  checker: BriefCheckerOutput | null,
  track: Track,
  id = "test-problem",
  file = "custom-problems/test-problem.md",
): { body: string; verified: boolean; corrections: BriefCorrection[] } {
  if (checker && checker.body) {
    const check = validateProblemBody(checker.body, track, id, file);
    if (check.valid) {
      return { body: checker.body, verified: true, corrections: checker.corrections ?? [] };
    }
    return { body: original.body, verified: false, corrections: checker.corrections ?? [] };
  }
  return { body: original.body, verified: false, corrections: [] };
}

export interface CustomJobDeps {
  config: ServerConfig;
  driver: Driver;
  prompts: PromptLoader;
  guard: PrivacyGuard;
  problems: ProblemCatalog;
  settings: SettingsStore;
  log: Logger;
}

export const CUSTOM_JOB_TIMEOUT_MS = 8 * 60 * 1000;

export interface CustomProblemJobRecord {
  id: string;
  stage: "researching" | "writing" | "checking" | "ready" | "failed" | "cancelled";
  searches: number;
  pages: number;
  prompt: string;
  track: Track;
  problemId?: string;
  title?: string;
  sourcesCount?: number;
  checksCount?: number;
  corrections?: BriefCorrection[];
  confidence?: string;
  costUsd?: number;
  error?: string;
  createdAt: number;
  abortController: AbortController;
  timeoutId?: NodeJS.Timeout;
}

function isJobTerminated(job: CustomProblemJobRecord): boolean {
  return job.abortController.signal.aborted || job.stage === "cancelled" || job.stage === "failed";
}

export class CustomProblemJobManager {
  private currentJob: CustomProblemJobRecord | null = null;

  constructor(
    private readonly deps: CustomJobDeps,
    private readonly timeoutMs: number = CUSTOM_JOB_TIMEOUT_MS,
  ) {}

  start(prompt: string, track: Track): { jobId: string } {
    if (this.currentJob && (this.currentJob.stage === "researching" || this.currentJob.stage === "writing" || this.currentJob.stage === "checking")) {
      throw new HttpError(409, "A custom problem is already being prepared.");
    }

    const abortController = new AbortController();
    const job: CustomProblemJobRecord = {
      id: randomUUID(),
      stage: "researching",
      searches: 0,
      pages: 0,
      costUsd: 0,
      prompt,
      track,
      createdAt: Date.now(),
      abortController,
    };
    job.timeoutId = setTimeout(() => {
      if (job.stage === "researching" || job.stage === "writing" || job.stage === "checking") {
        job.stage = "failed";
        job.error = "Preparation timed out. Try again, or rephrase the prompt.";
        job.abortController.abort(new Error("Timeout"));
      }
    }, this.timeoutMs);
    job.timeoutId.unref?.();

    this.currentJob = job;

    void this.run(job);
    return { jobId: job.id };
  }

  cancel(jobId: string): CustomProblemJobStatus | null {
    if (!this.currentJob || this.currentJob.id !== jobId) return null;
    if (this.currentJob.stage === "researching" || this.currentJob.stage === "writing" || this.currentJob.stage === "checking") {
      if (this.currentJob.timeoutId) clearTimeout(this.currentJob.timeoutId);
      this.currentJob.stage = "cancelled";
      this.currentJob.abortController.abort(new Error("Cancelled"));
    }
    return this.get(jobId);
  }

  abortAll(): void {
    if (this.currentJob && (this.currentJob.stage === "researching" || this.currentJob.stage === "writing" || this.currentJob.stage === "checking")) {
      if (this.currentJob.timeoutId) clearTimeout(this.currentJob.timeoutId);
      this.currentJob.stage = "cancelled";
      this.currentJob.abortController.abort(new Error("Shutdown"));
    }
  }

  /** The latest job in any stage, so a reloaded page can pick up a preparation it started. */
  current(): CustomProblemJobStatus | null {
    return this.currentJob ? this.get(this.currentJob.id) : null;
  }

  get(jobId: string): CustomProblemJobStatus | null {
    if (!this.currentJob || this.currentJob.id !== jobId) return null;
    return {
      id: this.currentJob.id,
      stage: this.currentJob.stage,
      searches: this.currentJob.searches,
      pages: this.currentJob.pages,
      error: this.currentJob.error,
      problemId: this.currentJob.problemId,
      title: this.currentJob.title,
      track: this.currentJob.track,
      sourcesCount: this.currentJob.sourcesCount,
      checksCount: this.currentJob.checksCount,
      corrections: this.currentJob.corrections,
      confidence: this.currentJob.confidence,
      costUsd: this.currentJob.costUsd,
    };
  }

  async prepareDirect(prompt: string, track: Track, mode: Mode): Promise<Problem> {
    if (this.currentJob && (this.currentJob.stage === "researching" || this.currentJob.stage === "writing" || this.currentJob.stage === "checking")) {
      throw new HttpError(409, "A custom problem is already being prepared.");
    }
    const abortController = new AbortController();
    const job: CustomProblemJobRecord = {
      id: randomUUID(),
      stage: "researching",
      searches: 0,
      pages: 0,
      prompt,
      track,
      createdAt: Date.now(),
      abortController,
    };
    job.timeoutId = setTimeout(() => {
      if (job.stage === "researching" || job.stage === "writing" || job.stage === "checking") {
        job.stage = "failed";
        job.error = "Preparation timed out. Try again, or rephrase the prompt.";
        job.abortController.abort(new Error("Timeout"));
      }
    }, this.timeoutMs);
    job.timeoutId.unref?.();

    this.currentJob = job;
    await this.run(job, mode);
    if (job.stage === "failed" || job.stage === "cancelled" || !job.problemId) {
      throw new HttpError(502, job.error ?? "Could not prepare that problem. Try again, or rephrase the prompt.");
    }
    const problem = this.deps.problems.get(job.problemId);
    if (!problem) throw new HttpError(502, "Could not load the prepared problem.");
    return problem;
  }

  private async run(job: CustomProblemJobRecord, mode: Mode = "interview"): Promise<void> {
    try {
      await this.deps.problems.reload();
      const example = this.deps.problems.example(job.track);
      if (!example) throw new HttpError(500, "There is no example problem to model a custom problem on.");

      const settings = this.deps.settings.get();
      const durationMin = settings.durations[job.track];

      const onToolUse = (name: string) => {
        if (name === "WebSearch") job.searches++;
        else if (name === "WebFetch") job.pages++;
      };

      // Research and initial brief writing pass
      job.stage = "researching";
      const writerSetup = {
        role: "brief-writer" as const,
        model: settings.models.scribe,
        effort: settings.effort.scribe,
        systemPrompt: async () =>
          this.deps.prompts.render("brief-writer", {
            ...commonVars({
              date: localDate(),
              problemTitle: "Custom problem",
              track: job.track,
              mode,
              durationMin,
              candidateProfile: await this.deps.prompts.candidateProfile(),
            }),
            section_list: sectionList(job.track),
            example_problem: example.body,
          }),
        tools: [],
        fake: { exampleProblem: example, track: job.track, mode },
        usage: { sessionId: null, problemId: null, track: job.track, mode },
        turn: {
          text: `<pasted_prompt>\n${job.prompt}\n</pasted_prompt>\ntrack: ${job.track}`,
          meta: { kind: "oneshot" as const, candidateText: job.prompt },
        },
        output: {
          schema: BriefWriterOutputSchema,
          jsonSchema: toApiSchema(BriefWriterOutputSchema),
          fallbackJsonSchema: toCompatSchema(BriefWriterOutputSchema),
        },
        maxTurns: 18,
        onToolUse,
        signal: job.abortController.signal,
      };

      let writerOut: OneShotResult<BriefWriterOutput>;
      try {
        writerOut = await this.deps.driver.runOnce(writerSetup);
      } catch (err) {
        if (isJobTerminated(job)) return;
        this.deps.log.error("The brief-writer failed", err instanceof DriverError ? err.detail : err);
        throw new HttpError(502, "Could not prepare that problem. Try again, or rephrase the prompt.");
      }

      if (isJobTerminated(job)) return;
      if (!writerOut.output) {
        throw new HttpError(502, "Could not prepare that problem. Try again.");
      }
      if (writerOut.stats.costUsd) {
        job.costUsd = (job.costUsd ?? 0) + writerOut.stats.costUsd;
      }

      job.stage = "writing";

      // Verification pass with brief-checker
      job.stage = "checking";
      const initialWriterOut = writerOut.output;
      let checkerOut: BriefCheckerOutput | null = null;
      try {
        const checkerSetup = {
          role: "brief-checker" as const,
          model: settings.models.scribe,
          effort: settings.effort.scribe,
          systemPrompt: async () =>
            this.deps.prompts.render("brief-checker", {
              ...commonVars({
                date: localDate(),
                problemTitle: initialWriterOut.meta.title,
                track: job.track,
                mode,
                durationMin,
                candidateProfile: await this.deps.prompts.candidateProfile(),
              }),
              example_problem: example.body,
            }),
          tools: [],
          fake: { exampleProblem: example, problem: { ...example, body: initialWriterOut.body }, track: job.track, mode },
          usage: { sessionId: null, problemId: null, track: job.track, mode },
          turn: {
            text: [
              `<brief>\n${initialWriterOut.body}\n</brief>`,
              `<sources>\n${JSON.stringify(initialWriterOut.sources, null, 2)}\n</sources>`,
              `<confidence>\n${initialWriterOut.confidence}\n</confidence>`,
              "Check facts and numbers against cited sources and web search. Return the full corrected body and corrections list.",
            ].join("\n\n"),
            meta: { kind: "oneshot" as const, candidateText: job.prompt },
          },
          output: {
            schema: BriefCheckerOutputSchema,
            jsonSchema: toApiSchema(BriefCheckerOutputSchema),
            fallbackJsonSchema: toCompatSchema(BriefCheckerOutputSchema),
          },
          maxTurns: 14,
          onToolUse,
          signal: job.abortController.signal,
        };

        const res = await this.deps.driver.runOnce(checkerSetup);
        if (res.stats.costUsd) {
          job.costUsd = (job.costUsd ?? 0) + res.stats.costUsd;
        }
        checkerOut = res.output;
      } catch (err) {
        if (isJobTerminated(job)) return;
        this.deps.log.warn("The brief-checker failed; using unverified brief", err instanceof DriverError ? err.detail : err);
      }

      if (isJobTerminated(job)) return;

      const title = cleanTitle(this.deps.guard, initialWriterOut.meta.title);
      if (title.length < 2 || !/[a-z0-9]/i.test(title)) throw new JobFailure(UNUSABLE_TITLE);
      const id = this.customId(title);
      const customDir = dataPaths(this.deps.config.dataDir).customProblems;
      const file = join(customDir, `${id}.md`);

      const { body: finalBody, verified, corrections } = mergeCheckerBrief(
        initialWriterOut,
        checkerOut,
        job.track,
        id,
        file,
      );

      const meta = redactMeta(this.deps.guard, {
        id,
        track: job.track,
        title,
        difficulty: initialWriterOut.meta.difficulty,
        tags: initialWriterOut.meta.tags,
        tracker: null,
        notesFile: `notes/${id}.md`,
        ...(job.track === "lld" ? { lldFolder: id } : {}),
        sources: initialWriterOut.sources,
        confidence: initialWriterOut.confidence,
        verified,
        corrections,
      });

      // Redaction is applied to the parts before they are serialized; redacting the YAML itself could break it.
      const text = `---\n${toYaml(meta)}---\n\n${this.deps.guard.redact(finalBody).trim()}\n`;
      try {
        parseProblem(text, file, true);
      } catch {
        throw new JobFailure(UNSAVABLE_PROBLEM);
      }
      await writeFileAtomic(file, text);
      await this.deps.problems.reload();

      // A cancel or timeout that landed during the write wins over "ready".
      if (isJobTerminated(job)) {
        await unlink(file).catch(() => undefined);
        await this.deps.problems.reload().catch(() => undefined);
        return;
      }
      if (!this.deps.problems.get(id)) {
        await unlink(file).catch(() => undefined);
        throw new JobFailure(UNSAVABLE_PROBLEM);
      }

      job.stage = "ready";
      job.problemId = id;
      job.title = meta.title;
      job.sourcesCount = meta.sources?.length ?? 0;
      job.checksCount = (meta.sources?.length ?? 0) + (corrections.length > 0 ? corrections.length : 1);
      job.corrections = meta.corrections ?? [];
      job.confidence = meta.confidence;
    } catch (err) {
      if (isJobTerminated(job)) return;
      this.deps.log.error("Custom problem preparation failed", err);
      job.stage = "failed";
      job.error = err instanceof JobFailure ? err.message : "Could not prepare that problem. Try again, or rephrase the prompt.";
    } finally {
      if (job.timeoutId) clearTimeout(job.timeoutId);
    }
  }

  private customId(title: string): string {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50)
      .replace(/-+$/g, "");
    let id = `custom-${slug || "problem"}`;
    while (this.deps.problems.get(id) || !CUSTOM_ID.test(id)) {
      id = `custom-${(slug || "problem").slice(0, 40)}-${randomUUID().slice(0, 4)}`;
    }
    return id;
  }
}
