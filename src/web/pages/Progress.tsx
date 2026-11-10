import { useEffect, useMemo, useRef, useState } from "react";
import type { DsaResponse } from "../../shared/dsa";
import { DRILL_INFO, OUTCOME_LABEL, type DrillOutcome, type GymSummary } from "../../shared/drills";
import type { Mode } from "../../shared/phases";
import {
  BAR_SCORE,
  drillKindRows,
  focusFigure,
  focusSkill,
  gapForSkill,
  skillRows,
  stepRows,
  weekStats,
  type DrillKindRow,
  type FocusSkill,
  type SkillRow,
} from "../../shared/progress";
import { redoQueue, type RedoEntry } from "../../shared/today";
import { weekStart } from "../../shared/week";
import { DrillIcon } from "../components/DrillIcon";
import { PlayFilledIcon, TargetIcon, WarnIcon } from "../components/icons";
import { PageHeader, PageShell } from "../components/PageShell";
import { SidePanel } from "../components/SidePanel";
import { InfoTip, TrackChip } from "../components/study";
import { Alert, Button, Card, Segmented, SectionTitle, Skeleton, cn } from "../components/ui";
import { parseDay, shortDay } from "../lib/dates";
import { scrollToInScroller } from "../lib/scrollInScroller";
import { MODE_LABEL, SCORE_WORD } from "../lib/format";
import { mediumsTip } from "../lib/dsaText";
import { useDsa, type DsaData } from "../lib/useDsa";
import { useGym } from "../lib/useGym";
import { useNow } from "../lib/useNow";
import { startKey, useStudyData, type StudyData } from "../lib/useStudyData";
import { Link, useHash } from "../router";
import { DsaSection } from "./Dsa";
import { HistorySection } from "./History";
import type { PageContext } from "./context";

function dueLabel(entry: RedoEntry): string {
  if (entry.due || !entry.dueOn) return "Today";
  return shortDay(parseDay(entry.dueOn));
}

