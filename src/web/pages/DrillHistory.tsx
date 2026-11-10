import { useEffect, useState, type ReactNode } from "react";
import {
  DRILL_INFO,
  OUTCOME_LABEL,
  READY_TO_CLOSE,
  type AttemptView,
  type DrillAttemptRow,
  type DrillDetail,
  type DrillOutcome,
  type DrillScoreView,
  type RecentAttemptRow,
} from "../../shared/drills";
import { DrillIcon } from "../components/DrillIcon";
import { Markdown } from "../components/Markdown";
import { PageHeader, PageShell } from "../components/PageShell";
import { ArrowLeftIcon, ChevronRightIcon, WarnIcon } from "../components/icons";
import { InfoTip } from "../components/study";
import { Alert, Badge, Button, Card, Skeleton, cn } from "../components/ui";
import { earlyNote } from "../lib/drillStart";
import { formatDateTime } from "../lib/format";
import { scoreFill } from "../lib/scoreTone";
import { useHistorySource, useLoaded } from "../lib/useDrillHistory";
import { Link, drillDetailPath, drillPath } from "../router";
import type { PageContext } from "./context";
import { CriteriaList, Lines, Thread } from "./DrillPage";
import { ChangedTag, HOW_A_GAP_CLOSES, Pips, dueText, overdueSince } from "./Gym";

const NO_DETAIL = "No detail was saved for this attempt.";
const RECENT_ATTEMPTS = 20;

const OUTCOME_TONE: Record<DrillOutcome, "good" | "warn" | "bad"> = { ready: "good", getting_there: "warn", needs_work: "bad" };

/** "45 s" or "2 min 05 s". */
export function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;
}

/** A dollar amount with the precision of the usage page: small costs keep four decimals. */
export function formatCost(value: number): string {
  return `$${value < 0.01 ? value.toFixed(4) : value.toFixed(3)}`;
}

function ScoreStrip({ scores }: { scores: readonly DrillScoreView[] }) {
  if (scores.length === 0) return <span className="text-meta text-faint">No scores</span>;
  return (
    <span role="img" aria-label={`Scores: ${scores.map((s) => `${s.label} ${s.score} of 4`).join(", ")}`} className="inline-flex h-4 items-end gap-0.5">
      {scores.map((s) => (
        <b key={s.id} className={cn("w-1.5 rounded-sm", scoreFill(s.score))} style={{ height: `${s.score * 4}px` }} />
      ))}
    </span>
  );
}

function OutcomeMark({ row }: { row: DrillAttemptRow }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <Badge tone={OUTCOME_TONE[row.outcome]}>{OUTCOME_LABEL[row.outcome]}</Badge>
      {row.revised ? <span className="text-meta text-muted-foreground">after a revision</span> : null}
    </span>
  );
}

