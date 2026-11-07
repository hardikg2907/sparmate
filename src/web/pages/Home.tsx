import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { BASE_MINUTES, phasePlan, type Mode, type Track } from "../../shared/phases";
import type { ProblemSummary, Settings } from "../../shared/types";
import type { CustomProblemJobStatus } from "../../shared/protocol";
import { ApiError, api, type SessionHistoryItem } from "../backend";
import { AppHeader } from "../components/AppHeader";
import { ConfirmModal } from "../components/ConfirmModal";
import { DiscardNote } from "../components/DiscardNote";
import { BarChartIcon, CheckIcon, ChevronDownIcon, PauseIcon, PlayIcon, SlidersIcon, WarnIcon } from "../components/icons";
import { Modal } from "../components/Modal";
import { PlanPreview } from "../components/PlanTrack";
import { Select } from "../components/Select";
import {
  Alert,
  Badge,
  Button,
  Card,
  DialogClose,
  EmptyState,
  Kbd,
  SectionTitle,
  Segmented,
  Skeleton,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  cn,
} from "../components/ui";
import {
  filterAndSortProblems,
  SORT_OPTION_LABELS,
  STATUS_FILTER_LABELS,
  type SortOption,
  type StatusFilter,
} from "../lib/filterProblems";

const STATUS_OPTIONS = (Object.keys(STATUS_FILTER_LABELS) as StatusFilter[]).map((key) => ({
  value: key,
  label: STATUS_FILTER_LABELS[key],
}));

const SORT_OPTIONS = (Object.keys(SORT_OPTION_LABELS) as SortOption[]).map((key) => ({
  value: key,
  label: SORT_OPTION_LABELS[key],
}));
import {
  MARK_LABEL,
  MODE_LABEL,
  TRACK_LABEL,
  TRACK_TITLE,
  VERDICT_TONE,
  daysSince,
  formatDate,
  formatDateTime,
  type Tone,
} from "../lib/format";
import { useCountUp } from "../hooks/useCountUp";
import { pauseText } from "../lib/pause";
import { VERDICT_LABEL } from "../lib/verdict";
import { Link, navigate } from "../router";

const CUSTOM_MIN = 10;
const CUSTOM_MAX = 4000;
const HISTORY_SHOWN = 8;
const STORAGE_TRACK = "ir-home-track";
const STORAGE_STATUS = "ir-home-status-filter";
const STORAGE_SORT = "ir-home-sort";
const GUIDED_HINT = "Step by step, with feedback and hints, no timer pressure";

type Durations = Settings["durations"];

export interface HomeViewProps {
  problems: ProblemSummary[] | null;
  history: SessionHistoryItem[] | null;
  error: string | null;
  onRetry: () => void;
  /** Which start button is busy: "<problemId>:<mode>" or "custom:<mode>". */
  starting: string | null;
  startError: string | null;
  onStart: (problemId: string, mode: Mode) => void;
  onStartCustom: (prompt: string, track: Track, mode: Mode) => void;
  /** Id of the round being deleted right now. */
  discarding: string | null;
  discardError: string | null;
  onDiscard: (sessionId: string) => void;
  fakeAgent: boolean;
  onOpenSettings: () => void;
  /** Round lengths from the settings, so the start dialog can show the real plan. */
  durations: Durations | null;
}

function minutesFor(track: Track, durations: Durations | null): number {
  return durations?.[track] ?? BASE_MINUTES[track];
}

function stagger(index: number): CSSProperties {
  return { "--i": index } as CSSProperties;
}

function fillStep(index: number, at?: number): CSSProperties {
  return { "--j": index, ...(at === undefined ? {} : { "--fill-at": `${at}ms` }) } as CSSProperties;
}

