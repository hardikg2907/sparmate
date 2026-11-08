import { useEffect, useMemo, useState } from "react";
import type { Mode } from "../../shared/phases";
import { BAR_SCORE, focusSkill, gapForSkill, skillRows, weekStats, type FocusSkill, type SkillRow } from "../../shared/progress";
import { redoQueue, type RedoEntry } from "../../shared/today";
import { PlayFilledIcon, TargetIcon, WarnIcon } from "../components/icons";
import { PageHeader, PageShell } from "../components/PageShell";
import { SidePanel } from "../components/SidePanel";
import { InfoTip, TrackChip } from "../components/study";
import { Alert, Button, Card, Segmented, Skeleton, cn } from "../components/ui";
import { parseDay, shortDay } from "../lib/dates";
import { MODE_LABEL, SCORE_WORD } from "../lib/format";
import { startKey, useStudyData, type StudyData } from "../lib/useStudyData";
import { Link } from "../router";
import type { PageContext } from "./context";

function dueLabel(entry: RedoEntry): string {
  if (entry.due || !entry.dueOn) return "Today";
  return shortDay(parseDay(entry.dueOn));
}

export function ProgressView({ data, ctx, now = new Date() }: { data: StudyData; ctx: PageContext; now?: Date }) {
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
        <PageHeader title="Progress" aside={<WeekStats stats={stats} />} />
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
  useEffect(() => {
    document.title = "Progress · Sparmate";
  }, []);
  return <ProgressView data={data} ctx={ctx} />;
}

function WeekStats({ stats }: { stats: ReturnType<typeof weekStats> }) {
  const items: { label: string; value: string; note?: string }[] = [
    { label: "Rounds", value: `${stats.rounds.done}`, note: `of ${stats.rounds.planned}` },
    { label: "Redos", value: `${stats.redos.done}`, note: `of ${stats.redos.planned}` },
    { label: "Drills", value: "—", note: "Coming with the Gym" },
    { label: "DSA mediums", value: "—", note: "Coming with DSA" },
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
  if (!focus) {
    return (
      <section aria-labelledby="focus-title" className={shell}>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber px-3 py-1 text-ui font-bold text-amber-foreground">
          <TargetIcon size={14} />
          Focus this week
        </span>
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
  const overPlan = focus.minutesOver !== null && focus.minutesOver > 0 ? focus.minutesOver : null;
  return (
    <section aria-labelledby="focus-title" className={shell}>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber px-3 py-1 text-ui font-bold text-amber-foreground">
        <TargetIcon size={14} />
        Focus this week
      </span>
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
        <div>
          <dd className="text-[40px] font-bold leading-[44px]">
            {focus.minutesOver ?? focus.roundsCounted}{" "}
            <small className="text-lead font-semibold text-muted-foreground">{focus.minutesOver !== null ? "min" : focus.roundsCounted === 1 ? "round" : "rounds"}</small>
          </dd>
          <dt className="mt-1 text-ui text-muted-foreground">
            {overPlan !== null ? "Over the plan in your last scored round" : `Scored ${MODE_LABEL[focus.mode].toLowerCase()} rounds counted`}
          </dt>
        </div>
      </dl>
      {focus.timing ? <StepChart timing={focus.timing} /> : null}
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

/** One bar per step, planned against used. Both rows share one scale, and a dashed line marks where the plan ends. */
function StepChart({ timing }: { timing: NonNullable<FocusSkill["timing"]> }) {
  const planned = timing.reduce((s, r) => s + r.plannedMinutes, 0);
  const used = timing.reduce((s, r) => s + r.actualMinutes, 0);
  const scale = Math.max(planned, used, 1);
  const pct = (minutes: number) => `${(minutes / scale) * 100}%`;
  const summary = timing.map((r) => `${r.label}: planned ${Math.round(r.plannedMinutes)} minutes, used ${Math.round(r.actualMinutes * 10) / 10}`).join(". ");
  const bar = (kind: "planned" | "used") => (
    <div className="flex h-[26px] gap-0.5" aria-hidden="true">
      {timing.map((row) => {
        const minutes = kind === "planned" ? row.plannedMinutes : row.actualMinutes;
        const over = kind === "used" && row.actualMinutes > row.plannedMinutes * 1.5 && row.actualMinutes - row.plannedMinutes >= 3;
        return (
          <i
            key={row.phase}
            title={`${row.label}, ${Math.round(minutes * 10) / 10} min`}
            style={{ width: pct(minutes) }}
            className={cn(
              "flex min-w-0 items-center overflow-hidden whitespace-nowrap rounded-[5px] px-2 text-meta font-bold not-italic",
              over ? "bg-linear-to-r from-[#f2b755] to-[#d99a2b] text-[#3d2900]" : "bg-[rgb(185_173_255/0.35)] text-foreground",
            )}
          >
            {minutes / scale > 0.09 ? Math.round(minutes) : ""}
          </i>
        );
      })}
    </div>
  );
  return (
    <figure className="mt-7 rounded-2xl p-5 mesh-tile" aria-label="Planned and used minutes for each step of your last scored round">
      <figcaption className="sr-only">{summary}</figcaption>
      <div className="relative grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-3.5 gap-y-2.5">
        <span className="text-ui text-muted-foreground">Planned</span>
        {bar("planned")}
        <span className="text-ui text-muted-foreground">Used</span>
        {bar("used")}
        <span aria-hidden="true" />
        <div className="relative h-4 text-meta text-muted-foreground" aria-hidden="true">
          <span className="absolute left-0">0</span>
          <span
            className={cn("absolute whitespace-nowrap", planned / scale > 0.8 ? "right-0" : "-translate-x-1/2")}
            style={planned / scale > 0.8 ? undefined : { left: pct(planned) }}
          >
            Plan ends, {Math.round(planned)} min
          </span>
        </div>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-0 -top-2 border-l-2 border-dashed border-white/50"
          style={{ left: `calc(4.5rem + 0.875rem + (100% - 4.5rem - 0.875rem) * ${planned / scale})`, bottom: "1.5rem" }}
        />
      </div>
    </figure>
  );
}

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
