import { appendFile, readFile } from "node:fs/promises";
import type { Mode, Track } from "../../shared/phases";
import type { Logger } from "./log";
import type { ProblemCatalog } from "./problems";
import { estimateCostUsd } from "./usage-capture";

export interface UsageRecord {
  time: string;
  sessionId: string | null;
  problemId: string | null;
  track: Track | null;
  mode: Mode | null;
  role: string;
  model: string;
  effort: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cost: number | null;
  costUsd: number | null;
  duration: number;
  durationMs: number;
  /** Absent on rows written before failed calls were recorded; read as true. */
  ok?: boolean;
  /** True when the cost was priced from tokens because the SDK gave none. */
  costEstimated?: boolean;
}

export interface UsageTotals {
  cost: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cacheHitRate: number;
  calls: number;
  /** Calls that ended in an error but still spent tokens. */
  failedCalls: number;
  /** Calls whose cost is priced from tokens, not reported by the SDK. */
  estimatedCalls: number;
  rounds: number;
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

export function calcCacheHitRate(inputTokens: number, cacheReadTokens: number, cacheCreationTokens: number): number {
  const total = inputTokens + cacheReadTokens + cacheCreationTokens;
  return total > 0 ? cacheReadTokens / total : 0;
}

export function parseUsageRecord(line: string): UsageRecord | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let raw: any;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;

  const time = typeof raw.time === "string" ? raw.time : null;
  const role = typeof raw.role === "string" ? raw.role : null;
  const model = typeof raw.model === "string" ? raw.model : null;
  const effort = typeof raw.effort === "string" ? raw.effort : "";
  if (!time || !role || !model) return null;

  const inputTokens = typeof raw.inputTokens === "number" && raw.inputTokens >= 0 ? raw.inputTokens : 0;
  const outputTokens = typeof raw.outputTokens === "number" && raw.outputTokens >= 0 ? raw.outputTokens : 0;
  const cacheReadTokens = typeof raw.cacheReadTokens === "number" && raw.cacheReadTokens >= 0 ? raw.cacheReadTokens : 0;
  const cacheCreationTokens = typeof raw.cacheCreationTokens === "number" && raw.cacheCreationTokens >= 0 ? raw.cacheCreationTokens : 0;

  let cost = typeof raw.costUsd === "number" ? raw.costUsd : typeof raw.cost === "number" ? raw.cost : null;
  let costEstimated = raw.costEstimated === true;
  // Rows written before estimates existed stored an unknown cost as 0 next to real tokens.
  if (cost === 0 && raw.costEstimated === undefined && inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens > 0) {
    const estimate = estimateCostUsd(model, { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens });
    if (estimate !== null) {
      cost = estimate;
      costEstimated = true;
    }
  }
  const duration = typeof raw.durationMs === "number" ? raw.durationMs : typeof raw.duration === "number" ? raw.duration : 0;

  const sessionId = typeof raw.sessionId === "string" && raw.sessionId ? raw.sessionId : null;
  const problemId = typeof raw.problemId === "string" && raw.problemId ? raw.problemId : null;
  const track = raw.track === "hld" || raw.track === "lld" ? raw.track : null;
  const mode = raw.mode === "interview" || raw.mode === "guided" ? raw.mode : null;

  return {
    time,
    sessionId,
    problemId,
    track,
    mode,
    role,
    model,
    effort,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    cost,
    costUsd: cost,
    duration,
    durationMs: duration,
    ok: raw.ok !== false,
    costEstimated,
  };
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** The calendar day (YYYY-MM-DD) an instant falls on in the given IANA zone. */
export function dayInZone(instant: Date, timeZone: string): string {
  let f = dayFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormatters.set(timeZone, f);
  }
  return f.format(instant);
}

export interface UsageSummaryOptions {
  /** IANA zone that decides where one day ends and the next begins. Defaults to this machine's zone. */
  timeZone?: string;
}

export interface UsageLedgerOptions {
  filePath: string;
  problems?: ProblemCatalog;
  log?: Logger;
}

