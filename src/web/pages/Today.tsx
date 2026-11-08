import { useEffect, useMemo, useState } from "react";
import { BASE_MINUTES, phasePlan, type Mode } from "../../shared/phases";
import { REDO_AFTER_DAYS, clockUsedMs, largestOverrun, selectToday, type RedoEntry, type TodayHero, type UnfinishedRound } from "../../shared/today";
import type { ProblemSummary, SessionHistoryItem, Settings } from "../../shared/types";
import { WEEKDAYS, planIndex, weekStart, type DayKind } from "../../shared/week";
import { ConfirmModal } from "../components/ConfirmModal";
import { DiscardNote } from "../components/DiscardNote";
import { CalendarIcon, ChevronRightIcon, ExternalIcon, PlayFilledIcon, WarnIcon } from "../components/icons";
import { PageHeader, PageShell } from "../components/PageShell";
import { SetupCard } from "../components/SetupCard";
import { SidePanel } from "../components/SidePanel";
import { DAY_TITLE, Facts, ModeIcon, ModeSwitch, TRACK_TITLE_SHORT, TrackChip, TrackIcon } from "../components/study";
import { Alert, Button, Card, Skeleton, cn } from "../components/ui";
import { dayMonth, longDate, parseDay, shortDay, weekday, wholeMinutes } from "../lib/dates";
import { MODE_LABEL, formatDate } from "../lib/format";
import { startKey, useStudyData, type StudyData } from "../lib/useStudyData";
import { READINESS_LABEL, VERDICT_LABEL, attemptBadge } from "../lib/verdict";
import { Link } from "../router";
import type { PageContext } from "./context";

const LEETCODE_URL = "https://leetcode.com/problemset/";
const DEBRIEF_MINUTES = 15;

const DAY_SHORT: Record<DayKind, string> = { hld: "HLD", lld: "LLD", dsa: "DSA", redo: "Redo", rest: "Rest" };

function minutesFor(track: ProblemSummary["track"], durations: Settings["durations"]): number {
  return durations[track] ?? BASE_MINUTES[track];
}

export function TodayView({ data, ctx, now = new Date() }: { data: StudyData; ctx: PageContext; now?: Date }) {
  const { problems, history, error } = data;
  const [confirm, setConfirm] = useState<SessionHistoryItem | null>(null);
  const [planOpen, setPlanOpen] = useState(false);

  const pick = useMemo(
    () => (problems && history ? selectToday({ now, plan: ctx.settings.weeklyPlan, problems, history }) : null),
    // `now` is the render-time clock; the pick only needs to move when the data does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [problems, history, ctx.settings.weeklyPlan],
  );
  const dayKind = ctx.settings.weeklyPlan[planIndex(now)] ?? "rest";
  const title = DAY_TITLE[dayKind];

  const askDiscard = (item: SessionHistoryItem) => setConfirm(item);

  return (
    <PageShell testMode={ctx.testMode}>
      <div className="reveal-children space-y-6">
        <PageHeader kicker={longDate(now)} title={title} aside={<WeekStrip plan={ctx.settings.weeklyPlan} history={history ?? []} now={now} />} />

        {ctx.setup.length > 0 ? <SetupCard checks={ctx.setup} /> : null}
        {data.startError ? (
          <Alert tone="bad" role="alert" icon={<WarnIcon size={16} />}>
            {data.startError}
          </Alert>
        ) : null}
        {data.actionError ? (
          <Alert tone="bad" role="alert" icon={<WarnIcon size={16} />}>
            {data.actionError}
          </Alert>
        ) : null}
        {error ? (
          <Alert tone="bad" role="alert" icon={<WarnIcon size={16} />} title="The problem list could not be loaded" actions={<Button onClick={data.reload}>Try again</Button>}>
            {error}
          </Alert>
        ) : null}

        {!pick && !error ? (
          <TodaySkeleton />
        ) : pick ? (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_372px]">
            <Hero hero={pick.hero} data={data} ctx={ctx} now={now} onSeePlan={() => setPlanOpen(true)} onDiscard={askDiscard} />
            <div className="flex flex-col gap-4">
              <UnfinishedCard rounds={pick.unfinished} data={data} onDiscard={askDiscard} now={now} />
              <MoreRedos redos={pick.moreRedos} />
            </div>
          </div>
        ) : null}
      </div>

      {planOpen && pick?.hero.kind === "problem" ? (
        <PlanPanel hero={pick.hero} history={history ?? []} data={data} durations={ctx.settings.durations} onClose={() => setPlanOpen(false)} />
      ) : null}

      {confirm ? (
        <ConfirmModal
          title="Discard this round?"
          confirmLabel="Discard round"
          cancelLabel="Keep the round"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const item = confirm;
            setConfirm(null);
            void data.discard(item.id);
          }}
        >
          <p className="mb-2 font-semibold">
            {confirm.title}, {formatDate(confirm.createdAt)}
          </p>
          <DiscardNote track={confirm.track} />
        </ConfirmModal>
      ) : null}
    </PageShell>
  );
}

