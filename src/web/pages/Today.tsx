import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { DsaResponse } from "../../shared/dsa";
import type { GymDrillRow, GymSummary } from "../../shared/drills";
import { BASE_MINUTES, phasePlan, type Mode } from "../../shared/phases";
import { focusSkill } from "../../shared/progress";
import { clockUsedMs, isAttempt, largestOverrun, selectToday, type RedoEntry, type TodayHero, type UnfinishedRound } from "../../shared/today";
import type { ProblemSummary, SessionHistoryItem, Settings } from "../../shared/types";
import { DEFAULT_WEEKLY_PLAN, WEEKDAYS, planIndex, type DayKind } from "../../shared/week";
import { ConfirmModal } from "../components/ConfirmModal";
import { DiscardNote } from "../components/DiscardNote";
import { CalendarIcon, ChevronRightIcon, ExternalIcon, PlayFilledIcon, WarnIcon } from "../components/icons";
import { PageShell } from "../components/PageShell";
import { SetupCard } from "../components/SetupCard";
import { SidePanel } from "../components/SidePanel";
import { DAY_TITLE, Facts, ModeIcon, ModeSwitch, TRACK_TITLE_SHORT, TrackChip, TrackIcon } from "../components/study";
import { AlsoTodayHeading, DrillsDueCard, DsaWeekCard, QuietPreview } from "../components/today/AlsoToday";
import { FocusBand } from "../components/today/FocusBand";
import { PlanPreview } from "../components/today/PlanPreview";
import { SetupChecklist, type SetupStep } from "../components/today/SetupChecklist";
import { KIND_LABEL, WeekStrip, WeekSummaryText } from "../components/today/WeekStrip";
import { Alert, Button, Card, Skeleton, cn } from "../components/ui";
import { longDate, shortDay, weekday, wholeMinutes } from "../lib/dates";
import { redoDueText, untriedText } from "../lib/redoDue";
import { focusTrend } from "../lib/focusTrend";
import { MODE_LABEL, formatDate } from "../lib/format";
import { startKey, useStudyData, type StudyData } from "../lib/useStudyData";
import { useDsa } from "../lib/useDsa";
import { useGym } from "../lib/useGym";
import { useNow } from "../lib/useNow";
import { daysUntilNextPlanned, weekDays } from "../lib/weekDays";
import { redoCardTitle } from "../lib/redoLabel";
import { READINESS_LABEL, VERDICT_LABEL, attemptBadge } from "../lib/verdict";
import { Link, drillPath } from "../router";
import type { PageContext } from "./context";

const LEETCODE_URL = "https://leetcode.com/problemset/";
const DEBRIEF_MINUTES = 15;

function minutesFor(track: ProblemSummary["track"], durations: Settings["durations"]): number {
  return durations[track] ?? BASE_MINUTES[track];
}