export class UsageLedger {
  private readonly filePath: string;
  private readonly problems?: ProblemCatalog;
  private readonly log?: Logger;
  private loggedWriteError = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: UsageLedgerOptions) {
    this.filePath = options.filePath;
    this.problems = options.problems;
    this.log = options.log;
  }

  record(record: UsageRecord): void {
    const line = JSON.stringify(record) + "\n";
    // Fire and forget in sequential order; never block and never throw to caller.
    this.writeQueue = this.writeQueue
      .then(() => appendFile(this.filePath, line, "utf8"))
      .catch((err) => {
        if (!this.loggedWriteError) {
          this.loggedWriteError = true;
          this.log?.error("Failed to append to usage ledger", String(err));
        }
      });
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  async readAll(): Promise<UsageRecord[]> {
    await this.writeQueue;
    let content: string;
    try {
      content = await readFile(this.filePath, "utf8");
    } catch {
      return [];
    }
    const lines = content.split("\n");
    const records: UsageRecord[] = [];
    for (const line of lines) {
      const rec = parseUsageRecord(line);
      if (rec) records.push(rec);
    }
    return records;
  }

  private resolveProblemTitle(problemId: string | null): string {
    if (!problemId) return "General / outside round";
    if (this.problems) {
      const p = this.problems.get(problemId);
      if (p?.meta?.title) return p.meta.title;
    }
    return problemId;
  }

  async summary(options: UsageSummaryOptions = {}): Promise<UsageSummaryResponse> {
    const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const records = await this.readAll();
    let trackingSince: string | null = null;
    for (const r of records) {
      if (!trackingSince || r.time < trackingSince) trackingSince = r.time;
    }

    let totalCost = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalCacheCreationTokens = 0;
    let failedCalls = 0;
    let estimatedCalls = 0;
    const sessionIds = new Set<string>();

    const sessionMap = new Map<string, {
      problemId: string | null;
      date: string;
      mode: Mode | null;
      track: Track | null;
      cost: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      calls: number;
      durationMs: number;
    }>();

    const problemMap = new Map<string, {
      track: Track | null;
      cost: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      calls: number;
      sessions: Set<string>;
    }>();

    const roleMap = new Map<string, {
      cost: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      calls: number;
    }>();

    const modelMap = new Map<string, {
      cost: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      calls: number;
    }>();

    const dayMap = new Map<string, {
      cost: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      calls: number;
    }>();

    for (const r of records) {
      const cost = r.costUsd ?? 0;
      totalCost += cost;
      totalInputTokens += r.inputTokens;
      totalOutputTokens += r.outputTokens;
      totalCacheReadTokens += r.cacheReadTokens;
      totalCacheCreationTokens += r.cacheCreationTokens;
      if (r.ok === false) failedCalls += 1;
      if (r.costEstimated) estimatedCalls += 1;

      if (r.sessionId) {
        sessionIds.add(r.sessionId);
        const s = sessionMap.get(r.sessionId) ?? {
          problemId: r.problemId,
          date: r.time,
          mode: r.mode,
          track: r.track,
          cost: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          calls: 0,
          durationMs: 0,
        };
        s.cost += cost;
        s.inputTokens += r.inputTokens;
        s.outputTokens += r.outputTokens;
        s.cacheReadTokens += r.cacheReadTokens;
        s.cacheCreationTokens += r.cacheCreationTokens;
        s.calls += 1;
        s.durationMs += r.durationMs;
        if (!s.problemId && r.problemId) s.problemId = r.problemId;
        if (!s.mode && r.mode) s.mode = r.mode;
        if (!s.track && r.track) s.track = r.track;
        sessionMap.set(r.sessionId, s);
      }

      if (r.problemId) {
        const p = problemMap.get(r.problemId) ?? {
          track: r.track,
          cost: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          calls: 0,
          sessions: new Set<string>(),
        };
        p.cost += cost;
        p.inputTokens += r.inputTokens;
        p.outputTokens += r.outputTokens;
        p.cacheReadTokens += r.cacheReadTokens;
        p.cacheCreationTokens += r.cacheCreationTokens;
        p.calls += 1;
        if (r.sessionId) p.sessions.add(r.sessionId);
        if (!p.track && r.track) p.track = r.track;
        problemMap.set(r.problemId, p);
      }

      const roleEntry = roleMap.get(r.role) ?? {
        cost: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        calls: 0,
      };
      roleEntry.cost += cost;
      roleEntry.inputTokens += r.inputTokens;
      roleEntry.outputTokens += r.outputTokens;
      roleEntry.cacheReadTokens += r.cacheReadTokens;
      roleEntry.cacheCreationTokens += r.cacheCreationTokens;
      roleEntry.calls += 1;
      roleMap.set(r.role, roleEntry);

      const modelEntry = modelMap.get(r.model) ?? {
        cost: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        calls: 0,
      };
      modelEntry.cost += cost;
      modelEntry.inputTokens += r.inputTokens;
      modelEntry.outputTokens += r.outputTokens;
      modelEntry.cacheReadTokens += r.cacheReadTokens;
      modelEntry.cacheCreationTokens += r.cacheCreationTokens;
      modelEntry.calls += 1;
      modelMap.set(r.model, modelEntry);

      const dayKey = dayInZone(new Date(r.time), timeZone);
      const dayEntry = dayMap.get(dayKey) ?? {
        cost: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        calls: 0,
      };
      dayEntry.cost += cost;
      dayEntry.inputTokens += r.inputTokens;
      dayEntry.outputTokens += r.outputTokens;
      dayEntry.cacheReadTokens += r.cacheReadTokens;
      dayEntry.cacheCreationTokens += r.cacheCreationTokens;
      dayEntry.calls += 1;
      dayMap.set(dayKey, dayEntry);
    }

    const bySession: SessionUsageSummary[] = Array.from(sessionMap.entries())
      .map(([sessionId, s]) => ({
        sessionId,
        problemId: s.problemId,
        problemTitle: this.resolveProblemTitle(s.problemId),
        date: s.date,
        mode: s.mode,
        track: s.track,
        cost: s.cost,
        costUsd: s.cost,
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        cacheReadTokens: s.cacheReadTokens,
        cacheCreationTokens: s.cacheCreationTokens,
        cacheHitRate: calcCacheHitRate(s.inputTokens, s.cacheReadTokens, s.cacheCreationTokens),
        calls: s.calls,
        durationMs: s.durationMs,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    const byProblem: ProblemUsageSummary[] = Array.from(problemMap.entries())
      .map(([problemId, p]) => ({
        problemId,
        problemTitle: this.resolveProblemTitle(problemId),
        track: p.track,
        cost: p.cost,
        costUsd: p.cost,
        inputTokens: p.inputTokens,
        outputTokens: p.outputTokens,
        cacheReadTokens: p.cacheReadTokens,
        cacheCreationTokens: p.cacheCreationTokens,
        cacheHitRate: calcCacheHitRate(p.inputTokens, p.cacheReadTokens, p.cacheCreationTokens),
        calls: p.calls,
        rounds: p.sessions.size,
      }))
      .sort((a, b) => b.cost - a.cost);

    const byRole: RoleUsageSummary[] = Array.from(roleMap.entries())
      .map(([role, ro]) => ({
        role,
        cost: ro.cost,
        costUsd: ro.cost,
        inputTokens: ro.inputTokens,
        outputTokens: ro.outputTokens,
        cacheReadTokens: ro.cacheReadTokens,
        cacheCreationTokens: ro.cacheCreationTokens,
        cacheHitRate: calcCacheHitRate(ro.inputTokens, ro.cacheReadTokens, ro.cacheCreationTokens),
        calls: ro.calls,
      }))
      .sort((a, b) => b.cost - a.cost);

    const byModel: ModelUsageSummary[] = Array.from(modelMap.entries())
      .map(([model, mo]) => ({
        model,
        cost: mo.cost,
        costUsd: mo.cost,
        inputTokens: mo.inputTokens,
        outputTokens: mo.outputTokens,
        cacheReadTokens: mo.cacheReadTokens,
        cacheCreationTokens: mo.cacheCreationTokens,
        cacheHitRate: calcCacheHitRate(mo.inputTokens, mo.cacheReadTokens, mo.cacheCreationTokens),
        calls: mo.calls,
      }))
      .sort((a, b) => b.cost - a.cost);

    // Walk back through calendar dates, not 24-hour steps, so a DST change cannot repeat or skip a day.
    const byDay: DayUsageSummary[] = [];
    const [ty, tm, td] = dayInZone(new Date(), timeZone).split("-").map(Number) as [number, number, number];
    for (let i = 29; i >= 0; i--) {
      const dayStr = new Date(Date.UTC(ty, tm - 1, td - i)).toISOString().slice(0, 10);
      const entry = dayMap.get(dayStr);
      if (entry) {
        byDay.push({
          date: dayStr,
          cost: entry.cost,
          costUsd: entry.cost,
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          cacheReadTokens: entry.cacheReadTokens,
          cacheCreationTokens: entry.cacheCreationTokens,
          cacheHitRate: calcCacheHitRate(entry.inputTokens, entry.cacheReadTokens, entry.cacheCreationTokens),
          calls: entry.calls,
        });
      } else {
        byDay.push({
          date: dayStr,
          cost: 0,
          costUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          cacheHitRate: 0,
          calls: 0,
        });
      }
    }

    return {
      totals: {
        cost: totalCost,
        costUsd: totalCost,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cacheReadTokens: totalCacheReadTokens,
        cacheCreationTokens: totalCacheCreationTokens,
        cacheHitRate: calcCacheHitRate(totalInputTokens, totalCacheReadTokens, totalCacheCreationTokens),
        calls: records.length,
        failedCalls,
        estimatedCalls,
        rounds: sessionIds.size,
      },
      bySession,
      byProblem,
      byRole,
      byModel,
      byDay,
      trackingSince,
    };
  }

  async sessionSummary(sessionId: string): Promise<SessionUsageResponse> {
    const records = await this.readAll();
    const roundRecords = records.filter((r) => r.sessionId === sessionId);
    if (roundRecords.length === 0) {
      return {
        sessionId,
        hasData: false,
        totals: null,
        byRole: [],
      };
    }

    let totalCost = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalCacheCreationTokens = 0;
    let failedCalls = 0;
    let estimatedCalls = 0;

    const roleMap = new Map<string, {
      cost: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      calls: number;
    }>();

    for (const r of roundRecords) {
      const cost = r.costUsd ?? 0;
      totalCost += cost;
      totalInputTokens += r.inputTokens;
      totalOutputTokens += r.outputTokens;
      totalCacheReadTokens += r.cacheReadTokens;
      totalCacheCreationTokens += r.cacheCreationTokens;
      if (r.ok === false) failedCalls += 1;
      if (r.costEstimated) estimatedCalls += 1;

      const roleEntry = roleMap.get(r.role) ?? {
        cost: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        calls: 0,
      };
      roleEntry.cost += cost;
      roleEntry.inputTokens += r.inputTokens;
      roleEntry.outputTokens += r.outputTokens;
      roleEntry.cacheReadTokens += r.cacheReadTokens;
      roleEntry.cacheCreationTokens += r.cacheCreationTokens;
      roleEntry.calls += 1;
      roleMap.set(r.role, roleEntry);
    }

    const byRole: RoleUsageSummary[] = Array.from(roleMap.entries())
      .map(([role, ro]) => ({
        role,
        cost: ro.cost,
        costUsd: ro.cost,
        inputTokens: ro.inputTokens,
        outputTokens: ro.outputTokens,
        cacheReadTokens: ro.cacheReadTokens,
        cacheCreationTokens: ro.cacheCreationTokens,
        cacheHitRate: calcCacheHitRate(ro.inputTokens, ro.cacheReadTokens, ro.cacheCreationTokens),
        calls: ro.calls,
      }))
      .sort((a, b) => b.cost - a.cost);

    return {
      sessionId,
      hasData: true,
      totals: {
        cost: totalCost,
        costUsd: totalCost,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cacheReadTokens: totalCacheReadTokens,
        cacheCreationTokens: totalCacheCreationTokens,
        cacheHitRate: calcCacheHitRate(totalInputTokens, totalCacheReadTokens, totalCacheCreationTokens),
        calls: roundRecords.length,
        failedCalls,
        estimatedCalls,
        rounds: 1,
      },
      byRole,
    };
  }
}
