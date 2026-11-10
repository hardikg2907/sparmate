import { useEffect, useState, type CSSProperties } from "react";
import { DRILL_INFO, type DrillType } from "../../shared/drills";
import { api, type UsageSummaryResponse } from "../backend";
import { AppHeader } from "../components/AppHeader";
import { Alert, Badge, Button, Card, EmptyState, SectionTitle, Skeleton, Tooltip, cn } from "../components/ui";
import { TRACK_LABEL, formatDate } from "../lib/format";
import { Link } from "../router";
import { useCountUp } from "../hooks/useCountUp";

export function UsagePage({ initial }: { initial?: UsageSummaryResponse } = {}) {
  const [data, setData] = useState<UsageSummaryResponse | null>(initial ?? null);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .usage()
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load usage data.");
        setLoading(false);
      });
  };

  useEffect(() => {
    if (!initial) load();
  }, [initial]);

  return (
    <div className="page-canvas flex h-full min-h-0 flex-col overflow-y-auto">
      <AppHeader />

      <main tabIndex={-1} className="reveal-children mx-auto w-full max-w-6xl flex-1 space-y-8 px-4 pb-16 pt-8 sm:px-8">
        <div className="space-y-1">
          <h1 className="text-display font-bold tracking-[-0.015em] text-foreground">Model usage and costs</h1>
          <p className="text-ui text-muted-foreground">Model calls, token counts and API-equivalent costs for your practice rounds.</p>
        </div>

        {loading ? (
          <UsageSkeleton />
        ) : error ? (
          <Alert
            tone="bad"
            role="alert"
            title="Failed to load usage"
            actions={
              <Button variant="default" onClick={load}>
                Try again
              </Button>
            }
          >
            {error}
          </Alert>
        ) : !data || data.totals.calls === 0 ? (
          <EmptyUsage trackingSince={data?.trackingSince ?? null} />
        ) : (
          <UsageContent data={data} />
        )}
      </main>
    </div>
  );
}