export function TodayView({
  data,
  ctx,
  now: fixedNow,
  dsa = null,
  dsaLoading = false,
  gym = null,
}: {
  data: StudyData;
  ctx: PageContext;
  now?: Date;
  dsa?: DsaResponse | null;
  dsaLoading?: boolean;
  gym?: GymSummary | null;
}) {
  const liveNow = useNow();
  const now = fixedNow ?? liveNow;
  const { problems, history, error } = data;
  const [confirm, setConfirm] = useState<SessionHistoryItem | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const plan = ctx.settings.weeklyPlan;

  const pick = useMemo(
    () => (problems && history ? selectToday({ now, plan, problems, history }) : null),
    // `now` changes only when the tab shows again or the local day turns, which is when the day's pick can change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [problems, history, plan, now.getTime()],
  );
  const rawWeek = useMemo(() => weekDays(plan, history ?? [], dsa, now), [plan, history, dsa, now]);
  const focus = useMemo(() => (history ? focusSkill(history) : null), [history]);
  const trend = useMemo(() => (history && focus ? focusTrend(history, focus.id) : []), [history, focus]);
  const dayKind = plan[planIndex(now)] ?? "rest";
  const title = DAY_TITLE[dayKind];
  const due = useMemo(() => gym?.queue.filter((d) => d.due) ?? [], [gym]);
  // Nothing played yet, not even a paused round: the page teaches the first steps in place of the usual picks.
  const firstRun = history !== null && !history.some((h) => isAttempt(h) && h.status !== "failed");
  // Days before the first round were never missed, so a new user's week starts clean.
  const week = useMemo(
    () => (firstRun ? { days: rawWeek.days.map((d) => (d.state === "missed" ? { ...d, state: "planned" as const } : d)), known: 0, done: 0 } : rawWeek),
    [firstRun, rawWeek],
  );

  const askDiscard = (item: SessionHistoryItem) => setConfirm(item);
  const hero = pick?.hero;
  const preview = hero?.kind === "problem" ? hero : null;
  const next = daysUntilNextPlanned(plan, now);

  return (
    <PageShell testMode={ctx.testMode}>
      <div className="reveal-children space-y-5 max-sm:pb-20">
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-1">
          <div>
            <p className="text-ui text-muted-foreground">{longDate(now)}</p>
            <h1 className="text-display font-bold tracking-[-0.015em] text-foreground">{title}</h1>
          </div>
          <WeekSummaryText summary={week} />
        </div>
        <WeekStrip days={week.days} />

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
          <div className="today-grid grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
            <div className="space-y-6">
              {firstRun ? (
                <FirstRunHero pick={pick.hero} data={data} ctx={ctx} />
              ) : (
                <Hero hero={pick.hero} data={data} ctx={ctx} now={now} due={due} onSeePlan={() => setPlanOpen(true)} onDiscard={askDiscard} />
              )}
              {preview ? (
                <PlanPreview
                  plan={phasePlan(preview.problem.track, minutesFor(preview.problem.track, ctx.settings.durations))}
                  caption={`${preview.mode === "guided" ? "Guided" : "Interview"}, ${minutesFor(preview.problem.track, ctx.settings.durations)} min, drawn to scale`}
                />
              ) : null}
              {!firstRun && hero?.kind === "rest" && next ? <NextUp days={next.days} kind={next.kind} now={now} /> : null}
              <FocusBand focus={focus} trend={trend} />
            </div>
            <aside aria-label="Also today" className="flex flex-col gap-4">
              {firstRun ? (
                <>
                  <AlsoTodayHeading>Fills in as you go</AlsoTodayHeading>
                  <QuietPreview title="Drills due" text="Short drills appear after your first debrief." />
                  {ctx.settings.leetcodeUsername === undefined ? (
                    <QuietPreview ring title="DSA this week" text={`Add your username to see your ${ctx.settings.dsaWeeklyGoal}-medium goal.`} />
                  ) : (
                    <DsaWeekCard username={ctx.settings.leetcodeUsername} dsa={dsa} loading={dsaLoading} />
                  )}
                  <QuietPreview title="Unfinished rounds" text="A paused round waits here until you finish it." />
                </>
              ) : (
                <>
                  <AlsoTodayHeading>Also today</AlsoTodayHeading>
                  <UnfinishedCard rounds={pick.unfinished} data={data} onDiscard={askDiscard} now={now} />
                  <MoreRedos redos={pick.moreRedos} heroIsRedo={pick.hero.kind === "problem" && pick.hero.reason === "redo"} now={now} />
                  <DrillsDueCard due={due} />
                  <DsaWeekCard username={ctx.settings.leetcodeUsername} dsa={dsa} loading={dsaLoading} />
                </>
              )}
            </aside>
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
  const dsa = useDsa(ctx.settings.leetcodeUsername !== undefined, ctx.settings.leetcodeUsername);
  const { gym } = useGym();
  useEffect(() => {
    document.title = "Today · Sparmate";
  }, []);
  return <TodayView data={data} ctx={ctx} dsa={dsa.response} dsaLoading={dsa.loading} gym={gym} />;
}

function TodaySkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]" role="status">
      <span className="sr-only">Loading today's session…</span>
      <div className="space-y-6">
        <Card className="flex min-h-[300px] flex-col gap-5 p-8">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="mt-auto h-11 w-56" />
        </Card>
        <Skeleton className="h-28 rounded-xl" />
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}

function NextUp({ days, kind, now }: { days: number; kind: DayKind; now: Date }) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return (
    <Card variant="raised" className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 p-5">
      <h2 className="text-body font-semibold">
        Next up: {weekday(date)}, {KIND_LABEL[kind]}
      </h2>
      <p className="text-ui text-muted-foreground">{days === 1 ? "Tomorrow" : `In ${days} days`}</p>
    </Card>
  );
}

const CHIP = "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-ui font-bold";
const AMBER_CHIP = `${CHIP} bg-amber text-amber-foreground`;

/** A label and its value in one pill, so the hero's facts take one row instead of a tile. */
function FactChip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="mesh-tile inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-ui">
      <span className="text-muted-foreground">{label}</span>
      <b className="inline-flex items-center gap-1.5 font-bold">{children}</b>
    </span>
  );
}

