import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DRILL_INFO, dueStatus, DRILL_TYPES, PASSES_TO_CLOSE, PASS_INTERVAL_DAYS, type DrillType, type GymDrillRow, type GymSummary } from "../../shared/drills";
import { DrillIcon, DumbbellIcon } from "../components/DrillIcon";
import { ArrowLeftIcon, ChevronRightIcon, ListIcon, PlayFilledIcon, WarnIcon } from "../components/icons";
import { PageHeader, PageShell } from "../components/PageShell";
import { SidePanel } from "../components/SidePanel";
import { InfoTip, TrackChip } from "../components/study";
import { Alert, Button, Card, Skeleton, cn } from "../components/ui";
import { parseDay, shortDay } from "../lib/dates";
import { useGym, type GymData } from "../lib/useGym";
import { Link, drillPath } from "../router";
import type { PageContext } from "./context";

export const HOW_A_GAP_CLOSES = `Three passes in a row close the gap. After a pass the next drill comes ${PASS_INTERVAL_DAYS[0]} days later, then ${PASS_INTERVAL_DAYS[1]}. A Not yet starts again tomorrow.`;
/** How many drills the "Also due" card lists before it says how many more wait. */
const ALSO_DUE_SHOWN = 3;

/** Due as a status. A drill that fell due earlier reads "Overdue", never a past date. */
export function dueText(row: Pick<GymDrillRow, "dueOn">, today: string): string {
  const status = dueStatus(row.dueOn, today);
  return status.tone === "later" && status.label === row.dueOn ? shortDay(parseDay(row.dueOn)) : status.label;
}

/** The day an overdue drill fell due, for small text beside "Overdue". Null when it is not overdue. */
export function overdueSince(row: Pick<GymDrillRow, "dueOn">, today: string): string | null {
  const status = dueStatus(row.dueOn, today);
  return status.since ? `since ${shortDay(parseDay(status.since))}` : null;
}

/** The drill's address, with its queue id when it came from the queue. */
function rowPath(row: GymDrillRow): string {
  return drillPath({ drill: row.drill, problemId: row.problemId, drillId: row.id });
}

export function Pips({ filled, onMesh }: { filled: number; onMesh?: boolean }) {
  return (
    <span className="inline-flex gap-1" role="img" aria-label={`${filled} of ${PASSES_TO_CLOSE} passes`}>
      {Array.from({ length: PASSES_TO_CLOSE }, (_, i) => (
        <b key={i} className={cn("h-1.5 w-[18px] rounded-sm", i < filled ? "bg-success-fill" : onMesh ? "bg-white/25" : "bg-border-strong/60")} />
      ))}
    </span>
  );
}

export function GymView({ data, ctx }: { data: GymData; ctx: PageContext }) {
  const { gym, error } = data;
  const [allOpen, setAllOpen] = useState(false);

  return (
    <PageShell testMode={ctx.testMode}>
      <div className="reveal-children space-y-6">
        <PageHeader title="Gym" aside={<span className="text-ui text-muted-foreground">10 to 15 minutes on one skill</span>} />
        {error ? (
          <Alert tone="bad" role="alert" icon={<WarnIcon size={16} />} title="The drills could not be loaded" actions={<Button onClick={data.reload}>Try again</Button>}>
            {error}
          </Alert>
        ) : null}
        {!gym && !error ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]" role="status">
            <span className="sr-only">Loading drills…</span>
            <Skeleton className="h-96 rounded-3xl" />
            <Skeleton className="h-72 rounded-xl" />
          </div>
        ) : null}
        {gym ? <GymBody gym={gym} onAll={() => setAllOpen(true)} /> : null}
      </div>
      {allOpen && gym ? <AllDrillsPanel gym={gym} onClose={() => setAllOpen(false)} /> : null}
    </PageShell>
  );
}

export function GymPage({ ctx }: { ctx: PageContext }) {
  const data = useGym();
  useEffect(() => {
    document.title = "Gym · Sparmate";
  }, []);
  return <GymView data={data} ctx={ctx} />;
}

function GymBody({ gym, onAll }: { gym: GymSummary; onAll: () => void }) {
  const due = gym.queue.filter((r) => r.due);
  const hero = due[0];
  const rest = due.slice(1);
  if (gym.problems.length === 0 && gym.queue.length === 0) return <NothingYet />;
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      {hero ? <Hero row={hero} today={gym.today} /> : <NothingDue gym={gym} onAll={onAll} />}
      <AlsoDue rows={rest} today={gym.today} onAll={onAll} hasHero={hero !== undefined} />
    </div>
  );
}