function UsageSkeleton() {
  return (
    <div className="space-y-12">
      <span role="status" className="sr-only">
        Loading usage statistics…
      </span>
      <Card variant="hero" className="grid gap-6 p-8 lg:grid-cols-[15rem_1fr]">
        <div className="space-y-3">
          <Skeleton className="h-4 w-32 bg-hero-foreground/20" />
          <Skeleton className="h-12 w-40 bg-hero-foreground/20" />
        </div>
        <Skeleton className="h-[120px] w-full bg-hero-foreground/15" />
      </Card>
      <div className="space-y-3">
        <Skeleton className="h-5 w-44" />
        <Card className="overflow-hidden">
          <div className="border-b border-border bg-muted/50 px-5 py-3">
            <Skeleton className="h-3 w-full" />
          </div>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-border px-5 py-3 last:border-b-0">
              <Skeleton className="h-3.5 flex-1" />
              <Skeleton className="h-3.5 w-16" />
              <Skeleton className="h-3.5 w-16" />
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

function EmptyUsage({ trackingSince }: { trackingSince: string | null }) {
  return (
    <div className="space-y-8">
      <EmptyState
        title="No usage recorded yet"
        action={
          <Button asChild variant="default">
            <Link href="/">Start a practice round</Link>
          </Button>
        }
      >
        Once you run interview or guided rounds, or generate custom problems, your model calls, token counts, cache performance and API-equivalent costs will show up here.
      </EmptyState>
      <UsageNotes trackingSince={trackingSince} />
    </div>
  );
}

function UsageContent({ data }: { data: UsageSummaryResponse }) {
  const { bySession, byProblem, byRole, byModel, byDay, trackingSince, drills } = data;
  const { totals } = data;
  const failedCalls = totals.failedCalls ?? 0;
  const estimatedCalls = totals.estimatedCalls ?? 0;
  const discardedRounds = totals.discardedRounds ?? 0;
  const cost = useCountUp(totals.costUsd, { duration: 1100, delay: 200 });

  return (
    <div className="reveal-children space-y-12">
      <section aria-labelledby="totals-heading" className="space-y-4">
        <h2 id="totals-heading" className="sr-only">
          Usage totals
        </h2>
        <Card variant="hero" className="grid gap-x-10 gap-y-6 p-6 sm:p-8 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
          <div className="flex flex-col justify-between gap-4">
            <div>
              <p className="text-ui font-semibold text-hero-muted">API-equivalent cost</p>
              <p className="text-mega font-bold tabular-nums tracking-[-0.02em]">
                {estimatedCalls > 0 ? "≈" : ""}
                {money(cost, 2, totals.costUsd)}
              </p>
              <p className="mt-1 text-meta text-hero-muted">
                {estimatedCalls > 0
                  ? `≈ because ${estimatedCalls.toLocaleString()} ${estimatedCalls === 1 ? "call is" : "calls are"} priced from token counts, as the model gave no figure`
                  : "Calculated from API rates"}
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 text-ui lg:grid-cols-1 lg:gap-y-2">
              <div>
                <dt className="text-hero-muted">Model calls</dt>
                <dd className="font-bold tabular-nums">
                  {totals.calls.toLocaleString()}
                  {failedCalls > 0 && <span className="ml-2 text-meta font-normal text-hero-muted">{failedCalls.toLocaleString()} failed</span>}
                </dd>
              </div>
              <div>
                <dt className="text-hero-muted">Rounds saved</dt>
                <dd className="font-bold tabular-nums">
                  {totals.rounds.toLocaleString()}
                  {discardedRounds > 0 && <span className="ml-2 text-meta font-normal text-hero-muted">{discardedRounds.toLocaleString()} discarded, cost kept</span>}
                </dd>
              </div>
            </dl>
          </div>
          <div aria-labelledby="chart-heading" role="group">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h3 id="chart-heading" className="text-lead font-bold">
                Daily cost, last 30 days
              </h3>
              <span className="text-meta text-hero-muted">Hover for day details</span>
            </div>
            <DailyCostChart days={byDay} />
          </div>
        </Card>

        <Card variant="raised" className="grid grid-cols-2 divide-x divide-border sm:grid-cols-3">
          <StatCell index={0} label="Input tokens" value={totals.inputTokens.toLocaleString()} subtext="Excludes cache reads" />
          <StatCell index={1} label="Output tokens" value={totals.outputTokens.toLocaleString()} subtext="Generated by models" />
          <StatCell
            index={2}
            label="Cache hit rate"
            value={`${(totals.cacheHitRate * 100).toFixed(1)}%`}
            subtext={`${totals.cacheReadTokens.toLocaleString()} read`}
            meter={totals.cacheHitRate}
          />
        </Card>
      </section>

      <DrillsSection drills={drills} />

      {/* 3. By Problem Table */}
      <section aria-labelledby="problems-heading">
        <SectionTitle id="problems-heading">Usage by problem</SectionTitle>
        <Card variant="raised" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-ui">
              <thead className="border-b border-border bg-muted/60 text-meta font-semibold text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">Problem</th>
                  <th className="px-4 py-3 text-right">Rounds</th>
                  <th className="px-4 py-3 text-right">Calls</th>
                  <th className="px-4 py-3 text-right">Input tokens</th>
                  <th className="px-4 py-3 text-right">Output tokens</th>
                  <th className="px-4 py-3 text-right">Cache hit rate</th>
                  <th className="px-4 py-3 text-right">Rounds cost</th>
                  <th className="px-4 py-3 text-right">Drills cost</th>
                  <th className="px-5 py-3 text-right">Total cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {byProblem.map((p) => (
                  <tr key={p.problemId} className="transition-colors hover:bg-accent/40">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{p.problemTitle}</span>
                        {p.track ? <Badge tone={p.track === "hld" ? "accent" : "good"}>{TRACK_LABEL[p.track]}</Badge> : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">{p.rounds}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">{p.calls}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">{p.inputTokens.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">{p.outputTokens.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">{(p.cacheHitRate * 100).toFixed(1)}%</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">{usd(p.roundCost)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">{usd(p.drillCost)}</td>
                    <td className="px-5 py-3 text-right font-mono font-semibold tabular-nums text-foreground">{usd(p.costUsd)}</td>
                  </tr>
                ))}
                {[
                  { row: data.unassigned?.preparation, title: "Preparing your own questions" },
                  { row: data.unassigned?.other, title: "Other calls" },
                ].flatMap(({ row, title }) =>
                  row ? (
                    <tr key={title} className="transition-colors hover:bg-accent/40">
                      <td className="px-5 py-3 font-semibold text-foreground">{title}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-faint">—</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">{row.calls}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">{row.inputTokens.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">{row.outputTokens.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">{(row.cacheHitRate * 100).toFixed(1)}%</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">{usd(row.roundCost)}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">{usd(row.drillCost)}</td>
                      <td className="px-5 py-3 text-right font-mono font-semibold tabular-nums text-foreground">{usd(row.costUsd)}</td>
                    </tr>
                  ) : (
                    []
                  ),
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      {/* 4. By Round Table */}
      <section aria-labelledby="rounds-heading">
        <SectionTitle id="rounds-heading">Usage by round</SectionTitle>
        <Card variant="raised" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-ui">
              <thead className="border-b border-border bg-muted/60 text-meta font-semibold text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-4 py-3">Round</th>
                  <th className="px-4 py-3">Problem</th>
                  <th className="px-4 py-3 text-right">Calls</th>
                  <th className="px-4 py-3 text-right">Input tokens</th>
                  <th className="px-4 py-3 text-right">Output tokens</th>
                  <th className="px-4 py-3 text-right">Cache hit rate</th>
                  <th className="px-5 py-3 text-right">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {bySession.map((s) => (
                  <tr key={s.sessionId} className="transition-colors hover:bg-accent/40">
                    <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">{formatDate(s.date)}</td>
                    <td className="px-4 py-3">
                      {s.discarded ? (
                        <span className="font-mono text-muted-foreground">
                          {s.sessionId.slice(0, 18)}… <span className="font-sans text-meta">discarded</span>
                        </span>
                      ) : (
                        <Link
                          href={`/session/${s.sessionId}`}
                          className="rounded font-mono font-medium text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          {s.sessionId.slice(0, 18)}…
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-foreground">{s.problemTitle}</span>
                      {s.mode ? <span className="ml-2 text-meta text-muted-foreground capitalize">({s.mode})</span> : null}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">{s.calls}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">{s.inputTokens.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">{s.outputTokens.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">{(s.cacheHitRate * 100).toFixed(1)}%</td>
                    <td className="px-5 py-3 text-right font-mono font-semibold tabular-nums text-foreground">${s.costUsd < 0.01 ? s.costUsd.toFixed(4) : s.costUsd.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      {/* 5. By Role and By Model (side by side on wide screens) */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* By Role */}
        <section aria-labelledby="roles-heading">
          <SectionTitle id="roles-heading">Usage by role</SectionTitle>
          <Card variant="raised" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-ui">
                <thead className="border-b border-border bg-muted/60 text-meta font-semibold text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Role</th>
                    <th className="px-3 py-2.5 text-right">Calls</th>
                    <th className="px-3 py-2.5 text-right">Tokens</th>
                    <th className="px-3 py-2.5 text-right">Hit rate</th>
                    <th className="px-4 py-2.5 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {byRole.map((r) => (
                    <tr key={r.role} className="transition-colors hover:bg-accent/40">
                      <td className="px-4 py-2 font-medium text-foreground capitalize">{r.role}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">{r.calls}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">{(r.inputTokens + r.outputTokens).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">{(r.cacheHitRate * 100).toFixed(1)}%</td>
                      <td className="px-4 py-2 text-right font-mono font-semibold tabular-nums text-foreground">
                        ${r.costUsd < 0.01 ? r.costUsd.toFixed(4) : r.costUsd.toFixed(3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>

        {/* By Model */}
        <section aria-labelledby="models-heading">
          <SectionTitle id="models-heading">Usage by model</SectionTitle>
          <Card variant="raised" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-ui">
                <thead className="border-b border-border bg-muted/60 text-meta font-semibold text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Model</th>
                    <th className="px-3 py-2.5 text-right">Calls</th>
                    <th className="px-3 py-2.5 text-right">Tokens</th>
                    <th className="px-3 py-2.5 text-right">Hit rate</th>
                    <th className="px-4 py-2.5 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {byModel.map((m) => (
                    <tr key={m.model} className="transition-colors hover:bg-accent/40">
                      <td className="px-4 py-2 font-mono font-medium text-foreground">{m.model}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">{m.calls}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">{(m.inputTokens + m.outputTokens).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">{(m.cacheHitRate * 100).toFixed(1)}%</td>
                      <td className="px-4 py-2 text-right font-mono font-semibold tabular-nums text-foreground">
                        ${m.costUsd < 0.01 ? m.costUsd.toFixed(4) : m.costUsd.toFixed(3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>
      </div>

      {/* 6. Explanatory Notes */}
      <UsageNotes trackingSince={trackingSince} />
    </div>
  );
}

/** `scale` picks the precision, so a count running up to a total keeps the total's number of decimals. */
function money(value: number, digits: number, scale = value): string {
  return `$${scale < 0.01 ? value.toFixed(4) : value.toFixed(digits)}`;
}

function usd(value: number): string {
  return `$${value < 0.01 ? value.toFixed(4) : value.toFixed(3)}`;
}

const DRILLS_SHOWN = 20;

function drillKindTitle(kind: string | null): string {
  if (kind === null) return "Earlier drills";
  return Object.hasOwn(DRILL_INFO, kind) ? DRILL_INFO[kind as DrillType].title : kind;
}

function DrillsSection({ drills }: { drills: UsageSummaryResponse["drills"] }) {
  const [showAll, setShowAll] = useState(false);
  const attempts = showAll ? drills.byAttempt : drills.byAttempt.slice(0, DRILLS_SHOWN);
  return (
    <section aria-labelledby="drills-heading" className="space-y-4">
      <SectionTitle id="drills-heading">Drills</SectionTitle>
      {drills.calls === 0 ? (
        <p className="text-ui text-muted-foreground">No drills graded yet. Their cost will show here.</p>
      ) : (
        <>
          <Card variant="raised" className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <StatCell index={0} label="Drill cost" value={usd(drills.cost)} subtext="Spent grading answers" />
            <StatCell index={1} label="Attempts" value={drills.attempts.toLocaleString()} subtext="Drills graded and kept" />
            <StatCell
              index={2}
              label="Grader calls"
              value={drills.calls.toLocaleString()}
              subtext={drills.failedCalls > 0 ? `${drills.failedCalls.toLocaleString()} failed` : "Each answer is one or more calls"}
            />
          </Card>

          <h3 className="text-lead font-bold text-foreground">By drill kind</h3>
          <Card variant="raised" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-ui">
                <thead className="border-b border-border bg-muted/60 text-meta font-semibold text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3">Drill kind</th>
                    <th className="px-4 py-3 text-right">Attempts</th>
                    <th className="px-4 py-3 text-right">Calls</th>
                    <th className="px-5 py-3 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {drills.byKind.map((k) => (
                    <tr key={k.kind ?? "earlier"} className="transition-colors hover:bg-accent/40">
                      <td className="px-5 py-3 font-semibold text-foreground">{drillKindTitle(k.kind)}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">{k.attempts}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">{k.calls}</td>
                      <td className="px-5 py-3 text-right font-mono font-semibold tabular-nums text-foreground">{usd(k.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {drills.byAttempt.length > 0 ? (
            <>
              <h3 className="text-lead font-bold text-foreground">By attempt</h3>
              <Card variant="raised" className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-ui">
                    <thead className="border-b border-border bg-muted/60 text-meta font-semibold text-muted-foreground">
                      <tr>
                        <th className="px-5 py-3">Date</th>
                        <th className="px-4 py-3">Drill kind</th>
                        <th className="px-4 py-3">Problem</th>
                        <th className="px-4 py-3 text-right">Calls</th>
                        <th className="px-5 py-3 text-right">Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {attempts.map((a) => (
                        <tr key={a.attemptId} className="transition-colors hover:bg-accent/40">
                          <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">{formatDate(a.date)}</td>
                          <td className="px-4 py-3 font-medium text-foreground">{drillKindTitle(a.kind)}</td>
                          <td className="px-4 py-3 text-foreground">{a.problemTitle}</td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                            {a.calls}
                            {a.failedCalls > 0 ? <span className="ml-2 text-meta font-normal">{a.failedCalls} failed</span> : null}
                          </td>
                          <td className="px-5 py-3 text-right font-mono font-semibold tabular-nums text-foreground">{usd(a.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {drills.byAttempt.length > DRILLS_SHOWN ? (
                  <div className="border-t border-border px-5 py-3">
                    <Button variant="default" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
                      {showAll ? "Show fewer" : `Show all ${drills.byAttempt.length.toLocaleString()}`}
                    </Button>
                  </div>
                ) : null}
              </Card>
            </>
          ) : null}

          {drills.startedOver && drills.startedOver.attempts > 0 ? (
            <p className="text-meta text-muted-foreground">
              {drills.startedOver.attempts.toLocaleString()} {drills.startedOver.attempts === 1 ? "drill was" : "drills were"} started over ({usd(drills.startedOver.cost)},{" "}
              {drills.startedOver.calls.toLocaleString()} {drills.startedOver.calls === 1 ? "call" : "calls"}). The cost is in the total, but they are not attempts.
            </p>
          ) : null}
          {drills.legacyAttempts ? (
            <p className="text-meta text-muted-foreground">
              {drills.legacyAttempts.toLocaleString()} earlier {drills.legacyAttempts === 1 ? "attempt was" : "attempts were"} saved before drill costs were recorded, so{" "}
              {drills.legacyAttempts === 1 ? "it has" : "they have"} no cost. They still count on Progress and in the drill history.
            </p>
          ) : null}
          {drills.earlier.calls > 0 ? (
            <p className="text-meta text-muted-foreground">
              {drills.earlier.calls.toLocaleString()} grader {drills.earlier.calls === 1 ? "call" : "calls"} ({usd(drills.earlier.cost)}) were recorded before drills had ids, so
              they have no row by attempt.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function StatCell({ index, label, value, subtext, meter }: { index: number; label: string; value: string; subtext: string; meter?: number }) {
  return (
    <div
      className="reveal flex flex-col gap-1 p-5 [&:nth-child(3)]:max-sm:col-span-2 [&:nth-child(3)]:max-sm:border-t [&:nth-child(3)]:max-sm:border-border"
      style={{ "--i": index } as CSSProperties}
    >
      <div className="text-ui font-semibold text-muted-foreground">{label}</div>
      <div className="text-title font-bold tabular-nums text-foreground">{value}</div>
      {meter !== undefined ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted ring-1 ring-inset ring-border" role="img" aria-label={`${(meter * 100).toFixed(1)} percent`}>
          <div
            className="fill-x h-full rounded-full bg-chart-2 bg-linear-to-r from-chart-5 to-chart-2 transition-[width] duration-200"
            style={{ width: `${Math.min(100, meter * 100)}%`, "--fill-at": "450ms" } as CSSProperties}
          />
        </div>
      ) : null}
      <div className="text-meta text-muted-foreground">{subtext}</div>
    </div>
  );
}

function DailyCostChart({ days }: { days: UsageSummaryResponse["byDay"] }) {
  const maxCost = Math.max(0.001, ...days.map((d) => d.costUsd));
  const height = 120;

  return (
    <div className="space-y-3">
      <div className="flex h-[120px] items-end gap-1 sm:gap-2">
        {days.map((day, index) => {
          const ratio = Math.min(1, day.costUsd / maxCost);
          const barHeight = day.costUsd > 0 ? Math.max(4, Math.round(ratio * height)) : 0;
          return (
            <Tooltip
              key={day.date}
              side="top"
              content={`${day.date}: $${day.costUsd.toFixed(4)} (${day.calls} calls, ${(day.inputTokens + day.outputTokens).toLocaleString()} tokens)`}
            >
              <div className="flex h-full flex-1 flex-col items-center justify-end">
                <div
                  style={{ height: `${barHeight}px`, "--j": index, "--fill-at": "300ms" } as CSSProperties}
                  className={cn(
                    "grow-y w-full rounded-t transition-[filter,box-shadow] duration-150",
                    day.costUsd > 0 ? "bar-fill bg-hero-accent hover:shadow-[0_0_14px_var(--hero-button-glow)] hover:brightness-110" : "bg-hero-foreground/15",
                  )}
                />
              </div>
            </Tooltip>
          );
        })}
      </div>
      <div className="flex justify-between border-t border-hero-foreground/25 pt-2 font-mono text-meta tabular-nums text-hero-muted">
        <span>{days[0]?.date}</span>
        <span>Past 30 days</span>
        <span>{days[days.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function UsageNotes({ trackingSince }: { trackingSince: string | null }) {
  const dateFormatted = trackingSince ? formatDate(trackingSince) : null;
  return (
    <div className="surface-flat space-y-1.5 rounded-xl bg-card p-5 text-ui text-muted-foreground">
      <p>Cost is what the same calls would cost on the API. On a Claude plan you pay by plan limits, not by this amount.</p>
      <p>
        A failed call counts in every total. A model process that stops before it reports its usage counts with the tokens seen until then. So does a round you discarded or a drill
        you started over.
      </p>
      <p>
        {dateFormatted
          ? `Tracking started on ${dateFormatted}; rounds before that show no data.`
          : "Tracking started when this feature was installed; rounds before that show no data."}
      </p>
    </div>
  );
}