const HERO_SHELL = "mesh on-mesh flex flex-col rounded-3xl p-6 sm:min-h-[300px] sm:p-8";
const HERO_TITLE = "mt-5 font-display text-display font-extrabold tracking-[-0.03em] sm:text-[40px] sm:leading-[44px]";
const HERO_WHY = "mt-2 max-w-[56ch] text-body text-muted-foreground";
const HERO_ACTIONS = "mt-auto flex flex-wrap items-center gap-3 pt-7";

function dueText(dueOn: string | null, now: Date): string {
  return `${redoDueText(dueOn, now)}.`;
}

function lastTryText(problem: ProblemSummary): string {
  const last = problem.lastAttempt;
  if (!last) return "";
  if (last.mode === "guided" && last.readiness)
    return last.readiness === "ready" ? "Your last try was ready for interview mode." : "Your last try was not yet ready for interview mode.";
  return last.verdict ? `Your last result was "${VERDICT_LABEL[last.verdict]}".` : "";
}

/** On a phone the main action sticks to the bottom of the screen, so it stays in reach while the page scrolls. */
function StartBar({ children }: { children: ReactNode }) {
  return <div className="today-start">{children}</div>;
}

function Hero({
  hero,
  data,
  ctx,
  now,
  due,
  onSeePlan,
  onDiscard,
}: {
  hero: TodayHero;
  data: StudyData;
  ctx: PageContext;
  now: Date;
  due: readonly GymDrillRow[];
  onSeePlan: () => void;
  onDiscard: (item: SessionHistoryItem) => void;
}) {
  if (hero.kind === "problem") {
    const { problem, mode } = hero;
    const minutes = minutesFor(problem.track, ctx.settings.durations);
    const attempt = data.history?.find((h) => h.id === problem.lastAttempt?.sessionId);
    const planned = new Map(phasePlan(problem.track, minutes).map((p) => [p.id, p.minutes]));
    const overrun = largestOverrun(attempt?.phaseTiming, planned);
    const key = startKey(problem.id, mode);
    return (
      <section aria-labelledby="hero-title" className={HERO_SHELL}>
        <div className="flex flex-wrap items-center gap-2">
          {hero.reason === "redo" ? <span className={AMBER_CHIP}>Redo due</span> : <span className={AMBER_CHIP}>New problem</span>}
          <TrackChip track={problem.track} onMesh />
          <FactChip label="Mode">
            <ModeIcon mode={mode} size={14} />
            {MODE_LABEL[mode]}
          </FactChip>
          <FactChip label="Round">{mode === "guided" ? "No limit" : `${minutes} min`}</FactChip>
          <FactChip label="Debrief">{DEBRIEF_MINUTES} min</FactChip>
        </div>
        <h2 id="hero-title" className={HERO_TITLE}>
          {problem.title}
        </h2>
        <p className={HERO_WHY}>
          {hero.reason === "redo"
            ? [dueText(hero.dueOn, now), lastTryText(problem)].filter(Boolean).join(" ")
            : `Next on your ${TRACK_TITLE_SHORT[problem.track].toLowerCase()} list.`}
        </p>
        {overrun ? (
          <p className="mt-4 flex items-center gap-2.5 text-body">
            <WarnIcon size={18} className="shrink-0 text-warning" />
            <span>
              Watch {overrun.label.toLowerCase()}: <b className="font-semibold text-warning">{Math.round(overrun.actualMinutes)} min</b> last time, against a plan of{" "}
              {overrun.plannedMinutes}.
            </span>
          </p>
        ) : null}
        <div className={HERO_ACTIONS}>
          <StartBar>
            <Button size="lg" variant="default" busy={data.starting === key} disabled={data.starting !== null} onClick={() => data.start(problem.id, mode)}>
              <PlayFilledIcon size={14} />
              {mode === "guided" ? "Start guided round" : "Start interview round"}
            </Button>
          </StartBar>
          <Button size="lg" variant="secondary" onClick={onSeePlan}>
            See the plan
          </Button>
          <Link href="/library" className="mesh-link ml-auto text-ui text-muted-foreground underline decoration-white/30 underline-offset-4 hover:text-foreground">
            Pick another problem
          </Link>
        </div>
      </section>
    );
  }

  if (hero.kind === "resume") {
    const { item } = hero.round;
    return (
      <section aria-labelledby="hero-title" className={HERO_SHELL}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={AMBER_CHIP}>Unfinished</span>
          <TrackChip track={item.track} onMesh />
          <FactChip label="Mode">
            <ModeIcon mode={item.mode} size={14} />
            {MODE_LABEL[item.mode]}
          </FactChip>
          <FactChip label="Clock">
            <ClockText round={hero.round} />
          </FactChip>
          <FactChip label="Debrief">{DEBRIEF_MINUTES} min</FactChip>
        </div>
        <h2 id="hero-title" className={HERO_TITLE}>
          {item.title}
        </h2>
        <p className={HERO_WHY}>
          {item.pause ? `Paused ${shortDay(item.pause.pausedAt ?? item.createdAt)}. Pick up where you stopped.` : `Started ${shortDay(item.createdAt)}. Pick up where you stopped.`}
        </p>
        <div className={HERO_ACTIONS}>
          <StartBar>
            <Button asChild size="lg" variant="default">
              <Link href={`/session/${item.id}`}>
                <PlayFilledIcon size={14} />
                Finish
              </Link>
            </Button>
          </StartBar>
          <EndOrDiscard round={hero.round} data={data} onDiscard={onDiscard} size="lg" variant="secondary" />
        </div>
      </section>
    );
  }

  if (hero.kind === "dsa") {
    const gap = hero.gap;
    return (
      <section aria-labelledby="hero-title" className={HERO_SHELL}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={AMBER_CHIP}>DSA</span>
          <FactChip label="Goal">{ctx.settings.dsaWeeklyGoal} mediums a week</FactChip>
        </div>
        <h2 id="hero-title" className={HERO_TITLE}>
          Solve on LeetCode
        </h2>
        <p className={HERO_WHY}>Pick a problem on LeetCode and solve it under a timer.</p>
        {gap && due.length === 0 ? (
          <p className="mt-4 text-ui text-muted-foreground">
            Gap: {gap.gap.title}, from {gap.item.title}.
          </p>
        ) : null}
        <div className={HERO_ACTIONS}>
          <Button asChild size="lg" variant="default">
            <a href={LEETCODE_URL} target="_blank" rel="noopener noreferrer">
              <ExternalIcon size={16} />
              Open LeetCode
            </a>
          </Button>
          {due.length > 0 ? (
            <Button asChild size="lg" variant="secondary">
              <Link href="/gym">Do a due drill</Link>
            </Button>
          ) : gap ? (
            <Button
              size="lg"
              variant="secondary"
              busy={data.starting === startKey(gap.item.problemId, "guided", gap.gap)}
              disabled={data.starting !== null}
              onClick={() => data.start(gap.item.problemId, "guided", { title: gap.gap.title, goodLooksLike: gap.gap.goodLooksLike, sourceSessionId: gap.item.id })}
            >
              Practise a gap, 20 min
            </Button>
          ) : null}
        </div>
      </section>
    );
  }

  if (hero.kind === "rest") {
    const first = due[0];
    return (
      <section aria-labelledby="hero-title" className={HERO_SHELL}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mesh-tile inline-flex items-center rounded-full px-3 py-1 text-ui font-bold">Rest</span>
        </div>
        <h2 id="hero-title" className={HERO_TITLE}>
          Rest day.
        </h2>
        <p className={HERO_WHY}>
          No round is planned today. {due.length > 0 ? `${due.length} ${due.length === 1 ? "drill is" : "drills are"} due if you want a short one.` : "Nothing is due."}
        </p>
        <div className={HERO_ACTIONS}>
          <Button asChild size="lg" variant="secondary">
            <Link href="/library">Pick a problem anyway</Link>
          </Button>
          {first ? (
            <Link
              href={drillPath({ drill: first.drill, problemId: first.problemId, drillId: first.id })}
              className="mesh-link ml-auto text-ui text-muted-foreground underline decoration-white/30 underline-offset-4 hover:text-foreground"
            >
              Do one drill anyway
            </Link>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="hero-title" className={HERO_SHELL}>
      <h2 id="hero-title" className={HERO_TITLE.replace("mt-5 ", "")}>
        Nothing to practise yet
      </h2>
      <p className={HERO_WHY}>Every problem is done, or none is loaded. Add your own question, or look through the library.</p>
      <div className={HERO_ACTIONS}>
        <Button asChild size="lg" variant="secondary">
          <Link href="/library">Open the library</Link>
        </Button>
        <Button asChild size="lg" variant="ghost">
          <Link href="/practice/new">Practise any question</Link>
        </Button>
      </div>
    </section>
  );
}

/** The hero before the first round: four steps in place of a pick, each with the one thing to do about it. */
function FirstRunHero({ pick, data, ctx }: { pick: TodayHero; data: StudyData; ctx: PageContext }) {
  const plan = ctx.settings.weeklyPlan;
  const customPlan = plan.some((kind, i) => kind !== DEFAULT_WEEKLY_PLAN[i]);
  const hasName = ctx.settings.leetcodeUsername !== undefined;
  const problem = pick.kind === "problem" ? pick.problem : null;
  const mode = pick.kind === "problem" ? pick.mode : "interview";
  const key = problem ? startKey(problem.id, mode) : null;
  const first = problem ? minutesFor(problem.track, ctx.settings.durations) : 0;
  const settings = (label: string, primary: boolean) => (
    <Button asChild size="sm" variant={primary ? "default" : "secondary"}>
      <Link href="/settings">{label}</Link>
    </Button>
  );
  const open = !customPlan ? "plan" : !hasName ? "name" : "round";
  const steps: SetupStep[] = [
    {
      id: "plan",
      title: "Set your weekly plan",
      detail: plan.map((kind, i) => `${WEEKDAYS[i]} ${KIND_LABEL[kind]}`).join(", "),
      done: customPlan,
      action: settings("Review plan", open === "plan"),
    },
    {
      id: "name",
      title: "Add your LeetCode username",
      detail: "So the DSA goal counts your solved mediums",
      done: hasName,
      action: settings("Add username", open === "name"),
    },
    {
      id: "round",
      title: "Play your first round",
      detail: problem ? `${problem.title} is a good first problem, ${first} min` : "Choose a problem from the library",
      done: false,
      action: problem ? (
        <Button
          size="sm"
          variant={open === "round" ? "default" : "secondary"}
          busy={data.starting === key}
          disabled={data.starting !== null}
          onClick={() => data.start(problem.id, mode)}
        >
          Start a round
        </Button>
      ) : (
        <Button asChild size="sm" variant={open === "round" ? "default" : "secondary"}>
          <Link href="/library">Open the library</Link>
        </Button>
      ),
    },
    {
      id: "debrief",
      title: "Read its debrief, and your first drills appear",
      detail: "Drills target the gaps the judge finds",
      done: false,
    },
  ];
  return (
    <section aria-labelledby="hero-title" className="mesh on-mesh rounded-3xl p-6 sm:p-8">
      <SetupChecklist steps={steps} />
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
    <Card variant="raised" className="p-5" aria-labelledby="unfinished-title">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground" aria-hidden="true">
            <TrackIcon track={item.track} size={18} />
          </span>
          <div className="min-w-0">
            <h3 id="unfinished-title" className="text-body font-semibold">
              Unfinished round
            </h3>
            <p className="truncate text-ui text-muted-foreground">
              {item.title}, {item.pause ? `paused ${shortDay(item.pause.pausedAt ?? item.createdAt)}` : `started ${shortDay(item.createdAt)}`}
            </p>
          </div>
        </div>
        {item.pause ? <span className="shrink-0 rounded-full bg-amber px-2.5 py-0.5 text-meta font-bold text-amber-foreground">Paused</span> : null}
      </div>
      <div className="mt-3">
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
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button asChild variant="secondary">
          <Link href={`/session/${item.id}`}>Finish</Link>
        </Button>
        <EndOrDiscard round={first} data={data} onDiscard={onDiscard} variant="ghost" />
      </div>
      {more > 0 ? (
        <div className="mt-3 border-t border-border pt-2.5">
          <Link href="/history" className="text-ui font-semibold text-foreground underline-offset-4 hover:underline">
            {more} more unfinished {more === 1 ? "round" : "rounds"}
          </Link>
        </div>
      ) : null}
    </Card>
  );
}

function MoreRedos({ redos, heroIsRedo, now }: { redos: RedoEntry[]; heroIsRedo: boolean; now: Date }) {
  const next = redos[0];
  if (!next) return null;
  return (
    <Link href="/progress" className="group block">
      <Card variant="raised" className="flex items-center gap-3.5 px-5 py-3.5 transition-colors group-hover:bg-accent/40">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground" aria-hidden="true">
          <CalendarIcon size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-body font-semibold">{redoCardTitle(redos.length, heroIsRedo)}</span>
          <span className="block truncate text-ui text-muted-foreground">
            Next: {next.problem.title}
            {next.dueOn ? ` · ${redoDueText(next.dueOn, now)}` : ""}
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
                    <td className={cn("py-2.5 text-right tabular-nums", actual === undefined || actual === 0 ? "text-faint" : over ? "font-semibold text-warning" : "")}>
                      {/* Every step of a round has a timing row, so a missing row means that round used another step list. */}
                      {actual === undefined ? "—" : actual > 0 ? `${Math.round(actual * 10) / 10} min` : "Not reached"}
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
          <p className="text-ui text-muted-foreground">{untriedText(problem)}</p>
        )}
      </div>
    </SidePanel>
  );
}