const SHELL = "mesh on-mesh rounded-3xl p-6 sm:p-11";
const PILL = "inline-flex items-center gap-1.5 rounded-full bg-amber px-3 py-1 text-ui font-bold text-amber-foreground";
const TITLE = "mt-5 font-display text-display font-extrabold tracking-[-0.02em] sm:text-[64px] sm:leading-[68px]";

function Hero({ row, today }: { row: GymDrillRow; today: string }) {
  return (
    <section aria-labelledby="drill-title" className={SHELL}>
      <span className={PILL}>
        <DumbbellIcon size={16} />
        Next drill
      </span>
      <h2 id="drill-title" className={TITLE}>
        {row.title}
      </h2>
      <p className="mt-3 text-body text-muted-foreground sm:text-lead">
        On <b className="font-semibold text-foreground">{row.problemTitle}</b>
      </p>
      <p className="mt-1 max-w-[62ch] truncate text-ui text-hero-muted">Gap: {row.gapTitle}</p>
      <dl className="mesh-tile mt-7 grid w-full auto-cols-fr grid-flow-col divide-x divide-border rounded-xl sm:inline-grid sm:w-auto sm:auto-cols-auto">
        <Fact label="Length" value={`${row.minutes} min`} />
        <Fact
          label="Due"
          value={
            <>
              <span>{dueText(row, today)}</span>
              {overdueSince(row, today) ? <small className="text-meta font-medium text-hero-muted">{overdueSince(row, today)}</small> : null}
            </>
          }
        />
        <Fact
          label={
            <span className="inline-flex items-center gap-1">
              Passes in a row
              <InfoTip label="How a gap closes">{HOW_A_GAP_CLOSES}</InfoTip>
            </span>
          }
          value={
            <>
              <span>
                {row.passes} of {PASSES_TO_CLOSE}
              </span>
              <Pips filled={row.passes} onMesh />
            </>
          }
        />
      </dl>
      {row.task ? (
        <p className="mt-5 flex max-w-[62ch] gap-2.5 text-body sm:text-lead">
          <ListIcon size={18} className="mt-1 text-hero-muted" />
          <span>{row.task}</span>
        </p>
      ) : null}
      <div className="mt-8">
        <Button asChild size="lg" variant="default">
          <Link href={rowPath(row)}>
            <PlayFilledIcon size={14} />
            Start drill
          </Link>
        </Button>
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="min-w-0 px-3 py-3 sm:px-5 sm:py-3.5">
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 whitespace-nowrap text-body font-semibold text-foreground sm:text-lead">{value}</dd>
    </div>
  );
}

function NothingDue({ gym, onAll }: { gym: GymSummary; onAll: () => void }) {
  const next = gym.queue[0];
  return (
    <section aria-labelledby="drill-title" className={SHELL}>
      <span className={PILL}>
        <DumbbellIcon size={16} />
        Gym
      </span>
      <h2 id="drill-title" className={TITLE}>
        Nothing due
      </h2>
      <p className="mt-3 max-w-[56ch] text-body text-muted-foreground sm:text-lead">
        {next
          ? `Your next drill is ${next.title.toLowerCase()} on ${next.problemTitle}, due ${dueText(next, gym.today)}.`
          : "A drill appears the day after a debrief names a gap. You can also train any skill now."}
      </p>
      <div className="mt-8">
        <Button size="lg" variant="default" onClick={onAll}>
          All drills
        </Button>
      </div>
    </section>
  );
}

function NothingYet() {
  return (
    <Card variant="raised" className="max-w-3xl p-8 sm:p-10">
      <h2 className="font-display text-title font-extrabold tracking-[-0.01em]">Drills start after your first round</h2>
      <p className="mt-2 max-w-[52ch] text-body text-muted-foreground">
        A drill trains one gap from a round you played, so it never gives away a problem you have not met. Finish a round and read its debrief, and your first drill appears the
        next day.
      </p>
      <div className="mt-6">
        <Button asChild size="lg" variant="default">
          <Link href="/library">Open the library</Link>
        </Button>
      </div>
    </Card>
  );
}