export function TodayPage({ ctx }: { ctx: PageContext }) {
  const data = useStudyData();
  useEffect(() => {
    document.title = "Today · Sparmate";
  }, []);
  return <TodayView data={data} ctx={ctx} />;
}

/** A quiet row of the week: today is marked, and a day with a finished round shows its label in green. */
function WeekStrip({ plan, history, now }: { plan: readonly DayKind[]; history: readonly SessionHistoryItem[]; now: Date }) {
  const today = planIndex(now);
  const start = weekStart(now).getTime();
  const worked = new Set(
    history
      .filter((h) => h.status !== "live" && h.status !== "paused" && h.status !== "failed")
      .map((h) => Date.parse(h.createdAt))
      .filter((t) => t >= start && t < start + 7 * 86_400_000)
      .map((t) => Math.floor((t - start) / 86_400_000)),
  );
  return (
    <ol aria-label="This week's plan" className="grid w-full grid-cols-7 gap-1 sm:flex sm:w-auto">
      {WEEKDAYS.map((name, index) => {
        const kind = plan[index] ?? "rest";
        const now = index === today;
        return (
          <li
            key={name}
            aria-current={now ? "date" : undefined}
            className={cn("rounded-lg px-1 pb-1.5 pt-1 text-center sm:w-[52px]", now && "bg-primary-soft ring-1 ring-inset ring-primary/45")}
          >
            <span className={cn("block text-meta", now ? "text-primary-soft-foreground" : "text-faint")}>{name}</span>
            <span className={cn("block text-ui font-semibold", now ? "text-foreground" : worked.has(index) ? "text-success" : "text-muted-foreground")}>{DAY_SHORT[kind]}</span>
          </li>
        );
      })}
    </ol>
  );
}

function TodaySkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_372px]" role="status">
      <span className="sr-only">Loading today's session…</span>
      <Card className="flex flex-col gap-5 p-10">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-14 w-2/3" />
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-16 w-80" />
        <Skeleton className="h-11 w-56" />
      </Card>
      <Skeleton className="h-56 rounded-xl" />
    </div>
  );
}

const CHIP = "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-ui font-bold";
const AMBER_CHIP = `${CHIP} bg-amber text-amber-foreground`;

function dueText(dueOn: string | null, now: Date): string {
  if (!dueOn) return "A redo is due.";
  const due = parseDay(dueOn);
  const days = Math.floor((now.getTime() - due.getTime()) / 86_400_000);
  if (days <= 0) return "Due today.";
  return days < REDO_AFTER_DAYS ? `Due since ${weekday(due)}.` : `Due since ${dayMonth(dueOn)}.`;
}