export function HomeView(props: HomeViewProps) {
  const {
    problems,
    history,
    error,
    onRetry,
    starting,
    startError,
    onStart,
    onStartCustom,
    discarding,
    discardError,
    onDiscard,
    fakeAgent,
    onOpenSettings,
    durations,
  } = props;
  const busy = starting !== null;
  const recommended = (problems ?? []).filter((p) => p.badge === "next");
  const redos = (problems ?? []).filter((p) => p.badge === "redo");
  const [hero, ...others] = [...recommended, ...redos];
  const open = (history ?? []).filter((item) => item.status === "live" || item.status === "paused");

  const [selectedTrack, setSelectedTrack] = useState<Track>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_TRACK);
      return saved === "lld" || saved === "hld" ? saved : "hld";
    } catch {
      return "hld";
    }
  });

  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_STATUS) as StatusFilter;
      return saved && saved in STATUS_FILTER_LABELS ? saved : "all";
    } catch {
      return "all";
    }
  });

  const [sortOption, setSortOption] = useState<SortOption>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_SORT) as SortOption;
      return saved && saved in SORT_OPTION_LABELS ? saved : "tracker";
    } catch {
      return "tracker";
    }
  });

  const [chosen, setChosen] = useState<{ problem: ProblemSummary; mode: Mode } | null>(null);
  const [confirm, setConfirm] = useState<SessionHistoryItem | null>(null);
  const afterDiscard = useRef<"open" | "history" | null>(null);

  const handleTrackChange = (track: Track) => {
    setSelectedTrack(track);
    try {
      localStorage.setItem(STORAGE_TRACK, track);
    } catch {
      // Storage unavailable.
    }
  };

  const handleStatusChange = (filter: StatusFilter) => {
    setStatusFilter(filter);
    try {
      localStorage.setItem(STORAGE_STATUS, filter);
    } catch {
      // Storage unavailable.
    }
  };

  const handleSortChange = (sort: SortOption) => {
    setSortOption(sort);
    try {
      localStorage.setItem(STORAGE_SORT, sort);
    } catch {
      // Storage unavailable.
    }
  };

  // Restore focus without scrolling the page down so keyboard users stay oriented.
  useEffect(() => {
    if (afterDiscard.current && document.activeElement === document.body) {
      const targetId = afterDiscard.current === "open" ? "open-heading" : "history-heading";
      const target = document.getElementById(targetId) ?? document.getElementById("history-heading");
      target?.focus({ preventScroll: true });
    }
    afterDiscard.current = null;
  }, [history]);

  const choose = (problem: ProblemSummary, mode: Mode) => setChosen({ problem, mode });

  const hldTotal = (problems ?? []).filter((p) => p.track === "hld").length;
  const lldTotal = (problems ?? []).filter((p) => p.track === "lld").length;

  const trackOptions = useMemo(
    () => [
      { value: "hld" as Track, label: `System design (${hldTotal})`, title: TRACK_TITLE.hld },
      { value: "lld" as Track, label: `Machine coding (${lldTotal})`, title: TRACK_TITLE.lld },
    ],
    [hldTotal, lldTotal],
  );

  return (
    <div className="page-canvas flex h-full min-h-0 flex-col overflow-y-auto">
      <AppHeader
        actions={
          <>
            {fakeAgent ? (
              <Tooltip content="The server answers with scripted replies and makes no model calls.">
                <Badge tone="warn" tabIndex={0}>
                  Test mode
                </Badge>
              </Tooltip>
            ) : null}
            <Button asChild variant="ghost">
              <Link href="/usage">
                <BarChartIcon size={16} />
                <span className="max-sm:sr-only">Usage</span>
              </Link>
            </Button>
            <Button variant="ghost" onClick={onOpenSettings}>
              <SlidersIcon size={16} />
              <span className="max-sm:sr-only">Settings</span>
            </Button>
          </>
        }
      >
        {problems ? <HeaderSummary problems={problems} /> : null}
      </AppHeader>

      <main tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 space-y-12 px-4 pb-16 pt-8 sm:px-8">
        {startError && !chosen ? <ErrorLine text={startError} /> : null}
        {discardError ? <ErrorLine text={discardError} /> : null}

        {error ? (
          <Alert
            tone="bad"
            role="alert"
            icon={<WarnIcon size={16} />}
            title="The problem list could not be loaded"
            actions={<Button onClick={onRetry}>Try again</Button>}
          >
            {error}
          </Alert>
        ) : null}

        {problems === null && !error ? <LoadingSkeleton /> : null}

        {open.length > 0 ? (
          <section aria-labelledby="open-heading" className="reveal space-y-2" style={stagger(0)}>
            <h2 id="open-heading" tabIndex={-1} className="sr-only">
              Unfinished rounds
            </h2>
            {open.slice(0, 1).map((item) => (
              <OpenRound key={item.id} item={item} discarding={discarding} onDiscard={() => setConfirm(item)} />
            ))}
            {open.length > 1 ? (
              <Card className="overflow-hidden">
                <details className="group">
                  <summary className="flex cursor-pointer select-none items-center gap-2 px-5 py-2.5 text-ui text-muted-foreground hover:text-foreground">
                    <ChevronDownIcon size={14} className="transition-transform duration-150 group-open:rotate-180" />
                    {open.length - 1} more unfinished {open.length - 1 === 1 ? "round" : "rounds"}
                  </summary>
                  <ul className="divide-y divide-border border-t border-border">
                    {open.slice(1).map((item, index) => (
                      <CompactOpenRound key={item.id} item={item} index={index} discarding={discarding} onDiscard={() => setConfirm(item)} />
                    ))}
                  </ul>
                </details>
              </Card>
            ) : null}
          </section>
        ) : null}

        {problems ? <ProgressSection problems={problems} history={history} /> : null}

        {hero ? (
          <section aria-labelledby="up-next-heading" className="reveal" style={stagger(2)}>
            <SectionTitle id="up-next-heading">Up next</SectionTitle>
            <div className="space-y-3">
              <HeroCard problem={hero} minutes={minutesFor(hero.track, durations)} busy={busy} onChoose={choose} />
              {others.length > 0 ? (
                <Card variant="raised" className="divide-y divide-border overflow-hidden">
                  {others.map((problem, index) => (
                    <RedoRow key={problem.id} problem={problem} index={index + 1} busy={busy} onChoose={choose} />
                  ))}
                </Card>
              ) : null}
            </div>
          </section>
        ) : null}

        {problems ? (
          <FullWidthProblemList
            track={selectedTrack}
            trackOptions={trackOptions}
            problems={problems.filter((p) => p.track === selectedTrack)}
            filter={statusFilter}
            sort={sortOption}
            busy={busy}
            onTrackChange={handleTrackChange}
            onFilterChange={handleStatusChange}
            onSortChange={handleSortChange}
            onChoose={choose}
          />
        ) : null}

        <CustomPrompt starting={starting} busy={busy} onStart={onStart} onReloadProblems={onRetry} />

        <HistorySection history={history} discarding={discarding} onAskDiscard={setConfirm} />
      </main>

      {chosen ? (
        <StartDialog
          problem={chosen.problem}
          mode={chosen.mode}
          durations={durations}
          starting={starting}
          error={startError}
          onMode={(mode) => setChosen({ ...chosen, mode })}
          onCancel={() => setChosen(null)}
          onStart={() => onStart(chosen.problem.id, chosen.mode)}
        />
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
            const isOpen = item.status === "live" || item.status === "paused";
            afterDiscard.current = isOpen ? "open" : "history";
            onDiscard(item.id);
          }}
        >
          <p className="mb-2 font-semibold">
            {confirm.title}, {formatDateTime(confirm.createdAt)}
          </p>
          <DiscardNote track={confirm.track} />
        </ConfirmModal>
      ) : null}
    </div>
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <Alert tone="bad" role="alert" icon={<WarnIcon size={16} />}>
      {text}
    </Alert>
  );
}

