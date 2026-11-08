import { useEffect, useMemo, useState } from "react";
import type { DsaResponse } from "../../shared/dsa";
import type { Mode } from "../../shared/phases";
import { BAR_SCORE, focusFigure, focusSkill, gapForSkill, skillRows, stepRows, weekStats, type FocusSkill, type SkillRow } from "../../shared/progress";
import { redoQueue, type RedoEntry } from "../../shared/today";
import { PlayFilledIcon, TargetIcon, WarnIcon } from "../components/icons";
import { PageHeader, PageShell } from "../components/PageShell";
import { SidePanel } from "../components/SidePanel";
import { InfoTip, TrackChip } from "../components/study";
import { Alert, Button, Card, Segmented, Skeleton, cn } from "../components/ui";
import { parseDay, shortDay } from "../lib/dates";
import { MODE_LABEL, SCORE_WORD } from "../lib/format";
import { useDsa } from "../lib/useDsa";
import { useNow } from "../lib/useNow";
import { startKey, useStudyData, type StudyData } from "../lib/useStudyData";
import { Link } from "../router";
import type { PageContext } from "./context";

function dueLabel(entry: RedoEntry): string {
  if (entry.due || !entry.dueOn) return "Today";
  return shortDay(parseDay(entry.dueOn));
}

export function ProgressView({ data, ctx, now: fixedNow, dsa = null }: { data: StudyData; ctx: PageContext; now?: Date; dsa?: DsaResponse | null }) {
  const liveNow = useNow();
  const now = fixedNow ?? liveNow;
  const { problems, history, error } = data;
  const [queueOpen, setQueueOpen] = useState(false);
  const [skillMode, setSkillMode] = useState<Mode | null>(null);

  const focus = useMemo(() => (history ? focusSkill(history) : null), [history]);
  const queue = useMemo(() => (problems && history ? redoQueue(problems, history) : []), [problems, history]);
  const stats = useMemo(() => weekStats(history ?? [], ctx.settings.weeklyPlan, now), [history, ctx.settings.weeklyPlan, now]);
  const mode = skillMode ?? focus?.mode ?? "interview";
  const rows = useMemo(() => skillRows(history ?? [], mode), [history, mode]);
  const gap = focus && history ? gapForSkill(history, focus) : null;

  return (
    <PageShell testMode={ctx.testMode}>
      <div className="reveal-children space-y-6">
        <PageHeader title="Progress" aside={<WeekStats stats={stats} dsa={dsa} />} />
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
        {history === null && !error ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_440px]" role="status">
            <span className="sr-only">Loading progress…</span>
            <Skeleton className="h-96 rounded-3xl" />
            <Skeleton className="h-96 rounded-xl" />
          </div>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_440px]">
            <FocusCard focus={focus} gap={gap} data={data} />
            <div className="flex flex-col gap-4">
              <SkillsCard rows={rows.rows} rounds={rows.rounds} mode={mode} onMode={setSkillMode} />
              <RedosCard queue={queue} onSeeAll={() => setQueueOpen(true)} />
            </div>
          </div>
        )}
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
  useEffect(() => {
    document.title = "Progress · Sparmate";
  }, []);
  return <ProgressView data={data} ctx={ctx} dsa={dsa.response} />;
}

function WeekStats({ stats, dsa }: { stats: ReturnType<typeof weekStats>; dsa: DsaResponse | null }) {
  const read = dsa !== null && (dsa.status === "ok" || dsa.status === "stale");
  const items: { label: string; value: string; note?: string }[] = [
    { label: "Rounds", value: `${stats.rounds.done}`, note: `of ${stats.rounds.planned}` },
    { label: "Redos", value: `${stats.redos.done}`, note: `of ${stats.redos.planned}` },
    { label: "Drills", value: "—", note: "Coming with the Gym" },
    { label: "DSA mediums", value: read ? `${dsa.week.mediums}` : "—", note: read ? `of ${dsa.weeklyGoal}` : "Add your LeetCode username in Settings to count mediums" },
  ];
  return (
    <div className="flex flex-wrap items-end gap-x-7 gap-y-3">
      <span className="pb-0.5 text-ui text-muted-foreground">This week</span>
      <dl className="flex gap-7">
        {items.map((item) => (
          <div key={item.label}>
            <dt className="flex items-center gap-1 text-meta text-faint">
              {item.label}
              {item.value === "—" ? <InfoTip label={`About ${item.label}`}>{item.note ?? ""}</InfoTip> : null}
            </dt>
            <dd className="mt-0.5 text-lead font-bold">
              {item.value}
              {item.value !== "—" ? <small className="ml-1 text-ui font-medium text-faint">{item.note}</small> : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function FocusCard({ focus, gap, data }: { focus: FocusSkill | null; gap: ReturnType<typeof gapForSkill>; data: StudyData }) {
  const shell = "mesh on-mesh rounded-3xl p-6 sm:p-10";
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
        <h2 id="focus-title" className="mt-5 font-display text-display font-extrabold tracking-[-0.02em]">
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
      <h2 id="focus-title" className="mt-5 font-display text-display font-extrabold tracking-[-0.02em] sm:text-[56px] sm:leading-[60px]">
        {focus.name}
      </h2>
      <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
        <div>
          <dd className="text-[40px] font-bold leading-[44px]">
            {focus.score} <small className="text-lead font-semibold text-muted-foreground">of 4</small>
          </dd>
          <dt className="mt-1 text-ui text-muted-foreground">Your lowest skill</dt>
        </div>
        {figure ? (
          <div>
            <dd className="text-[40px] font-bold leading-[44px]" aria-label={figure.text}>
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
    <figure className="mesh-tile mt-7 rounded-2xl p-4 sm:p-5" aria-label="Planned and used minutes for each step of the round">
      <div className="mb-3 flex gap-5 text-meta text-muted-foreground" aria-hidden="true">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-5 rounded-full bg-white/30" />
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
            className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_minmax(0,6.5rem)] items-center gap-x-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,8rem)]"
          >
            <span className={cn("truncate text-ui", row.reached ? "text-foreground" : "text-muted-foreground")}>{row.label}</span>
            <span className="block space-y-1" aria-hidden="true">
              <span className="block h-1.5 rounded-full bg-white/30" style={{ width: width(row.planned) }} />
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
          Skills
          <InfoTip label="About the scores">
            <span className="block">
              Scores run from 1 to 4: {SCORE_WORD[1]?.toLowerCase()}, {SCORE_WORD[2]?.toLowerCase()}, {SCORE_WORD[3]?.toLowerCase()}, {SCORE_WORD[4]?.toLowerCase()}. The dashed
              line is the bar for your target level. Each dot is one round, and the newest is bold.
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
        <span>Dashed line: target bar</span>
      </div>
    </Card>
  );
}

function SkillLine({ row }: { row: SkillRow }) {
  const at = (score: number) => `${((score - 1) / 3) * 100}%`;
  const tone = row.latest >= BAR_SCORE ? "bg-success-fill" : row.latest === 2 ? "bg-warning-fill" : "bg-destructive-fill";
  return (
    <li className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_1.5rem] items-center gap-x-4 py-1.5 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_1.5rem]">
      <span className="truncate text-ui text-foreground">{row.name}</span>
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
      <span className="text-right text-body font-bold tabular-nums">{row.latest}</span>
    </li>
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