function AlsoDue({ rows, today, onAll, hasHero }: { rows: GymDrillRow[]; today: string; onAll: () => void; hasHero: boolean }) {
  const shown = rows.slice(0, ALSO_DUE_SHOWN);
  const more = rows.length - shown.length;
  return (
    <Card variant="raised" className="p-5 sm:p-6" aria-labelledby="also-due">
      <div className="flex items-center justify-between gap-3">
        <h2 id="also-due" className="text-lead font-bold">
          Also due
        </h2>
        {rows.length > 0 ? <span className="rounded-full bg-warning-soft px-2.5 py-0.5 text-meta font-semibold text-warning">{rows.length}</span> : null}
      </div>
      {shown.length > 0 ? (
        <ul className="mt-2 divide-y divide-border/60">
          {shown.map((row) => (
            <li key={row.id}>
              <Link href={rowPath(row)} className="-mx-2.5 flex items-center gap-3.5 rounded-lg px-2.5 py-3 transition-colors hover:bg-accent/50">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-primary-soft text-primary-soft-foreground" aria-hidden="true">
                  <DrillIcon drill={row.drill} size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-semibold">{row.title}</span>
                  <span className="block truncate text-meta text-muted-foreground">{row.gapTitle}</span>
                  <span className="block truncate text-meta text-faint">{row.problemTitle}</span>
                  {row.topic ? <span className="block truncate text-meta text-faint">Topic: {row.topic}</span> : null}
                </span>
                <span className="shrink-0 text-right text-ui text-warning">
                  {dueText(row, today)}
                  {overdueSince(row, today) ? <small className="block text-meta text-faint">{overdueSince(row, today)}</small> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-ui text-muted-foreground">{hasHero ? "That is the only drill due." : "No drill is due."}</p>
      )}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/60 pt-4">
        <span className="text-meta text-muted-foreground">{more > 0 ? `${more} more due` : ""}</span>
        <button type="button" onClick={onAll} className="text-ui font-semibold text-primary-text underline-offset-4 hover:underline">
          All drills
        </button>
      </div>
    </Card>
  );
}

/** Every drill kind, to start freely. A free drill uses a problem the candidate has played, and it counts for a queued drill only when it matches one. */
function AllDrillsPanel({ gym, onClose }: { gym: GymSummary; onClose: () => void }) {
  const [picked, setPicked] = useState<DrillType | null>(null);
  const problems = useMemo(() => (picked ? gym.problems.filter((p) => p.drills.includes(picked)) : []), [gym.problems, picked]);
  const info = picked ? DRILL_INFO[picked] : null;
  return (
    <SidePanel
      kicker={picked ? "Choose a problem" : "Train any skill now"}
      title={info?.title ?? "All drills"}
      onClose={onClose}
      footer={
        picked ? (
          <Button variant="ghost" onClick={() => setPicked(null)}>
            <ArrowLeftIcon size={14} />
            All drills
          </Button>
        ) : null
      }
    >
      {!picked ? (
        <ul className="divide-y divide-border">
          {DRILL_TYPES.map((drill) => {
            const available = gym.problems.filter((p) => p.drills.includes(drill)).length;
            return (
              <li key={drill}>
                <button
                  type="button"
                  disabled={available === 0}
                  onClick={() => setPicked(drill)}
                  className="-mx-3 flex w-[calc(100%+1.5rem)] items-center gap-4 rounded-lg px-3 py-4 text-left transition-colors enabled:hover:bg-accent/50 disabled:opacity-50"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground" aria-hidden="true">
                    <DrillIcon drill={drill} size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-semibold">{DRILL_INFO[drill].title}</span>
                    <span className="block text-ui text-muted-foreground">{DRILL_INFO[drill].about}</span>
                    <span className="mt-0.5 block text-meta text-faint">{available === 0 ? "Play a round of this track first" : `${DRILL_INFO[drill].minutes} min`}</span>
                  </span>
                  <ChevronRightIcon size={16} className="shrink-0 text-faint" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="divide-y divide-border">
          {problems.map((problem) => (
            <li key={problem.id}>
              <Link
                href={drillPath({ drill: picked, problemId: problem.id })}
                className="-mx-3 flex items-center justify-between gap-3 rounded-lg px-3 py-3.5 transition-colors hover:bg-accent/50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-body font-semibold">{problem.title}</span>
                  <span className="mt-1 block">
                    <TrackChip track={problem.track} />
                  </span>
                </span>
                <ChevronRightIcon size={16} className="shrink-0 text-faint" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SidePanel>
  );
}