const SECTIONS = [
  { id: "week", label: "This week" },
  { id: "skills", label: "Skills" },
  { id: "dsa", label: "DSA" },
  { id: "history", label: "History" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

function jumpTo(id: string): void {
  scrollToInScroller(document.getElementById(id), { behavior: "smooth" });
}

/** The page's own scroller, which is what moves under the bar. The window never scrolls. */
function scrollerOf(element: Element | null): HTMLElement | null {
  return element?.closest<HTMLElement>(".page-canvas") ?? null;
}

function SubNav() {
  const nav = useRef<HTMLElement>(null);
  const [active, setActive] = useState<SectionId>("week");

  // The last section that has reached the bottom of the sub-nav is the one marked. A short last section never gets that
  // far, so the end of the scroll marks it. The offset comes from the sub-nav's real position, which includes the bar.
  useEffect(() => {
    const root = scrollerOf(nav.current);
    if (!root) return;
    const update = () => {
      const line = (nav.current?.getBoundingClientRect().bottom ?? 0) + 24;
      const atEnd = root.scrollTop + root.clientHeight >= root.scrollHeight - 2;
      let found: SectionId = SECTIONS[0].id;
      for (const { id } of SECTIONS) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) found = id;
      }
      setActive(atEnd && root.scrollTop > 0 ? "history" : found);
    };
    update();
    root.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      root.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <nav ref={nav} aria-label="Sections of this page" className="progress-subnav sticky top-[var(--header-h)] z-10 border-b border-border/70 bg-sunken/80 backdrop-blur-xl">
      <ul className="no-scrollbar flex gap-1 overflow-x-auto py-2">
        {SECTIONS.map(({ id, label }) => (
          <li key={id}>
            <a
              href={`#${id}`}
              aria-current={active === id ? "true" : undefined}
              onClick={(event) => {
                event.preventDefault();
                setActive(id);
                history.replaceState(null, "", `${location.pathname}${location.search}#${id}`);
                jumpTo(id);
              }}
              className={cn(
                "flex h-8 items-center whitespace-nowrap rounded-md px-3 text-ui font-medium transition-colors",
                active === id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function ProgressView({
  data,
  ctx,
  now: fixedNow,
  dsa,
  gym = null,
  gymError = null,
}: {
  data: StudyData;
  ctx: PageContext;
  now?: Date;
  dsa: DsaData;
  gym?: GymSummary | null;
  gymError?: string | null;
}) {
  const liveNow = useNow();
  const now = fixedNow ?? liveNow;
  const { problems, history, error } = data;
  const [queueOpen, setQueueOpen] = useState(false);
  const [skillMode, setSkillMode] = useState<Mode | null>(null);
  const hashNav = useHash();
  const scrolledFor = useRef<unknown>(null);

  const focus = useMemo(() => (history ? focusSkill(history) : null), [history]);
  const queue = useMemo(() => (problems && history ? redoQueue(problems, history) : []), [problems, history]);
  const stats = useMemo(() => weekStats(history ?? [], ctx.settings.weeklyPlan, now), [history, ctx.settings.weeklyPlan, now]);
  const mode = skillMode ?? focus?.mode ?? "interview";
  const points = gym?.points;
  const rows = useMemo(() => skillRows(history ?? [], mode, points ?? [], now), [history, mode, points, now]);
  const kinds = useMemo(() => (gym ? drillKindRows(gym.points, gym.today) : null), [gym]);
  const gap = focus && history ? gapForSkill(history, focus) : null;
  const settled = history !== null && !dsa.loading;

  // A link such as /progress#dsa lands on its section. It scrolls again once every section has loaded, because the
  // sections above the target grow when their data arrives.
  useEffect(() => {
    if (hashNav.hash.length <= 1 || scrolledFor.current === hashNav) return;
    scrollToInScroller(document.getElementById(hashNav.hash.slice(1)));
    if (settled) scrolledFor.current = hashNav;
  }, [hashNav, settled]);

  const week = weekStart(now);
  const weekEnd = new Date(week.getFullYear(), week.getMonth(), week.getDate() + 6);

  return (
    <PageShell testMode={ctx.testMode}>
      <div className="reveal-children space-y-6">
        <PageHeader title="Progress" />
        <SubNav />
        {data.startError ? (
          <Alert tone="bad" role="alert" icon={<WarnIcon size={16} />}>
            {data.startError}
          </Alert>
        ) : null}
        {error ? (
          <Alert tone="bad" role="alert" icon={<WarnIcon size={16} />} title="The problem list could not be loaded" actions={<Button onClick={data.reload}>Try again</Button>}>
            {error}
          </Alert>
        ) : null}
        <section id="week" aria-labelledby="week-title" className="scroll-mt-[calc(var(--header-h)+4rem)]">
          <SectionTitle id="week-title" aside={`${shortDay(week)} to ${shortDay(weekEnd)}`}>
            This week
          </SectionTitle>
          {history === null && !error ? (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]" role="status">
              <span className="sr-only">Loading progress…</span>
              <Skeleton className="h-96 rounded-xl" />
              <Skeleton className="h-96 rounded-xl" />
            </div>
          ) : (
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
              <FocusCard focus={focus} gap={gap} data={data} />
              <div className="flex flex-col gap-4">
                <WeekStats stats={stats} dsa={dsa.response} username={ctx.settings.leetcodeUsername} drills={gym?.week ?? null} />
                <RedosCard queue={queue} onSeeAll={() => setQueueOpen(true)} />
              </div>
            </div>
          )}
        </section>
        <section id="skills" aria-labelledby="skills-title" className="scroll-mt-[calc(var(--header-h)+4rem)] pt-8">
          <SectionTitle id="skills-title">Skills</SectionTitle>
          {history === null && !error ? (
            <Skeleton className="h-72 rounded-xl" role="status" />
          ) : (
            <div className="space-y-6">
              <SkillsCard rows={rows.rows} rounds={rows.rounds} mode={mode} onMode={setSkillMode} />
              <DrillKindsCard kinds={kinds} failed={gymError !== null} />
            </div>
          )}
        </section>
        <div className="pt-8">
          <DsaSection ctx={ctx} data={dsa} now={fixedNow} />
        </div>
        <div className="pt-8">
          <HistorySection data={data} />
        </div>
      </div>
      {queueOpen ? (
        <SidePanel title="Next redos" kicker={`${queue.length} in the queue`} onClose={() => setQueueOpen(false)}>
          <ul className="divide-y divide-border">
            {queue.map((entry) => (
              <li key={entry.problem.id} className="flex items-center justify-between gap-3 py-3.5">
                <span className="min-w-0">
                  <span className="block truncate text-body font-semibold">{entry.problem.title}</span>
                  <span className="mt-1 block">
                    <TrackChip track={entry.problem.track} />
                  </span>
                </span>
                <span className={cn("shrink-0 text-ui", entry.due ? "font-semibold text-warning" : "text-muted-foreground")}>{dueLabel(entry)}</span>
              </li>
            ))}
          </ul>
        </SidePanel>
      ) : null}
    </PageShell>
  );
}

export function ProgressPage({ ctx }: { ctx: PageContext }) {
  const data = useStudyData();
  const dsa = useDsa(ctx.settings.leetcodeUsername !== undefined, ctx.settings.leetcodeUsername);
  const { gym, error } = useGym();
  useEffect(() => {
    document.title = "Progress · Sparmate";
  }, []);
  return <ProgressView data={data} ctx={ctx} dsa={dsa} gym={gym} gymError={error} />;
}

function WeekStats({
  stats,
  dsa,
  username,
  drills,
}: {
  stats: ReturnType<typeof weekStats>;
  dsa: DsaResponse | null;
  username: string | undefined;
  drills: { ready: number; attempted: number } | null;
}) {
  const read = dsa !== null && (dsa.status === "ok" || dsa.status === "stale");
  const items: { label: string; value: string; note?: string }[] = [
    { label: "Rounds", value: `${stats.rounds.done}`, note: `of ${stats.rounds.planned}` },
    { label: "Redos", value: `${stats.redos.done}`, note: `of ${stats.redos.planned}` },
    drills
      ? { label: "Drills", value: `${drills.ready}`, note: `interview-ready of ${drills.attempted}` }
      : { label: "Drills", value: "—", note: "The drill count could not be loaded." },
    { label: "DSA mediums", value: read ? `${dsa.week.mediums}` : "—", note: read ? `of ${dsa.weeklyGoal}` : mediumsTip(username, dsa) },
  ];
  return (
    <dl aria-label="This week in numbers" className="grid grid-cols-2 gap-4">
      {items.map((item) => (
        <Card key={item.label} variant="raised" className="px-4 py-3.5">
          <dt className="flex items-center gap-1 text-meta text-muted-foreground">
            {item.label}
            {item.value === "—" && item.note ? <InfoTip label={`About ${item.label}`}>{item.note}</InfoTip> : null}
          </dt>
          <dd className="mt-1 text-title font-bold tabular-nums">
            {item.value}
            {item.value !== "—" ? <small className="ml-1.5 text-ui font-medium text-faint">{item.note}</small> : null}
          </dd>
        </Card>
      ))}
    </dl>
  );
}

function FocusCard({ focus, gap, data }: { focus: FocusSkill | null; gap: ReturnType<typeof gapForSkill>; data: StudyData }) {
  const shell = "surface-raised rounded-xl bg-raised p-6 sm:p-8";
  const chip = (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber px-3 py-1 text-ui font-bold text-amber-foreground">
      <TargetIcon size={14} />
      Focus this week
    </span>
  );
  if (!focus) {
    return (
      <section aria-labelledby="focus-title" className={shell}>
        {chip}
        <h2 id="focus-title" className="mt-5 font-display text-display font-extrabold">
          Your focus appears after a scored round
        </h2>
        <p className="mt-3 max-w-[52ch] text-body text-muted-foreground">Finish a round and read its debrief. The lowest skill across your latest rounds shows up here.</p>
        <div className="mt-8">
          <Button asChild size="lg" variant="default">
            <Link href="/">Start a round</Link>
          </Button>
        </div>
      </section>
    );
  }
  const key = gap ? startKey(gap.item.problemId, "guided", gap.gap) : null;
  const figure = focusFigure(focus.timing);
  return (
    <section aria-labelledby="focus-title" className={shell}>
      {chip}
      <h2 id="focus-title" className="mt-5 font-display text-display font-extrabold sm:text-[44px] sm:leading-[48px]">
        {focus.name}
      </h2>
      <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
        <div>
          <dd className="text-[36px] font-bold leading-[40px]">
            {focus.score} <small className="text-lead font-semibold text-muted-foreground">of 4</small>
          </dd>
          <dt className="mt-1 text-ui text-muted-foreground">Your lowest skill</dt>
        </div>
        {figure ? (
          <div>
            <dd className="text-[36px] font-bold leading-[40px]" aria-label={figure.text}>
              {figure.value} <small className="text-lead font-semibold text-muted-foreground">{figure.unit}</small>
            </dd>
            <dt className="mt-1 text-ui text-muted-foreground">{figure.caption}</dt>
            {figure.note ? <p className="text-ui text-warning">{figure.note}</p> : null}
          </div>
        ) : null}
      </dl>
      {focus.timing && focus.timingRound ? (
        <>
          <StepChart timing={focus.timing} />
          <p className="mt-3 text-meta text-muted-foreground">
            From {focus.timingRound.title}, {shortDay(focus.timingRound.createdAt)}
          </p>
        </>
      ) : null}
      <div className="mt-8 flex flex-wrap items-center gap-4">
        {gap && key ? (
          <>
            <Button
              size="lg"
              variant="default"
              busy={data.starting === key}
              disabled={data.starting !== null}
              onClick={() => data.start(gap.item.problemId, "guided", { title: gap.gap.title, goodLooksLike: gap.gap.goodLooksLike })}
            >
              <PlayFilledIcon size={14} />
              Practise this gap
            </Button>
            <span className="text-ui text-muted-foreground">20-minute round on {gap.item.title}</span>
          </>
        ) : (
          <Button asChild size="lg" variant="default">
            <Link href="/">Start a round</Link>
          </Button>
        )}
      </div>
    </section>
  );
}

/** One row per step: its name, a plan bar above a used bar on one shared scale, and the minutes as text. */
function StepChart({ timing }: { timing: NonNullable<FocusSkill["timing"]> }) {
  const rows = stepRows(timing);
  const scale = Math.max(1, ...rows.map((r) => Math.max(r.planned, r.used)));
  const width = (minutes: number) => `${(minutes / scale) * 100}%`;
  return (
    <figure className="mt-7 rounded-2xl bg-sunken p-4 ring-1 ring-inset ring-border sm:p-5" aria-label="Planned and used minutes for each step of the round">
      <div className="mb-3 flex gap-5 text-meta text-muted-foreground" aria-hidden="true">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-5 rounded-full bg-border-strong" />
          Plan
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-5 rounded-full bg-primary" />
          Used
        </span>
      </div>
      <ul className="space-y-2.5">
        {rows.map((row) => (
          <li
            key={row.phase}
            className="grid grid-cols-[minmax(0,5.5rem)_minmax(0,1fr)_minmax(0,6rem)] items-center gap-x-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,8rem)]"
          >
            <span className={cn("truncate text-ui", row.reached ? "text-foreground" : "text-muted-foreground")}>{row.label}</span>
            <span className="block space-y-1" aria-hidden="true">
              <span className="block h-1.5 rounded-full bg-border-strong" style={{ width: width(row.planned) }} />
              {row.used > 0 ? <span className={cn("block h-1.5 rounded-full", row.over > 0 ? "bg-warning-fill" : "bg-primary")} style={{ width: width(row.used) }} /> : null}
            </span>
            <span className="text-right text-ui tabular-nums">
              {row.reached ? (
                <>
                  <span className={row.over > 0 ? "font-semibold text-warning" : "text-foreground"}>{round1(row.used)}</span>
                  <span className="text-muted-foreground"> of {row.planned} min</span>
                  {row.over > 0 ? <span className="block text-meta font-semibold text-warning">+{row.over} min</span> : null}
                </>
              ) : (
                <span className="text-muted-foreground">
                  Not reached<span className="sr-only">, plan {row.planned} minutes</span>
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function SkillsCard({ rows, rounds, mode, onMode }: { rows: SkillRow[]; rounds: number; mode: Mode; onMode: (mode: Mode) => void }) {
  return (
    <Card variant="raised" className="p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lead font-semibold">
          Level per skill
          <InfoTip label="About the levels">
            <span className="block">Your last 3 rounds, plus drills from the last 30 days at a lower weight.</span>
            <span className="mt-2 block">Drills count in the Interview view, or in the Guided view when you have no interview round.</span>
            <span className="mt-2 block">
              Scores run from 1 to 4: {SCORE_WORD[1]?.toLowerCase()}, {SCORE_WORD[2]?.toLowerCase()}, {SCORE_WORD[3]?.toLowerCase()}, {SCORE_WORD[4]?.toLowerCase()}. The dashed
              line is the bar for your target level. Each dot is one round, and the newest is bold. Each diamond is one drill.
            </span>
          </InfoTip>
        </h2>
        <Segmented
          label="Round type"
          size="sm"
          value={mode}
          onChange={onMode}
          options={[
            { value: "guided", label: "Guided" },
            { value: "interview", label: "Interview" },
          ]}
        />
      </div>
      {rows.length === 0 ? (
        <p className="mt-5 text-ui text-muted-foreground">No scored {MODE_LABEL[mode].toLowerCase()} round yet.</p>
      ) : (
        <ul className="mt-4 space-y-1">
          {rows.map((row) => (
            <SkillLine key={row.id} row={row} />
          ))}
        </ul>
      )}
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3.5 text-meta text-muted-foreground">
        <span>
          {rounds} {MODE_LABEL[mode].toLowerCase()} {rounds === 1 ? "round" : "rounds"} so far
        </span>
        <span>Dots: rounds. Diamonds: drills. Dashed line: target bar</span>
      </div>
    </Card>
  );
}

const toneOf = (score: number) => (score >= BAR_SCORE ? "bg-success-fill" : score >= 2 ? "bg-warning-fill" : "bg-destructive-fill");

function SkillLine({ row }: { row: SkillRow }) {
  const at = (score: number) => `${((score - 1) / 3) * 100}%`;
  const tone = toneOf(row.level);
  const level = row.level.toFixed(1);
  return (
    <li className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_2.25rem] items-center gap-x-4 py-1.5 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_2.25rem]">
      <span className="truncate text-ui text-foreground">{row.name}</span>
      <span className="block">
        <span className="relative block h-5" role="img" aria-label={`${row.name}: ${row.scores.join(", then ")} of 4, newest last`}>
          <span className="absolute inset-x-0 top-1/2 h-px bg-border-strong/60" />
          <span className="absolute -inset-y-0.5 border-l border-dashed border-success-fill/80" style={{ left: at(BAR_SCORE) }} />
          {row.scores.map((score, index) => {
            const newest = index === row.scores.length - 1;
            return (
              <span
                key={index}
                className={cn("absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full", newest ? `size-3 ${tone}` : `size-2 opacity-40 ${tone}`)}
                style={{ left: at(score) }}
              />
            );
          })}
        </span>
        {row.drills.length > 0 ? (
          <span className="relative block h-3.5">
            {row.drills.map((drill, index) => {
              const score = round1(drill.score);
              return (
                <span
                  key={index}
                  role="img"
                  aria-label={`Drill, ${DRILL_INFO[drill.kind].title}, ${score.toFixed(1)}, ${OUTCOME_LABEL[drill.outcome]}`}
                  title={`${DRILL_INFO[drill.kind].title}, ${score.toFixed(1)}`}
                  className={cn("absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45", toneOf(drill.score))}
                  style={{ left: at(drill.score) }}
                />
              );
            })}
          </span>
        ) : null}
      </span>
      <span className="text-right text-body font-bold tabular-nums" aria-label={`${row.name} level ${level} of 4`}>
        {level}
      </span>
    </li>
  );
}

const PIP_TONE: Record<DrillOutcome, string> = { ready: "bg-success-fill", getting_there: "bg-amber", needs_work: "bg-destructive-fill" };

function DrillKindsCard({ kinds, failed }: { kinds: DrillKindRow[] | null; failed: boolean }) {
  return (
    <Card variant="raised" className="p-5 sm:p-6" aria-labelledby="drill-kinds-title">
      <h2 id="drill-kinds-title" className="text-lead font-semibold">
        Drills by kind
      </h2>
      {kinds === null && !failed ? (
        <div role="status" className="mt-4">
          <span className="sr-only">Loading drill results…</span>
          <Skeleton className="h-24" />
        </div>
      ) : kinds === null ? (
        <p className="mt-3 text-ui text-muted-foreground">The drill results could not be loaded.</p>
      ) : kinds.length === 0 ? (
        <p className="mt-3 text-ui text-muted-foreground">No drill has been graded yet. Each kind you try shows its last results here.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border/60">
          {kinds.map((row) => (
            <li key={row.kind}>
              <Link href="/practice/drills" className="-mx-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg px-2.5 py-3 transition-colors hover:bg-accent/50">
                <span className="flex min-w-0 flex-1 basis-44 items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground" aria-hidden="true">
                    <DrillIcon drill={row.kind} size={16} />
                  </span>
                  <span className="truncate text-body font-semibold">{DRILL_INFO[row.kind].title}</span>
                </span>
                <ol aria-label="Last results, oldest first" className="inline-flex gap-1">
                  {row.outcomes.map((outcome, index) => (
                    <li key={index} className={cn("h-2 w-4 rounded-sm", PIP_TONE[outcome])}>
                      <span className="sr-only">{OUTCOME_LABEL[outcome]}</span>
                    </li>
                  ))}
                </ol>
                <span className="text-ui text-muted-foreground">
                  {row.recent} {row.recent === 1 ? "attempt" : "attempts"} in 30 days
                  {row.share !== null ? `, ${Math.round(row.share * 100)}% ready on the first try` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RedosCard({ queue, onSeeAll }: { queue: RedoEntry[]; onSeeAll: () => void }) {
  const next = queue.slice(0, 2);
  return (
    <Card variant="raised" className="p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lead font-semibold">Next redos</h2>
        {queue.length > 2 ? (
          <Button variant="ghost" size="sm" onClick={onSeeAll}>
            See all {queue.length}
          </Button>
        ) : null}
      </div>
      {next.length === 0 ? (
        <p className="mt-3 text-ui text-muted-foreground">No redo is waiting. A partly done round shows up here a week later.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {next.map((entry) => (
            <li key={entry.problem.id} className="flex items-center justify-between gap-3 py-3">
              <span className="truncate text-body font-semibold">{entry.problem.title}</span>
              {entry.due ? (
                <span className="shrink-0 rounded-full bg-primary-soft px-3 py-1 text-meta font-semibold text-primary-soft-foreground ring-1 ring-inset ring-primary/40">
                  Today
                </span>
              ) : (
                <span className="shrink-0 text-ui text-muted-foreground">{dueLabel(entry)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