/** Shaped like the real sections so the page does not jump when the list arrives. */
function LoadingSkeleton() {
  return (
    <div className="space-y-12">
      <span role="status" className="sr-only">
        Loading problems…
      </span>
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1].map((index) => (
          <Card key={index} className="flex flex-col gap-4 p-5">
            <Skeleton className="h-5 w-2/5" />
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-2.5 w-full rounded-full" />
            <Skeleton className="h-4 w-4/5" />
          </Card>
        ))}
      </div>
      <Card className="flex flex-col gap-5 p-6">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-7 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-9 w-56" />
      </Card>
      <ul className="border-t border-border">
        {[0, 1, 2, 3, 4].map((index) => (
          <li key={index} className="flex items-center gap-3 border-b border-border py-3">
            <Skeleton className="size-6 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-8 w-40" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function countMarks(problems: ProblemSummary[]) {
  const done = problems.filter((p) => p.trackerMark === "[x]").length;
  const partly = problems.filter((p) => p.trackerMark === "[~]").length;
  const total = problems.length;
  return {
    total,
    done,
    partly,
    notStarted: Math.max(0, total - done - partly),
    redoDue: problems.filter((p) => p.badge === "redo").length,
  };
}

/** Quiet text summary for the page header. */
function HeaderSummary({ problems }: { problems: ProblemSummary[] }) {
  const hld = countMarks(problems.filter((p) => p.track === "hld"));
  const lld = countMarks(problems.filter((p) => p.track === "lld"));
  if (hld.total === 0 && lld.total === 0) return null;
  return (
    <span className="hidden text-ui text-muted-foreground md:inline">
      HLD {hld.done} of {hld.total} done, LLD {lld.done} of {lld.total} done
    </span>
  );
}

/** Practice progress for both tracks in one panel: a big count, and one pip per problem so the gaps show at a glance. */
function ProgressSection({ problems, history }: { problems: ProblemSummary[]; history: SessionHistoryItem[] | null }) {
  const tracks: Track[] = ["hld", "lld"];
  return (
    <section aria-labelledby="progress-heading" className="reveal" style={stagger(1)}>
      <SectionTitle id="progress-heading">Progress</SectionTitle>
      <Card variant="raised" className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        {tracks.map((track) => (
          <TrackProgress key={track} track={track} problems={problems.filter((p) => p.track === track)} history={history} />
        ))}
      </Card>
    </section>
  );
}

function TrackProgress({ track, problems, history }: { track: Track; problems: ProblemSummary[]; history: SessionHistoryItem[] | null }) {
  const counts = countMarks(problems);
  const done = useCountUp(counts.done, { delay: 250 });
  const trackHistory = (history ?? []).filter((h) => h.track === track);
  const latestDate = trackHistory[0]?.createdAt ?? problems.find((p) => p.lastAttempt)?.lastAttempt?.date ?? null;

  return (
    <div className="flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-lead font-bold text-foreground">
          {track === "hld" ? "System design" : "Machine coding in C++"}
          <Badge title={TRACK_TITLE[track]}>{TRACK_LABEL[track]}</Badge>
        </h3>
        {counts.redoDue > 0 ? (
          <Badge tone="warn" className="gap-1.5">
            <WarnIcon size={12} />
            {counts.redoDue} {counts.redoDue === 1 ? "redo due" : "redos due"}
          </Badge>
        ) : null}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-gradient text-mega font-bold tabular-nums">{done}</span>
        <span className="text-lead font-semibold tabular-nums text-muted-foreground">of {counts.total}</span>
        <span className="text-ui text-muted-foreground">completed at the bar</span>
      </div>

      <div
        className="flex gap-1"
        role="progressbar"
        aria-label={`${TRACK_TITLE[track]} progress: ${counts.done} done, ${counts.partly} partly done, ${counts.notStarted} not started of ${counts.total}`}
        aria-valuenow={counts.done}
        aria-valuemin={0}
        aria-valuemax={counts.total}
      >
        {[...problems]
          .sort((a, b) => markRank(a) - markRank(b))
          .map((problem, index) => (
            <span
              key={problem.id}
              title={`${problem.title}: ${problem.trackerMark ? MARK_LABEL[problem.trackerMark].toLowerCase() : "not started"}`}
              style={fillStep(index)}
              className={cn(
                "fill-x h-3 min-w-2 flex-1 rounded-sm transition-colors duration-200",
                problem.trackerMark === "[x]"
                  ? "bg-success-fill bg-linear-to-b from-white/20 to-transparent shadow-[0_0_10px_-2px_var(--success-fill)]"
                  : problem.trackerMark === "[~]"
                    ? "bg-warning-fill bg-linear-to-b from-white/20 to-transparent"
                    : "bg-muted ring-1 ring-inset ring-input/50",
              )}
            />
          ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-success-fill" aria-hidden="true" />
          {counts.done} done
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-warning-fill" aria-hidden="true" />
          {counts.partly} partly done
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-muted ring-1 ring-inset ring-input/50" aria-hidden="true" />
          {counts.notStarted} not started
        </span>
        <span className="ml-auto">{latestDate ? `Last round ${formatDate(latestDate)}` : "No rounds yet"}</span>
      </div>
    </div>
  );
}

function markRank(problem: ProblemSummary): number {
  return problem.trackerMark === "[x]" ? 0 : problem.trackerMark === "[~]" ? 1 : 2;
}

function OpenRound({ item, discarding, onDiscard }: { item: SessionHistoryItem; discarding: string | null; onDiscard: () => void }) {
  const paused = item.status === "paused";
  const label = `${item.title}, ${formatDateTime(item.createdAt)}`;
  return (
    <div className="lift tint flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-warning-fill/40 bg-warning-soft px-5 py-4 text-warning">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning-fill bg-linear-to-b from-white/25 to-transparent text-warning-soft shadow-[0_4px_14px_-4px_var(--warning-fill)]" aria-hidden="true">
        {paused ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
      </span>
      <div className="min-w-[min(100%,16rem)] flex-1">
        <p className="text-body font-bold text-foreground">
          {item.title} is {paused ? "paused" : "still open"}.
        </p>
        <p className="text-ui text-muted-foreground">
          {MODE_LABEL[item.mode]} round on {TRACK_LABEL[item.track]}, started {formatDateTime(item.createdAt)}.
          {paused ? ` ${pausedText(item)}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" aria-label={`Discard: ${label}`} disabled={discarding !== null} busy={discarding === item.id} onClick={onDiscard}>
          Discard
        </Button>
        <Button asChild variant="default">
          <Link href={`/session/${item.id}`} aria-label={`Resume: ${label}`}>
            <PlayIcon size={14} />
            Resume
          </Link>
        </Button>
      </div>
    </div>
  );
}

/** Older unfinished rounds stay one click away without pushing the plan below the fold. */
function CompactOpenRound({ item, index, discarding, onDiscard }: { item: SessionHistoryItem; index: number; discarding: string | null; onDiscard: () => void }) {
  const label = `${item.title}, ${formatDateTime(item.createdAt)}`;
  const left = item.pause?.timeLeftMs;
  return (
    <li className="reveal flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5" style={stagger(index)}>
      <div className="min-w-0 flex-1 text-ui">
        <span className="font-semibold text-foreground">{item.title}</span>
        <span className="text-muted-foreground">
          , {MODE_LABEL[item.mode]}, started {formatDateTime(item.createdAt)}
          {left == null ? "" : `, ${Math.max(1, Math.round(left / 60_000))} min left`}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" aria-label={`Discard: ${label}`} disabled={discarding !== null} busy={discarding === item.id} onClick={onDiscard}>
          Discard
        </Button>
        <Button asChild size="sm" variant="secondary">
          <Link href={`/session/${item.id}`} aria-label={`Resume: ${label}`}>
            <PlayIcon size={12} />
            Resume
          </Link>
        </Button>
      </div>
    </li>
  );
}

function pausedText(item: SessionHistoryItem): string {
  const reason = item.pause?.reason ?? null;
  const why = reason === "error" ? "Paused by an error." : reason === "user" ? "Paused by you." : pauseText(reason);
  const left = item.pause?.timeLeftMs;
  const time = left == null ? "" : ` ${Math.max(1, Math.round(left / 60_000))} min left on the clock.`;
  return `${why}${time}`;
}

function startLabels(problem: ProblemSummary) {
  return {
    interview: `Start interview: ${problem.title}`,
    guided: `Start guided practice: ${problem.title}`,
  };
}

function StartButtons({
  problem,
  busy,
  onChoose,
  size = "sm",
  emphasis,
  onHero,
}: {
  problem: ProblemSummary;
  busy: boolean;
  onChoose: (p: ProblemSummary, mode: Mode) => void;
  size?: "sm" | "default" | "lg";
  emphasis?: boolean;
  /** On the mesh panel the second button is a filled tab colour, since an outline would sit on the pale glow. */
  onHero?: boolean;
}) {
  const labels = startLabels(problem);
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button
        size={size}
        variant={emphasis ? "default" : "secondary"}
        disabled={busy}
        aria-label={labels.interview}
        onClick={() => onChoose(problem, "interview")}
      >
        Start interview
      </Button>
      <Tooltip content={GUIDED_HINT}>
        <Button
          size={size}
          variant={onHero ? "secondary" : "outline"}
          disabled={busy}
          aria-label={labels.guided}
          onClick={() => onChoose(problem, "guided")}
        >
          Guided
        </Button>
      </Tooltip>
    </div>
  );
}

function reasonFor(problem: ProblemSummary): string {
  if (problem.badge !== "redo") return "Next in your tracker, on the other track from your last round.";
  const days = problem.lastAttempt ? daysSince(problem.lastAttempt.date) : null;
  const when = days === null ? "a while ago" : days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  return `Marked partly done. Your last attempt was ${when}, so a cold redo is due.`;
}

/** The mesh panel of the page: the recommended round, with its plan drawn to scale on a glass tile and the two ways to start. */
function HeroCard({ problem, minutes, busy, onChoose }: { problem: ProblemSummary; minutes: number; busy: boolean; onChoose: (p: ProblemSummary, mode: Mode) => void }) {
  const plan = phasePlan(problem.track, minutes);
  const pill = "inline-flex items-center rounded-full bg-white/15 px-2.5 py-px text-meta font-semibold text-foreground ring-1 ring-inset ring-white/25";
  return (
    <Card variant="mesh" className="grid gap-x-10 gap-y-6 p-6 sm:p-9 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-end">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-amber px-2.5 py-px text-ui font-bold text-amber-foreground">
            {problem.badge === "redo" ? "Redo" : "Recommended"}
          </span>
          <span className={pill} title={TRACK_TITLE[problem.track]}>
            {TRACK_LABEL[problem.track]}
          </span>
          <span className="text-ui capitalize text-muted-foreground">{problem.difficulty}</span>
        </div>
        <div>
          <h3 className="font-display text-display font-extrabold tracking-[-0.02em] sm:text-mega">{problem.title}</h3>
          <p className="mt-2 max-w-[52ch] text-body text-muted-foreground">{reasonFor(problem)}</p>
        </div>
        <StartButtons problem={problem} busy={busy} onChoose={onChoose} size="lg" emphasis onHero />
      </div>
      <div className="mesh-tile rounded-2xl p-4 sm:p-5">
        <p className="mb-2.5 text-ui font-semibold text-foreground">Your plan for a {minutes}-minute round</p>
        <div className="flex h-3 gap-0.5" aria-hidden="true">
          {plan.map((phase, index) => (
            <span
              key={phase.id}
              title={`${phase.label}, ${phase.minutes} min`}
              style={{ flexGrow: phase.minutes, flexBasis: 0, ...fillStep(index, 350) }}
              className={cn("fill-x rounded-full", index === 0 ? "bar-fill shadow-[0_0_12px_var(--hero-button-glow)]" : "bg-white/25")}
            />
          ))}
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-meta text-muted-foreground">
          {plan.map((phase) => (
            <li key={phase.id} className="flex justify-between gap-2">
              <span className="truncate">{phase.label}</span>
              <span className="shrink-0 tabular-nums">{phase.minutes} min</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

/** A redo that is due, one line under the hero. */
function RedoRow({ problem, index, busy, onChoose }: { problem: ProblemSummary; index: number; busy: boolean; onChoose: (p: ProblemSummary, mode: Mode) => void }) {
  return (
    <div className="reveal lift-row flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 hover:bg-accent/40" style={stagger(index)}>
      <Badge tone={problem.badge === "redo" ? "warn" : "accent"}>{problem.badge === "redo" ? "Redo" : "Recommended"}</Badge>
      <div className="min-w-[min(100%,16rem)] flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-body font-bold">{problem.title}</span>
          <span className="text-ui capitalize text-muted-foreground">
            {TRACK_LABEL[problem.track]}, {problem.difficulty}
          </span>
        </p>
        <p className="text-ui text-muted-foreground">{reasonFor(problem)}</p>
      </div>
      <StartButtons problem={problem} busy={busy} onChoose={onChoose} />
    </div>
  );
}

function FullWidthProblemList({
  track,
  trackOptions,
  problems,
  filter,
  sort,
  busy,
  onTrackChange,
  onFilterChange,
  onSortChange,
  onChoose,
}: {
  track: Track;
  trackOptions: { value: Track; label: string; title: string }[];
  problems: ProblemSummary[];
  filter: StatusFilter;
  sort: SortOption;
  busy: boolean;
  onTrackChange: (t: Track) => void;
  onFilterChange: (f: StatusFilter) => void;
  onSortChange: (s: SortOption) => void;
  onChoose: (p: ProblemSummary, mode: Mode) => void;
}) {
  const visible = filterAndSortProblems(problems, filter, sort);

  return (
    <section aria-labelledby="problems-heading" className="reveal" style={stagger(3)}>
      <h2 id="problems-heading" className="sr-only">
        Practice questions
      </h2>
      <Tabs value={track} onValueChange={(next) => onTrackChange(next as Track)}>
        <Card variant="raised" className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border bg-muted/60 px-4 py-3">
            <TabsList aria-label="Practice track" className="bg-sunken">
              {trackOptions.map((option) => (
                // The tooltip sits inside the tab: wrapping the tab would overwrite its data-state, which marks the selected tab.
                <TabsTrigger key={option.value} value={option.value}>
                  <Tooltip content={option.title}>
                    <span>{option.label}</span>
                  </Tooltip>
                </TabsTrigger>
              ))}
            </TabsList>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 text-ui">
                <label htmlFor="status-filter" className="font-medium text-muted-foreground">
                  Status:
                </label>
                <Select id="status-filter" label="Status" size="sm" value={filter} options={STATUS_OPTIONS} onChange={onFilterChange} />
              </div>

              <div className="flex items-center gap-1.5 text-ui">
                <label htmlFor="sort-option" className="font-medium text-muted-foreground">
                  Sort:
                </label>
                <Select id="sort-option" label="Sort" size="sm" value={sort} options={SORT_OPTIONS} onChange={onSortChange} />
              </div>
            </div>
          </div>

          <TabsContent value={track}>
            {problems.length === 0 ? (
              <p className="px-4 py-6 text-ui text-muted-foreground">No problems on this track yet.</p>
            ) : visible.length === 0 ? (
              <EmptyState
                title={<>No problems match the &ldquo;{STATUS_FILTER_LABELS[filter]}&rdquo; filter.</>}
                action={
                  <Button size="sm" variant="outline" onClick={() => onFilterChange("all")}>
                    Clear filter
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {visible.map((problem, index) => (
                  <li
                    key={problem.id}
                    className={cn(
                      "reveal lift-row grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-accent/50 sm:grid-cols-[1.5rem_minmax(0,1fr)_4.5rem_minmax(0,15rem)_auto]",
                      problem.badge === "next" && "bg-primary-soft/50 shadow-[inset_3px_0_0_var(--primary)]",
                      problem.badge === "redo" && "bg-warning-soft/50 shadow-[inset_3px_0_0_var(--warning-fill)]",
                    )}
                    style={stagger(index)}
                  >
                    <MarkGlyph problem={problem} />
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="truncate text-body font-bold" title={problem.summary || undefined}>
                        {problem.title}
                      </span>
                      {problem.badge === "next" ? <Badge tone="accent">Next</Badge> : null}
                      {problem.badge === "redo" ? <Badge tone="warn">Redo</Badge> : null}
                      {problem.custom ? <Badge>Custom</Badge> : null}
                    </div>
                    <span className="col-start-2 text-ui capitalize text-muted-foreground sm:col-start-auto">{problem.difficulty}</span>
                    <div className="col-start-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-ui text-muted-foreground sm:col-start-auto">
                      {problem.lastAttempt ? (
                        <>
                          <Tooltip content="Open the last attempt">
                            <Link href={`/session/${problem.lastAttempt.sessionId}`} className="rounded text-primary-text underline-offset-2 hover:underline">
                              Last tried {formatDate(problem.lastAttempt.date)}
                            </Link>
                          </Tooltip>
                          {problem.lastAttempt.verdict ? (
                            <Badge tone={VERDICT_TONE[problem.lastAttempt.verdict]} title="Result at the SDE-2 bar">
                              {VERDICT_LABEL[problem.lastAttempt.verdict]}
                            </Badge>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-faint">Not tried yet</span>
                      )}
                    </div>
                    <div className="col-start-2 mt-1 sm:col-start-auto sm:mt-0">
                      <StartButtons problem={problem} busy={busy} onChoose={onChoose} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Card>
      </Tabs>
    </section>
  );
}

/** The tracker mark as a shape, so done, partly done and not done differ without relying on colour. */
function MarkGlyph({ problem }: { problem: ProblemSummary }) {
  const mark = problem.trackerMark;
  const label = mark === null ? "Not in the tracker" : MARK_LABEL[mark];
  return (
    <span role="img" aria-label={label} title={mark === null ? label : `${label} ${mark}`} className="flex size-6 shrink-0 items-center justify-center">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        {mark === "[x]" ? (
          <>
            <circle cx="9" cy="9" r="8" className="fill-success-fill" />
            <path d="M5.5 9.2 8 11.6l4.6-5" fill="none" stroke="var(--card)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </>
        ) : mark === "[~]" ? (
          <>
            <circle cx="9" cy="9" r="7.25" fill="none" className="stroke-warning-fill" strokeWidth="1.5" />
            <path d="M9 1.75a7.25 7.25 0 0 1 0 14.5z" className="fill-warning-fill" />
          </>
        ) : mark === "[ ]" ? (
          <circle cx="9" cy="9" r="7.25" fill="none" className="stroke-input" strokeWidth="1.5" />
        ) : (
          <circle cx="9" cy="9" r="7.25" fill="none" className="stroke-input" strokeWidth="1.5" strokeDasharray="2 2.6" />
        )}
      </svg>
    </span>
  );
}

function StartDialog({
  problem,
  mode,
  durations,
  starting,
  error,
  onMode,
  onCancel,
  onStart,
}: {
  problem: ProblemSummary;
  mode: Mode;
  durations: Durations | null;
  starting: string | null;
  error: string | null;
  onMode: (mode: Mode) => void;
  onCancel: () => void;
  onStart: () => void;
}) {
  const minutes = minutesFor(problem.track, durations);
  const plan = phasePlan(problem.track, minutes);
  const busy = starting !== null;
  const guided = mode === "guided";
  const options: { value: Mode; title: string; body: string }[] = [
    {
      value: "interview",
      title: `Interview, ${minutes} minutes`,
      body: "A timed round. The interviewer answers questions and pushes deeper, and gives no hints. Scored at the end.",
    },
    {
      value: "guided",
      title: "Guided practice, no time limit",
      body: "Step by step, with feedback on each step and hints when you ask. Earns at most partly done.",
    },
  ];

  return (
    <Modal
      title={problem.title}
      onClose={onCancel}
      dismissible={!busy}
      width="max-w-2xl"
      footer={
        <>
          {busy ? <Spinner label="Preparing the interviewer…" className="mr-auto text-ui" /> : <span className="mr-auto text-meta text-faint">Press <Kbd>Enter</Kbd> to start</span>}
          {busy ? (
            <Button disabled>Cancel</Button>
          ) : (
            // Closing through DialogClose plays the exit animation; the Modal calls onCancel once it ends.
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
          )}
          <Button variant="default" data-autofocus busy={busy} onClick={onStart}>
            {guided ? "Start guided practice" : "Start interview"}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge title={TRACK_TITLE[problem.track]}>{TRACK_LABEL[problem.track]}</Badge>
          <span className="text-ui text-muted-foreground">
            {TRACK_TITLE[problem.track]}, {problem.difficulty} difficulty
          </span>
        </div>
        {problem.summary ? <p className="text-body text-muted-foreground">{problem.summary}</p> : null}

        {error ? <ErrorLine text={error} /> : null}

        <fieldset>
          <legend className="mb-2 text-ui font-semibold text-foreground">How do you want to practise?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {options.map((option) => {
              const selected = mode === option.value;
              return (
                <label
                  key={option.value}
                  className={cn(
                    "relative flex cursor-pointer flex-col gap-1 rounded-md border py-3.5 pl-3.5 pr-10 transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                    selected ? "tint border-primary bg-primary-soft text-primary-soft-foreground ring-1 ring-primary/30" : "lift border-border hover:bg-accent/40",
                    busy && "cursor-not-allowed opacity-60",
                  )}
                >
                  <input type="radio" name="start-mode" value={option.value} checked={selected} disabled={busy} onChange={() => onMode(option.value)} className="sr-only" />
                  {selected ? (
                    <span aria-hidden="true" className="absolute right-3 top-3 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <CheckIcon size={12} />
                    </span>
                  ) : null}
                  <span className={cn("text-body font-semibold", selected ? "text-primary-soft-foreground" : "text-foreground")}>{option.title}</span>
                  <span className="text-ui text-muted-foreground">{option.body}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <section aria-label="Your plan">
          <h3 className="mb-2 text-ui font-semibold text-foreground">{guided ? "Your method, step by step" : `Your plan for ${minutes} minutes`}</h3>
          <PlanPreview plan={plan} track={problem.track} />
        </section>
      </div>
    </Modal>
  );
}

const CUSTOM_JOB_KEY = "ir-custom-job";

function CustomPrompt({
  starting,
  busy,
  onStart,
  onReloadProblems,
}: {
  starting: string | null;
  busy: boolean;
  onStart: (problemId: string, mode: Mode) => void;
  onReloadProblems?: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [track, setTrack] = useState<Track>("hld");
  const [job, setJob] = useState<CustomProblemJobStatus | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);

  const onReloadProblemsRef = useRef(onReloadProblems);
  useEffect(() => {
    onReloadProblemsRef.current = onReloadProblems;
  }, [onReloadProblems]);

  const trimmed = prompt.trim();
  const valid = trimmed.length >= CUSTOM_MIN && trimmed.length <= CUSTOM_MAX;

  // Preparation runs on the server for minutes; after a reload, pick up a running job, and show a finished one only to the tab that started it.
  useEffect(() => {
    let cancelled = false;
    api
      .currentCustomProblemJob()
      .then(({ job: current }) => {
        if (cancelled || !current) return;
        const running = current.stage === "researching" || current.stage === "writing" || current.stage === "checking";
        if (!running && sessionStorage.getItem(CUSTOM_JOB_KEY) !== current.id) return;
        setJob(current);
        if (current.track) setTrack(current.track);
        if (running) setPreparing(true);
        else if (current.stage === "failed") setJobError(current.error || "Could not prepare that problem. Try again, or rephrase the prompt.");
        else if (current.stage === "cancelled") sessionStorage.removeItem(CUSTOM_JOB_KEY);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const startPreparation = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!valid || busy || preparing) return;
    setPreparing(true);
    setJobError(null);
    try {
      const { jobId } = await api.prepareCustomProblem({ prompt: trimmed, track });
      sessionStorage.setItem(CUSTOM_JOB_KEY, jobId);
      setJob({
        id: jobId,
        stage: "researching",
        searches: 0,
        pages: 0,
      });
    } catch (err) {
      setPreparing(false);
      setJobError(err instanceof ApiError && err.message ? err.message : "Could not prepare that problem. Try again, or rephrase the prompt.");
    }
  };

  const cancelPreparation = async () => {
    if (!job || cancelling) return;
    setCancelling(true);
    try {
      const updated = await api.cancelCustomProblemJob(job.id);
      setJob(updated);
      setPreparing(false);
      sessionStorage.removeItem(CUSTOM_JOB_KEY);
    } catch (err) {
      setJobError(err instanceof ApiError && err.message ? err.message : "Could not cancel preparation.");
    } finally {
      setCancelling(false);
    }
  };

  useEffect(() => {
    if (!job || !preparing) return;
    if (job.stage === "ready" || job.stage === "failed" || job.stage === "cancelled") {
      setPreparing(false);
      return;
    }

    let active = true;
    const timer = setInterval(async () => {
      try {
        const next = await api.customProblemJob(job.id);
        if (!active) return;
        setJob(next);
        if (next.stage === "ready") {
          setPreparing(false);
          onReloadProblemsRef.current?.();
        } else if (next.stage === "failed") {
          setPreparing(false);
          setJobError(next.error || "Could not prepare that problem. Try again, or rephrase the prompt.");
        } else if (next.stage === "cancelled") {
          setPreparing(false);
          sessionStorage.removeItem(CUSTOM_JOB_KEY);
        }
      } catch {
        if (!active) return;
        setPreparing(false);
        setJobError("Cannot reach the server to check preparation progress.");
      }
    }, 1000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [job?.id, job?.stage, preparing]);

  return (
    <section aria-labelledby="custom-heading" style={stagger(4)} className="reveal grid gap-x-10 gap-y-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div>
        <SectionTitle id="custom-heading">Practise any question</SectionTitle>
        <p className="-mt-1 max-w-[40ch] text-ui text-muted-foreground">
          Paste a question from a list or a past interview. The app researches real systems, writes a private brief, and checks its facts before you start.
        </p>
      </div>

      <div>
        {jobError ? (
          <div className="mb-4">
            <ErrorLine text={jobError} />
          </div>
        ) : null}

        {job?.stage === "ready" ? (
          <Card className="flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lead font-semibold text-foreground">{job.title}</h3>
                  <Badge title={TRACK_TITLE[job.track ?? track]}>{TRACK_LABEL[job.track ?? track]}</Badge>
                </div>
                <p className="mt-1 text-ui text-muted-foreground">
                  {job.sourcesCount ?? 0} {job.sourcesCount === 1 ? "source" : "sources"}, {job.checksCount ?? 0} {job.checksCount === 1 ? "fact checked" : "facts checked"}
                </p>
              </div>
            </div>

            {job.corrections && job.corrections.length > 0 ? (
              <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2">
                <p className="text-ui font-medium text-foreground">
                  {job.corrections.length} {job.corrections.length === 1 ? "correction applied" : "corrections applied"}:
                </p>
                <ul className="space-y-1 text-meta text-muted-foreground">
                  {job.corrections.map((c, i) => (
                    <li key={i}>
                      <span className="font-semibold text-foreground">[{c.section}]</span> {c.claim} → <span className="text-success">{c.fix}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {job.confidence ? (
              <p className="text-ui text-muted-foreground italic">
                Confidence: {job.confidence}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button
                variant="default"
                disabled={busy}
                busy={starting === `${job.problemId}:interview`}
                onClick={() => {
                  sessionStorage.removeItem(CUSTOM_JOB_KEY);
                  if (job.problemId) onStart(job.problemId, "interview");
                }}
              >
                Start interview
              </Button>
              <Tooltip content={GUIDED_HINT}>
                <Button
                  variant="outline"
                  disabled={busy}
                  busy={starting === `${job.problemId}:guided`}
                  onClick={() => {
                    sessionStorage.removeItem(CUSTOM_JOB_KEY);
                    if (job.problemId) onStart(job.problemId, "guided");
                  }}
                >
                  Guided
                </Button>
              </Tooltip>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  sessionStorage.removeItem(CUSTOM_JOB_KEY);
                  setJob(null);
                  setPrompt("");
                }}
              >
                Prepare another question
              </Button>
            </div>
          </Card>
        ) : job?.stage === "cancelled" ? (
          <Card className="flex flex-col gap-4 p-5">
            <h3 className="text-ui font-semibold text-foreground">Preparation cancelled</h3>
            <p className="text-ui text-muted-foreground">You cancelled the preparation of this question.</p>
            <div className="pt-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  sessionStorage.removeItem(CUSTOM_JOB_KEY);
                  setJob(null);
                }}
              >
                Try again
              </Button>
            </div>
          </Card>
        ) : preparing || (job && (job.stage === "researching" || job.stage === "writing" || job.stage === "checking")) ? (
          <Card className="flex flex-col gap-4 p-5">
            <h3 className="text-ui font-semibold text-foreground">Preparing the interviewer brief</h3>
            <ol className="space-y-2.5 text-ui">
              <li className={cn("flex items-center gap-2.5 transition-colors duration-200",job?.stage === "researching" ? "font-semibold text-foreground" : (job?.stage === "writing" || job?.stage === "checking") ? "text-muted-foreground" : "text-faint")}>
                {job?.stage === "researching" ? (
                  <Spinner label="" className="size-4" />
                ) : (job?.stage === "writing" || job?.stage === "checking") ? (
                  <CheckIcon size={16} className="text-success" />
                ) : (
                  <span className="size-4 rounded-full border border-border inline-block" />
                )}
                <span>
                  Researching{job && job.searches + job.pages > 0 ? `: ${job.searches} ${job.searches === 1 ? "search" : "searches"}, ${job.pages} ${job.pages === 1 ? "page" : "pages"}` : ""}
                </span>
              </li>
              <li className={cn("flex items-center gap-2.5 transition-colors duration-200",job?.stage === "writing" ? "font-semibold text-foreground" : job?.stage === "checking" ? "text-muted-foreground" : "text-faint")}>
                {job?.stage === "writing" ? (
                  <Spinner label="" className="size-4" />
                ) : job?.stage === "checking" ? (
                  <CheckIcon size={16} className="text-success" />
                ) : (
                  <span className="size-4 rounded-full border border-border inline-block" />
                )}
                <span>Writing the brief</span>
              </li>
              <li className={cn("flex items-center gap-2.5 transition-colors duration-200",job?.stage === "checking" ? "font-semibold text-foreground" : "text-faint")}>
                {job?.stage === "checking" ? (
                  <Spinner label="" className="size-4" />
                ) : (
                  <span className="size-4 rounded-full border border-border inline-block" />
                )}
                <span>Checking facts</span>
              </li>
            </ol>
            <p className="text-meta text-faint">Web search and verification take about a minute.</p>
            <div className="pt-1">
              <Button
                variant="ghost"
                disabled={busy || cancelling}
                busy={cancelling}
                onClick={cancelPreparation}
              >
                Cancel
              </Button>
            </div>
          </Card>
        ) : (
          <Card variant="raised" className="p-5">
            <form onSubmit={startPreparation}>
              <label htmlFor="custom-prompt" className="mb-1.5 block text-ui font-semibold">
                Paste an interview question
              </label>
              <Textarea
                id="custom-prompt"
                rows={4}
                value={prompt}
                maxLength={CUSTOM_MAX}
                disabled={busy || preparing}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="For example: Design a rate limiter that protects a public API."
                className="resize-y"
              />
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-3">
                <Segmented
                  label="Question type"
                  value={track}
                  disabled={busy || preparing}
                  options={[
                    { value: "hld", label: "HLD", title: TRACK_TITLE.hld },
                    { value: "lld", label: "LLD", title: TRACK_TITLE.lld },
                  ]}
                  onChange={setTrack}
                />
                <Button type="submit" variant="default" disabled={!valid || busy || preparing} busy={preparing}>
                  Prepare question
                </Button>
                <span className={cn("ml-auto font-mono text-meta tabular-nums", prompt.length > CUSTOM_MAX * 0.9 ? "text-warning" : "text-faint")}>
                  {prompt.length} / {CUSTOM_MAX}
                </span>
              </div>
            </form>
          </Card>
        )}
      </div>
    </section>
  );
}

const STATUS_LABEL: Record<SessionHistoryItem["status"], { label: string; tone: Tone }> = {
  live: { label: "In progress", tone: "accent" },
  paused: { label: "Paused", tone: "warn" },
  ended: { label: "Round ended", tone: "neutral" },
  debriefing: { label: "Debriefing", tone: "accent" },
  debriefed: { label: "Debriefed", tone: "neutral" },
  failed: { label: "Debrief failed", tone: "bad" },
};

function Th({ children }: { children?: ReactNode }) {
  return (
    <th scope="col" className="px-4 py-2.5 text-meta font-semibold text-muted-foreground">
      {children}
    </th>
  );
}

function HistorySection({
  history,
  discarding,
  onAskDiscard,
}: {
  history: SessionHistoryItem[] | null;
  discarding: string | null;
  onAskDiscard: (item: SessionHistoryItem) => void;
}) {
  const [all, setAll] = useState(false);
  if (history === null) return null;
  const shown = all ? history : history.slice(0, HISTORY_SHOWN);
  return (
    <section aria-labelledby="history-heading" className="reveal" style={stagger(5)}>
      <SectionTitle id="history-heading" focusable aside={history.length > 0 ? `${history.length} ${history.length === 1 ? "round" : "rounds"}` : undefined}>
        History
      </SectionTitle>
      {history.length === 0 ? (
        <EmptyState title="Your finished rounds will appear here." />
      ) : (
        <Card variant="raised" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-left text-ui">
              <thead className="border-b border-border bg-muted/60">
                <tr>
                  <Th>Date</Th>
                  <Th>Problem</Th>
                  <Th>Mode</Th>
                  <Th>Result</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((item) => {
                  const status = STATUS_LABEL[item.status];
                  const open = item.status === "live" || item.status === "paused" ? "Resume" : item.status === "debriefed" ? "Open debrief" : "Open";
                  const label = `${item.title}, ${formatDateTime(item.createdAt)}`;
                  const discardButton = (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="hover:text-destructive"
                      aria-label={`Discard: ${label}`}
                      disabled={item.status === "debriefing" || discarding !== null}
                      busy={discarding === item.id}
                      onClick={() => onAskDiscard(item)}
                    >
                      Discard
                    </Button>
                  );
                  return (
                    <tr key={item.id} className="transition-colors hover:bg-accent/40">
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-meta tabular-nums text-muted-foreground">{formatDateTime(item.createdAt)}</td>
                      <td className="px-4 py-2.5">
                        <span className="text-body font-semibold">{item.title}</span> <span className="ml-1 text-meta font-semibold text-muted-foreground">{TRACK_LABEL[item.track]}</span>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{MODE_LABEL[item.mode]}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {item.verdict ? <Badge tone={VERDICT_TONE[item.verdict]}>{VERDICT_LABEL[item.verdict]}</Badge> : <Badge tone={status.tone}>{status.label}</Badge>}
                          {item.status === "debriefed" ? <Badge tone={item.notesSaved ? "good" : "neutral"}>{item.notesSaved ? "Notes saved" : "Notes not saved"}</Badge> : null}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-end gap-2">
                          <Button asChild size="sm" variant="secondary">
                            <Link href={`/session/${item.id}`} aria-label={`${open}: ${label}`}>
                              {open}
                            </Link>
                          </Button>
                          {item.status === "debriefing" ? (
                            // A disabled button takes no pointer events, so the hover target is the wrapper.
                            <Tooltip content="The debrief is running. Discard is possible once it finishes.">
                              <span className="inline-flex">{discardButton}</span>
                            </Tooltip>
                          ) : (
                            discardButton
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {history.length > HISTORY_SHOWN ? (
            <div className="border-t border-border px-4 py-2.5">
              <Button size="sm" variant="ghost" onClick={() => setAll((value) => !value)}>
                {all ? "Show fewer" : `Show all ${history.length}`}
              </Button>
            </div>
          ) : null}
        </Card>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Live page

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message || fallback;
  return fallback;
}

export function HomePage({ fakeAgent, onOpenSettings, durations }: { fakeAgent: boolean; onOpenSettings: () => void; durations: Durations | null }) {
  const [problems, setProblems] = useState<ProblemSummary[] | null>(null);
  const [history, setHistory] = useState<SessionHistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState<string | null>(null);
  const [discardError, setDiscardError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [p, h] = await Promise.allSettled([api.problems(), api.history()]);
    if (p.status === "fulfilled") setProblems(p.value);
    else setError(messageOf(p.reason, "The problem list could not be loaded."));
    // History is secondary: an empty list is better than blocking the page.
    setHistory(h.status === "fulfilled" ? h.value : []);
  }, []);

  useEffect(() => {
    document.title = "Interview Room";
    void load();
  }, [load]);

  const begin = async (key: string, body: Parameters<typeof api.createSession>[0]) => {
    setStarting(key);
    setStartError(null);
    try {
      const { sessionId } = await api.createSession(body);
      navigate(`/session/${sessionId}`);
    } catch (failure) {
      setStartError(messageOf(failure, "The interview could not be started."));
      setStarting(null);
    }
  };

  const discard = async (sessionId: string) => {
    setDiscarding(sessionId);
    setDiscardError(null);
    try {
      await api.discardSession(sessionId);
    } catch (failure) {
      // A round that is already gone (deleted in another tab) is what the user wanted.
      if (!(failure instanceof ApiError && failure.status === 404)) setDiscardError(messageOf(failure, "The round could not be discarded."));
    }
    await load();
    setDiscarding(null);
  };

  return (
    <HomeView
      problems={problems}
      history={history}
      error={error}
      onRetry={() => void load()}
      starting={starting}
      startError={startError}
      discarding={discarding}
      discardError={discardError}
      onDiscard={(sessionId) => void discard(sessionId)}
      fakeAgent={fakeAgent}
      onOpenSettings={onOpenSettings}
      durations={durations}
      onStart={(problemId, mode) => void begin(`${problemId}:${mode}`, { problemId, mode })}
      onStartCustom={(prompt, track, mode) => void begin(`custom:${mode}`, { customPrompt: prompt, customTrack: track, mode })}
    />
  );
}