function lastTryText(problem: ProblemSummary): string {
  const last = problem.lastAttempt;
  if (!last) return "";
  if (last.mode === "guided" && last.readiness)
    return last.readiness === "ready" ? "Your last try was ready for interview mode." : "Your last try was not yet ready for interview mode.";
  return last.verdict ? `Your last result was "${VERDICT_LABEL[last.verdict]}".` : "";
}

function Hero({
  hero,
  data,
  ctx,
  now,
  onSeePlan,
  onDiscard,
}: {
  hero: TodayHero;
  data: StudyData;
  ctx: PageContext;
  now: Date;
  onSeePlan: () => void;
  onDiscard: (item: SessionHistoryItem) => void;
}) {
  const shell = "mesh on-mesh rounded-3xl p-6 sm:p-11";
  const title = "mt-5 font-display text-display font-extrabold tracking-[-0.02em] sm:text-[64px] sm:leading-[68px]";
  const why = "mt-3 max-w-[56ch] text-body text-muted-foreground sm:text-lead";

  if (hero.kind === "problem") {
    const { problem, mode } = hero;
    const minutes = minutesFor(problem.track, ctx.settings.durations);
    const attempt = data.history?.find((h) => h.id === problem.lastAttempt?.sessionId);
    const planned = new Map(phasePlan(problem.track, minutes).map((p) => [p.id, p.minutes]));
    const overrun = largestOverrun(attempt?.phaseTiming, planned);
    const key = startKey(problem.id, mode);
    return (
      <section aria-labelledby="hero-title" className={shell}>
        <div className="flex flex-wrap items-center gap-2">
          {hero.reason === "redo" ? <span className={AMBER_CHIP}>Redo due</span> : <span className={AMBER_CHIP}>New problem</span>}
          <TrackChip track={problem.track} onMesh />
        </div>
        <h2 id="hero-title" className={title}>
          {problem.title}
        </h2>
        <p className={why}>
          {hero.reason === "redo"
            ? [dueText(hero.dueOn, now), lastTryText(problem)].filter(Boolean).join(" ")
            : `Next on your ${TRACK_TITLE_SHORT[problem.track].toLowerCase()} list.`}
        </p>
        <Facts
          onMesh
          className="mt-7"
          items={[
            {
              label: "Mode",
              value: (
                <>
                  <ModeIcon mode={mode} size={18} className="max-sm:hidden" />
                  {MODE_LABEL[mode]}
                </>
              ),
            },
            { label: "Round", value: mode === "guided" ? "No limit" : `${minutes} min` },
            { label: "Debrief", value: `${DEBRIEF_MINUTES} min` },
          ]}
        />
        {overrun ? (
          <p className="mt-5 flex items-center gap-2.5 text-body">
            <WarnIcon size={18} className="text-warning" />
            <span>
              Watch {overrun.label.toLowerCase()}: <b className="font-semibold text-warning">{Math.round(overrun.actualMinutes)} min</b> last time, against a plan of{" "}
              {overrun.plannedMinutes}.
            </span>
          </p>
        ) : null}
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button size="lg" variant="default" busy={data.starting === key} disabled={data.starting !== null} onClick={() => data.start(problem.id, mode)}>
            <PlayFilledIcon size={14} />
            {mode === "guided" ? "Start guided round" : "Start interview round"}
          </Button>
          <Button size="lg" variant="secondary" onClick={onSeePlan}>
            See the plan
          </Button>
          <Link href="/library" className="ml-auto text-ui text-muted-foreground underline decoration-white/30 underline-offset-4 hover:text-foreground">
            Pick another problem
          </Link>
        </div>
      </section>
    );
  }

  if (hero.kind === "resume") {
    const { item } = hero.round;
    return (
      <section aria-labelledby="hero-title" className={shell}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={AMBER_CHIP}>Unfinished</span>
          <TrackChip track={item.track} onMesh />
        </div>
        <h2 id="hero-title" className={title}>
          {item.title}
        </h2>
        <p className={why}>
          {item.pause ? `Paused ${shortDay(item.pause.pausedAt ?? item.createdAt)}. Pick up where you stopped.` : `Started ${shortDay(item.createdAt)}. Pick up where you stopped.`}
        </p>
        <Facts
          onMesh
          className="mt-7"
          items={[
            {
              label: "Mode",
              value: (
                <>
                  <ModeIcon mode={item.mode} size={18} className="max-sm:hidden" />
                  {MODE_LABEL[item.mode]}
                </>
              ),
            },
            { label: "Clock", value: <ClockText round={hero.round} /> },
            { label: "Debrief", value: `${DEBRIEF_MINUTES} min` },
          ]}
        />
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button asChild size="lg" variant="default">
            <Link href={`/session/${item.id}`}>
              <PlayFilledIcon size={14} />
              Finish
            </Link>
          </Button>
          <EndOrDiscard round={hero.round} data={data} onDiscard={onDiscard} size="lg" variant="secondary" />
        </div>
      </section>
    );
  }

  if (hero.kind === "dsa") {
    const gap = hero.gap;
    return (
      <section aria-labelledby="hero-title" className={shell}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={AMBER_CHIP}>DSA</span>
        </div>
        <h2 id="hero-title" className={title}>
          Solve on LeetCode
        </h2>
        <p className={why}>Pick a problem on LeetCode and solve it under a timer. Your goal is {ctx.settings.dsaWeeklyGoal} a week.</p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button asChild size="lg" variant="default">
            <a href={LEETCODE_URL} target="_blank" rel="noopener noreferrer">
              <ExternalIcon size={16} />
              Open LeetCode
            </a>
          </Button>
          {gap ? (
            <Button
              size="lg"
              variant="secondary"
              busy={data.starting === startKey(gap.item.problemId, "guided", gap.gap)}
              disabled={data.starting !== null}
              onClick={() => data.start(gap.item.problemId, "guided", { title: gap.gap.title, goodLooksLike: gap.gap.goodLooksLike })}
            >
              Practise a gap, 20 min
            </Button>
          ) : null}
        </div>
        {gap ? (
          <p className="mt-4 text-ui text-muted-foreground">
            Gap: {gap.gap.title}, from {gap.item.title}.
          </p>
        ) : null}
      </section>
    );
  }

  if (hero.kind === "rest") {
    return (
      <section aria-labelledby="hero-title" className={shell}>
        <h2 id="hero-title" className={title.replace("mt-5 ", "")}>
          Rest day
        </h2>
        <p className={why}>No round is planned today. Rest is part of the plan.</p>
        <div className="mt-8">
          <Button asChild size="lg" variant="secondary">
            <Link href="/library">Pick a problem anyway</Link>
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="hero-title" className={shell}>
      <h2 id="hero-title" className={title.replace("mt-5 ", "")}>
        Nothing to practise yet
      </h2>
      <p className={why}>Every problem is done, or none is loaded. Add your own question, or look through the library.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild size="lg" variant="secondary">
          <Link href="/library">Open the library</Link>
        </Button>
        <Button asChild size="lg" variant="ghost">
          <Link href="/library/new">Practise any question</Link>
        </Button>
      </div>
    </section>
  );
}

function ClockText({ round }: { round: UnfinishedRound }) {
  const used = round.usedMs === null ? null : wholeMinutes(round.usedMs);
  const total = round.item.mode === "guided" || !round.item.clock ? null : Math.round(round.item.clock.durationMs / 60_000);
  if (used === null) return <>Not recorded</>;
  return <>{total === null ? `${used} min` : `${used} of ${total} min`}</>;
}

function EndOrDiscard({
  round,
  data,
  onDiscard,
  size,
  variant,
}: {
  round: UnfinishedRound;
  data: StudyData;
  onDiscard: (item: SessionHistoryItem) => void;
  size?: "sm" | "default" | "lg";
  variant?: "secondary" | "ghost";
}) {
  const busy = data.working === round.item.id;
  if (round.canDebrief) {
    return (
      <Button size={size} variant={variant} busy={busy} disabled={data.working !== null} onClick={() => void data.endAndDebrief(round.item.id)}>
        End and debrief
      </Button>
    );
  }
  return (
    <Button size={size} variant={variant} busy={busy} disabled={data.working !== null} onClick={() => onDiscard(round.item)}>
      Discard
    </Button>
  );
}

function UnfinishedCard({ rounds, data, onDiscard, now }: { rounds: UnfinishedRound[]; data: StudyData; onDiscard: (item: SessionHistoryItem) => void; now: Date }) {
  const first = rounds[0];
  if (!first) return null;
  const { item } = first;
  const total = item.mode === "guided" || !item.clock ? null : item.clock.durationMs;
  const used = first.usedMs ?? clockUsedMs(item, now.getTime());
  const share = total && used !== null ? Math.min(1, used / total) : null;
  const more = rounds.length - 1;
  return (
    <Card variant="raised" className="p-5 sm:p-6" aria-labelledby="unfinished-title">
      <h2 id="unfinished-title" className="text-body font-semibold text-muted-foreground">
        Unfinished
      </h2>
      <div className="mt-3 flex items-center gap-3.5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground" aria-hidden="true">
          <TrackIcon track={item.track} size={18} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-lead font-semibold">{item.title}</p>
          <p className="text-ui text-muted-foreground">{item.pause ? `Paused ${shortDay(item.pause.pausedAt ?? item.createdAt)}` : `Started ${shortDay(item.createdAt)}`}</p>
        </div>
      </div>
      <div className="mt-4">
        <div className="flex items-baseline justify-between text-ui">
          <span className="text-muted-foreground">Clock</span>
          <span className="text-muted-foreground">
            <b className="font-bold text-foreground">{used === null ? "—" : wholeMinutes(used)}</b>
            {total ? ` of ${Math.round(total / 60_000)} min` : " min"}
          </span>
        </div>
        {share !== null ? (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="presentation">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(share * 100)}%` }} />
          </div>
        ) : null}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button asChild variant="secondary">
          <Link href={`/session/${item.id}`}>Finish</Link>
        </Button>
        <EndOrDiscard round={first} data={data} onDiscard={onDiscard} variant="ghost" />
      </div>
      {more > 0 ? (
        <div className="mt-5 border-t border-border pt-4">
          <Link href="/history" className="text-ui font-semibold text-foreground underline-offset-4 hover:underline">
            {more} more unfinished {more === 1 ? "round" : "rounds"}
          </Link>
        </div>
      ) : null}
    </Card>
  );
}

function MoreRedos({ redos }: { redos: RedoEntry[] }) {
  const next = redos[0];
  if (!next) return null;
  return (
    <Link href="/progress" className="group block">
      <Card variant="raised" className="flex items-center gap-3.5 p-5 transition-colors group-hover:bg-accent/40">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground" aria-hidden="true">
          <CalendarIcon size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-body font-semibold">
            {redos.length} more {redos.length === 1 ? "redo" : "redos"}
          </span>
          <span className="block truncate text-ui text-muted-foreground">
            Next: {next.problem.title}
            {next.dueOn ? `, ${next.due ? "now" : shortDay(parseDay(next.dueOn))}` : ""}
          </span>
        </span>
        <ChevronRightIcon size={18} className="text-faint transition-transform group-hover:translate-x-0.5" />
      </Card>
    </Link>
  );
}

function PlanPanel({
  hero,
  history,
  data,
  durations,
  onClose,
}: {
  hero: Extract<TodayHero, { kind: "problem" }>;
  history: readonly SessionHistoryItem[];
  data: StudyData;
  durations: Settings["durations"];
  onClose: () => void;
}) {
  const { problem } = hero;
  const [mode, setMode] = useState<Mode>(hero.mode);
  const minutes = minutesFor(problem.track, durations);
  const plan = phasePlan(problem.track, minutes);
  const attempt = history.find((h) => h.id === problem.lastAttempt?.sessionId);
  const timing = new Map((attempt?.phaseTiming ?? []).map((row) => [row.phase, row.actualMinutes]));
  const total = plan.reduce((sum, p) => sum + p.minutes, 0);
  const badge = problem.lastAttempt ? attemptBadge(problem.lastAttempt) : null;
  const key = startKey(problem.id, mode);
  const last = problem.lastAttempt;
  const tone = badge?.tone === "good" ? "text-success" : badge?.tone === "bad" ? "text-destructive" : "text-warning";
  return (
    <SidePanel
      kicker={problem.title}
      title="Your plan"
      onClose={onClose}
      footer={
        <>
          <Button size="lg" variant="default" busy={data.starting === key} disabled={data.starting !== null} onClick={() => data.start(problem.id, mode)}>
            <PlayFilledIcon size={14} />
            {mode === "guided" ? "Start guided round" : "Start interview round"}
          </Button>
          {attempt ? (
            <Button asChild size="lg" variant="outline">
              <Link href={`/session/${attempt.id}`}>Open last debrief</Link>
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-7">
        <div>
          <p className="mb-2 text-ui text-muted-foreground">Mode</p>
          <ModeSwitch value={mode} onChange={setMode} />
        </div>
        <section aria-label="Step plan">
          <p className="mb-2.5 text-ui text-muted-foreground">
            {mode === "guided" ? `${minutes} minutes of steps, drawn to scale. Guided has no limit.` : `${minutes} minutes, drawn to scale`}
          </p>
          <div className="flex h-2 gap-1" aria-hidden="true">
            {plan.map((p) => (
              <span key={p.id} title={`${p.label}, ${p.minutes} min`} style={{ flexGrow: p.minutes / total, flexBasis: 0 }} className="rounded-full bg-muted-foreground/35" />
            ))}
          </div>
          <table className="mt-4 w-full text-ui">
            <thead>
              <tr className="text-meta text-muted-foreground">
                <th scope="col" className="py-2 text-left font-normal">
                  Step
                </th>
                <th scope="col" className="py-2 text-right font-normal">
                  Plan
                </th>
                <th scope="col" className="py-2 text-right font-normal">
                  Last time
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {plan.map((p) => {
                const actual = timing.get(p.id);
                const over = actual !== undefined && actual > p.minutes * 1.5 && actual - p.minutes >= 3;
                return (
                  <tr key={p.id}>
                    <th scope="row" className={cn("py-2.5 text-left font-normal", over && "text-warning")}>
                      {p.label}
                    </th>
                    <td className="py-2.5 text-right tabular-nums">{p.minutes} min</td>
                    <td className={cn("py-2.5 text-right tabular-nums", actual === undefined ? "text-faint" : over ? "font-semibold text-warning" : "")}>
                      {actual !== undefined ? `${Math.round(actual * 10) / 10} min` : attempt?.phaseTiming ? "Not reached" : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        {last ? (
          <section aria-label="Last try">
            <p className="mb-2 text-ui text-muted-foreground">Last try</p>
            <Facts
              className="sm:grid sm:w-full [&>div]:flex-1"
              items={[
                { label: "Date", value: <span className="text-body">{formatDate(last.date)}</span> },
                { label: "Result", value: <span className={cn("text-body", tone)}>{badge?.label ?? "No result"}</span> },
                {
                  label: last.mode === "guided" ? "Interview mode" : "Mode",
                  value: (
                    <span className="text-body">
                      {last.mode === "guided" ? (last.readiness ? (last.readiness === "ready" ? READINESS_LABEL.ready : "Not ready yet") : "No call") : MODE_LABEL[last.mode]}
                    </span>
                  ),
                },
              ]}
            />
          </section>
        ) : (
          <p className="text-ui text-muted-foreground">No earlier try of this problem.</p>
        )}
      </div>
    </SidePanel>
  );
}