function GradeBlock({ grade, heading }: { grade: AttemptView["grades"][number]; heading: string | null }) {
  return (
    <div className="space-y-4">
      {heading ? (
        <h4 className="flex flex-wrap items-center gap-2 text-ui font-semibold">
          {heading}
          <Badge tone={OUTCOME_TONE[grade.outcome]}>{OUTCOME_LABEL[grade.outcome]}</Badge>
        </h4>
      ) : null}
      <Section title="How each part scored">
        <CriteriaList scores={grade.scores} />
      </Section>
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="What went well">
          {grade.wentWell.length > 0 ? <Lines lines={grade.wentWell} /> : <p className="mt-3 text-body text-muted-foreground">Nothing stood out.</p>}
        </Section>
        <Section title="What to improve">
          <Lines lines={grade.improve} />
        </Section>
      </div>
      <Section title="Your line">
        <blockquote className="mt-3 rounded-lg border border-border bg-sunken px-4 py-3 text-body">{grade.yourLine || "You left the answer empty."}</blockquote>
      </Section>
      {grade.strong ? (
        <Section title="What a strong answer says">
          <p className="mt-3 text-body">{grade.strong}</p>
        </Section>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-meta font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function AttemptBodyView({ view }: { view: AttemptView }) {
  const conversation = view.turns.length > 0;
  return (
    <div className="space-y-5">
      <Section title="Your task">
        <p className="mt-2 text-body font-semibold">{view.task}</p>
      </Section>
      {view.changed ? (
        <Section title="What changed">
          <Markdown text={view.changed} className="mt-2 text-body" />
        </Section>
      ) : null}
      {conversation ? (
        <Section title="The conversation">
          <div className="mt-3">
            <Thread turns={view.turns} />
          </div>
        </Section>
      ) : (
        view.answers.map((text, i) => (
          <Section key={i} title={view.answers.length > 1 ? (i === 0 ? "Your first try" : "Your revision") : "Your answer"}>
            <p className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-sunken px-4 py-3 font-mono text-ui leading-relaxed">
              {text}
            </p>
          </Section>
        ))
      )}
      {view.grades.map((grade, i) => (
        <GradeBlock key={i} grade={grade} heading={view.grades.length > 1 ? (i === 0 ? "First try" : "After the revision") : null} />
      ))}
    </div>
  );
}

/** Loads the saved attempt when its row opens. */
function AttemptBody({ attemptId }: { attemptId: string }) {
  const source = useHistorySource();
  const loaded = useLoaded(() => source.attempt(attemptId), attemptId, "The attempt could not be loaded.");
  if (loaded.error !== null) {
    return loaded.status === 404 ? (
      <p className="text-ui text-muted-foreground">{NO_DETAIL}</p>
    ) : (
      <Alert tone="bad" role="alert" icon={<WarnIcon size={16} />} title="This attempt could not be loaded" actions={<Button onClick={loaded.reload}>Try again</Button>}>
        {loaded.error}
      </Alert>
    );
  }
  if (!loaded.data) {
    return (
      <div role="status" className="space-y-3">
        <span className="sr-only">Loading the attempt…</span>
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  return <AttemptBodyView view={loaded.data} />;
}

function isRecent(row: DrillAttemptRow | RecentAttemptRow): row is RecentAttemptRow {
  return "drill" in row;
}

function AttemptItem({ row, showKind }: { row: DrillAttemptRow | RecentAttemptRow; showKind: boolean }) {
  const [open, setOpen] = useState(false);
  const panel = `attempt-${row.id}`;
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((v) => !v)}
        className="-mx-3 flex w-[calc(100%+1.5rem)] items-start gap-3 rounded-lg px-3 py-3.5 text-left transition-colors hover:bg-accent/50"
      >
        <ChevronRightIcon size={16} className={cn("mt-1 shrink-0 text-faint transition-transform", open && "rotate-90")} />
        <span className="min-w-0 flex-1 space-y-1.5">
          <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <span className="text-ui text-muted-foreground">
              {formatDateTime(row.at)}
              {showKind && isRecent(row) ? (
                <span className="ml-2 inline-flex items-center gap-1.5 font-semibold text-foreground">
                  <DrillIcon drill={row.drill} size={14} className="text-primary-text" />
                  {row.title}
                </span>
              ) : null}
            </span>
            <OutcomeMark row={row} />
          </span>
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-body font-semibold">
            <span className="min-w-0 break-words">{row.problemTitle}</span>
            <ChangedTag row={row} />
          </span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-muted-foreground">
            {row.scores.length === 0 && row.seconds === null && row.costUsd === null ? (
              <span className="text-faint">No scores, time or cost recorded</span>
            ) : (
              <>
                <ScoreStrip scores={row.scores} />
                {row.seconds === null ? null : <span>{formatSeconds(row.seconds)}</span>}
                {row.costUsd === null ? null : <span>{formatCost(row.costUsd)}</span>}
              </>
            )}
          </span>
        </span>
      </button>
      <div id={panel} hidden={!open} className="pb-5 pl-7 pr-1">
        {open ? (
          <div className="space-y-4">
            {row.legacy ? <p className="text-ui text-muted-foreground">{NO_DETAIL}</p> : <AttemptBody attemptId={row.id} />}
            {isRecent(row) && row.drillId ? (
              <p>
                <Link href={drillDetailPath(row.drillId)} className="text-ui font-semibold text-primary-text underline-offset-4 hover:underline">
                  See the history of this drill
                </Link>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** Attempts as rows that open in place. A recent list passes `showKind`, because its rows mix drill kinds. */
export function AttemptList({ rows, showKind = false, label }: { rows: readonly (DrillAttemptRow | RecentAttemptRow)[]; showKind?: boolean; label: string }) {
  return (
    <ul aria-label={label} className="divide-y divide-border/60">
      {rows.map((row) => (
        <AttemptItem key={row.id} row={row} showKind={showKind} />
      ))}
    </ul>
  );
}

/** The newest attempts of every kind, on the Drills side of Practice. */
export function RecentAttempts() {
  const source = useHistorySource();
  const loaded = useLoaded(() => source.attempts(RECENT_ATTEMPTS), "recent", "The recent attempts could not be loaded.");
  return (
    <Card variant="raised" className="p-5 sm:p-6" aria-labelledby="recent-attempts">
      <h2 id="recent-attempts" className="text-lead font-bold">
        Recent attempts
      </h2>
      {loaded.error !== null ? (
        <div className="mt-3">
          <Alert tone="bad" role="alert" icon={<WarnIcon size={16} />} title="The recent attempts could not be loaded" actions={<Button onClick={loaded.reload}>Try again</Button>}>
            {loaded.error}
          </Alert>
        </div>
      ) : !loaded.data ? (
        <div role="status" className="mt-4 space-y-3">
          <span className="sr-only">Loading recent attempts…</span>
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : loaded.data.length === 0 ? (
        <p className="mt-3 text-ui text-muted-foreground">No drill has been graded yet. Each attempt you finish is listed here.</p>
      ) : (
        <div className="mt-2">
          <AttemptList rows={loaded.data} showKind label="Recent drill attempts" />
        </div>
      )}
    </Card>
  );
}

/** One queued drill: where it stands and every attempt that counted for it. */
export function DrillDetailPage({ ctx, drillId }: { ctx: PageContext; drillId: string }) {
  const source = useHistorySource();
  const loaded = useLoaded(() => source.drill(drillId), drillId, "The drill could not be loaded.");
  useEffect(() => {
    document.title = "Drill history · Sparmate";
  }, []);
  const detail = loaded.data;
  return (
    <PageShell testMode={ctx.testMode}>
      <div className="reveal-children space-y-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2.5">
            <Link href="/practice/drills">
              <ArrowLeftIcon size={14} />
              Practice › Drills
            </Link>
          </Button>
        </div>
        {loaded.error !== null ? (
          <Alert
            tone="bad"
            role="alert"
            icon={<WarnIcon size={16} />}
            title={loaded.status === 404 ? "This drill is not in your schedule" : "The drill could not be loaded"}
            actions={loaded.status === 404 ? undefined : <Button onClick={loaded.reload}>Try again</Button>}
          >
            {loaded.error}
          </Alert>
        ) : !detail ? (
          <div role="status" className="space-y-6">
            <span className="sr-only">Loading the drill…</span>
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        ) : (
          <DrillDetailBody detail={detail} />
        )}
      </div>
    </PageShell>
  );
}

function DrillDetailBody({ detail }: { detail: DrillDetail }) {
  const { item, attempts, today } = detail;
  const open = item.status === "open";
  const used = [...new Set(attempts.map((a) => a.problemTitle))];
  return (
    <>
      <PageHeader
        kicker={
          <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <DrillIcon drill={item.drill} size={16} className="text-primary-text" />
              {DRILL_INFO[item.drill].title}
            </span>
            <Badge tone={open ? "accent" : "good"}>{open ? "Open" : "Closed"}</Badge>
          </span>
        }
        title={item.gapTitle}
        aside={
          open ? (
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <Button asChild size="lg" variant="default">
                <Link href={drillPath({ drill: item.drill, problemId: item.problemId, drillId: item.id })}>Start drill</Link>
              </Button>
              {item.dueOn > today ? <p className="text-ui text-muted-foreground">{earlyNote(item.dueOn, today)}</p> : null}
            </div>
          ) : null
        }
      />
      <Card variant="raised" className="p-5 sm:p-6">
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="flex items-center gap-1 text-meta text-muted-foreground">
              Interview-ready results
              <InfoTip label="How a gap closes">{HOW_A_GAP_CLOSES}</InfoTip>
            </dt>
            <dd className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-lead font-semibold">
              <span className="whitespace-nowrap">
                {item.passes} of {READY_TO_CLOSE}
              </span>
              <Pips filled={item.passes} />
            </dd>
          </div>
          <div>
            <dt className="text-meta text-muted-foreground">{open ? "Comes back" : "Status"}</dt>
            <dd className="mt-1 text-lead font-semibold">
              {open ? (
                <>
                  {dueText(item, today)}
                  {overdueSince(item, today) ? <small className="ml-2 text-meta font-medium text-muted-foreground">{overdueSince(item, today)}</small> : null}
                </>
              ) : (
                "Gap closed"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-meta text-muted-foreground">{open ? "Next problem" : "From your round on"}</dt>
            <dd className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-body font-semibold">
              <span className="min-w-0 break-words">{open ? item.problemTitle : item.originProblemTitle}</span>
              {open ? <ChangedTag row={item} /> : null}
            </dd>
          </div>
          <div>
            <dt className="text-meta text-muted-foreground">Problems it has used</dt>
            <dd className="mt-1 text-body">{used.length > 0 ? used.join(", ") : "None yet"}</dd>
          </div>
        </dl>
        {item.proofs.length > 0 ? <p className="mt-5 border-t border-border pt-4 text-ui text-muted-foreground">Interview-ready on: {item.proofs.join(", ")}.</p> : null}
        {item.originProblemTitle !== item.problemTitle && open ? (
          <p className="mt-2 text-ui text-muted-foreground">The gap came from your round on {item.originProblemTitle}.</p>
        ) : null}
      </Card>
      <Card variant="raised" className="p-5 sm:p-6" aria-labelledby="attempts-title">
        <h2 id="attempts-title" className="text-lead font-bold">
          Attempts
        </h2>
        {attempts.length === 0 ? (
          <p className="mt-3 text-ui text-muted-foreground">No attempt has counted for this drill yet. The first one appears here after you grade it.</p>
        ) : (
          <div className="mt-2">
            <AttemptList rows={attempts} label="Attempts for this drill" />
          </div>
        )}
      </Card>
    </>
  );
}
