import { useEffect, useMemo, useRef, useState } from "react";
import { BASE_MINUTES, type Mode } from "../../shared/phases";
import type { ProblemSummary, SessionHistoryItem } from "../../shared/types";
import { ChevronRightIcon, PlayFilledIcon, RedoIcon, WarnIcon } from "../components/icons";
import { GUIDED_HINT, INTERVIEW_HINT, InfoTip, ModeSwitch, TrackChip, TrackIcon } from "../components/study";
import { Alert, Badge, Button, Card, EmptyState, Segmented, Skeleton, TONE_TEXT, cn } from "../components/ui";
import { dayMonth } from "../lib/dates";
import { MODE_LABEL } from "../lib/format";
import { FILTER_LABEL, STATUS_LABEL, inTab, libraryGroups, openRoundFor, problemStatus, tabCounts, type LibraryFilter, type LibraryTab } from "../lib/library";
import { scrollToInScroller } from "../lib/scrollInScroller";
import { startKey, type StudyData } from "../lib/useStudyData";
import { attemptBadge } from "../lib/verdict";
import { modeFor } from "../../shared/today";
import { Link, useHash } from "../router";
import type { PageContext } from "./context";

const DEBRIEF_MINUTES = 15;

function resultOf(problem: ProblemSummary, open: boolean): { word: string; tone: "good" | "warn" | "bad" | "neutral" | "accent"; detail: string | null } {
  const badge = problem.lastAttempt ? attemptBadge(problem.lastAttempt) : null;
  const word =
    badge ?? (problem.trackerMark === "[~]" ? { label: "Partly done", tone: "warn" as const } : problem.trackerMark === "[x]" ? { label: "Done", tone: "good" as const } : null);
  const detail = open
    ? "Round open"
    : problem.badge === "redo"
      ? `Redo due ${problem.redoDueOn ? dayMonth(problem.redoDueOn) : "now"}`
      : problem.lastAttempt
        ? `Tried ${dayMonth(problem.lastAttempt.date)}`
        : null;
  return { word: word?.label ?? "Not tried", tone: word?.tone ?? "neutral", detail };
}

function Mark({ problem, open }: { problem: ProblemSummary; open: boolean }) {
  const label = open ? "Round open" : problem.badge === "redo" ? "Redo due" : problem.trackerMark === "[x]" ? "Done" : problem.trackerMark === "[~]" ? "Partly done" : "Not tried";
  return (
    <span role="img" aria-label={label} className="flex size-6 shrink-0 items-center justify-center">
      {problem.badge === "redo" || open ? (
        <RedoIcon size={16} className="text-warning" />
      ) : problem.trackerMark === "[x]" ? (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <circle cx="9" cy="9" r="8" className="fill-success-fill" />
          <path d="M5.5 9.2 8 11.6l4.6-5" fill="none" stroke="var(--card)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : problem.trackerMark === "[~]" ? (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <circle cx="9" cy="9" r="7.25" fill="none" className="stroke-warning-fill" strokeWidth="1.5" />
          <path d="M9 1.75a7.25 7.25 0 0 1 0 14.5z" className="fill-warning-fill" />
        </svg>
      ) : (
        <span className="size-3.5 rounded-full border-[1.5px] border-border-strong" />
      )}
    </span>
  );
}

/** The Rounds side of the Practice page: pick a problem, read its detail, start a round. */
export function RoundsPanel({ data, ctx }: { data: StudyData; ctx: PageContext }) {
  const { problems, history, error } = data;
  const [tab, setTab] = useState<LibraryTab>("hld");
  const [filter, setFilter] = useState<LibraryFilter>("fresh");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  const hashNav = useHash();
  const applied = useRef<unknown>(null);

  // A link such as /practice#<problem id> opens the list on that problem, in its own track. Each link applies once,
  // so a later reload of the list does not undo what the user chose since.
  useEffect(() => {
    if (applied.current === hashNav || !problems) return;
    const target = hashNav.hash.length > 1 ? problems.find((p) => p.id === hashNav.hash.slice(1)) : undefined;
    applied.current = hashNav;
    if (!target) return;
    setTab(target.custom ? "custom" : ((["hld", "lld"] as const).find((t) => inTab(target, t)) ?? "hld"));
    setFilter("all");
    setSelectedId(target.id);
  }, [hashNav, problems]);

  const counts = useMemo(() => tabCounts(problems ?? []), [problems]);
  const groups = useMemo(() => libraryGroups(problems ?? [], tab, filter), [problems, tab, filter]);
  const visible = groups.flatMap((g) => g.problems);
  const selected = visible.find((p) => p.id === selectedId) ?? visible[0] ?? null;

  const select = (id: string) => {
    setSelectedId(id);
    // On a narrow screen the detail sits below the list, so bring it into view.
    if (typeof matchMedia === "function" && !matchMedia("(min-width: 1024px)").matches) scrollToInScroller(panel.current, { behavior: "smooth" });
  };

  return (
    <div className="space-y-6">
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Track"
          value={tab}
          onChange={setTab}
          options={[
            { value: "hld", label: "HLD", count: counts.hld, icon: <TrackIcon track="hld" /> },
            { value: "lld", label: "LLD", count: counts.lld, icon: <TrackIcon track="lld" /> },
            { value: "custom", label: "My questions", count: counts.custom },
          ]}
        />
        <Segmented
          label="Show"
          size="sm"
          value={filter}
          onChange={setFilter}
          options={(Object.keys(FILTER_LABEL) as LibraryFilter[]).map((value) => ({ value, label: FILTER_LABEL[value] }))}
        />
      </div>

      {problems === null && !error ? (
        <ListSkeleton />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
          <Card variant="raised" className="p-2">
            {groups.length === 0 ? (
              <EmptyState
                className="m-2"
                title={tab === "custom" ? "No questions of your own yet." : filter === "redo" ? "No redo is due." : "No problems here."}
                action={
                  tab === "custom" ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href="/library/new">Practise any question</Link>
                    </Button>
                  ) : filter !== "all" ? (
                    <Button size="sm" variant="outline" onClick={() => setFilter("all")}>
                      Show all
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              groups.map((group) => (
                <section key={group.id} aria-label={group.label}>
                  <div className="flex items-center justify-between px-3.5 pb-1.5 pt-3 text-ui font-semibold text-faint">
                    <h2>{group.label}</h2>
                    <span aria-label={`${group.problems.length} problems`}>{group.problems.length}</span>
                  </div>
                  <ul>
                    {group.problems.map((problem) => (
                      <ProblemRow
                        key={problem.id}
                        problem={problem}
                        open={openRoundFor(problem.id, history ?? []) !== undefined}
                        selected={selected?.id === problem.id}
                        onSelect={() => select(problem.id)}
                      />
                    ))}
                  </ul>
                </section>
              ))
            )}
          </Card>
          <aside ref={panel} aria-label="Problem details" className="scroll-mt-[calc(var(--header-h)+1rem)] lg:sticky lg:top-[calc(var(--header-h)+1rem)]">
            {selected ? <Detail problem={selected} history={history ?? []} data={data} ctx={ctx} /> : null}
          </aside>
        </div>
      )}
    </div>
  );
}

function ProblemRow({ problem, open, selected, onSelect }: { problem: ProblemSummary; open: boolean; selected: boolean; onSelect: () => void }) {
  const result = resultOf(problem, open);
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
          "group grid min-h-11 w-full grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3.5 rounded-xl px-3.5 py-1.5 text-left transition-colors sm:grid-cols-[1.5rem_minmax(0,1fr)_4.5rem_9.5rem_1.25rem]",
          selected ? "bg-primary-soft ring-1 ring-inset ring-primary/40" : "hover:bg-accent/50",
        )}
      >
        <Mark problem={problem} open={open} />
        <span className="min-w-0">
          <span className="block truncate text-body font-semibold">{problem.title}</span>
          <span className="block text-meta capitalize text-faint sm:hidden">{problem.difficulty}</span>
        </span>
        <span className="hidden text-ui capitalize text-faint sm:block">{problem.difficulty}</span>
        <span className="text-right text-meta leading-4">
          <span className={cn("block font-semibold", result.word === "Not tried" ? "text-faint" : TONE_TEXT[result.tone])}>{result.word}</span>
          {result.detail ? <span className="block text-faint">{result.detail}</span> : null}
        </span>
        <ChevronRightIcon size={16} className={cn("hidden text-faint transition-opacity sm:block", selected ? "opacity-100" : "opacity-0 group-hover:opacity-100")} />
      </button>
    </li>
  );
}

function Detail({ problem, history, data, ctx }: { problem: ProblemSummary; history: readonly SessionHistoryItem[]; data: StudyData; ctx: PageContext }) {
  const defaultMode = modeFor(problem);
  const [mode, setMode] = useState<Mode>(defaultMode);
  useEffect(() => setMode(defaultMode), [problem.id, defaultMode]);
  const status = problemStatus(problem, history);
  const openRound = openRoundFor(problem.id, history);
  const minutes = ctx.settings.durations[problem.track] ?? BASE_MINUTES[problem.track];
  const key = startKey(problem.id, mode);
  const lastDebrief = problem.lastAttempt && history.find((h) => h.id === problem.lastAttempt?.sessionId && (h.status === "debriefed" || h.status === "failed"));
  return (
    <Card variant="raised" className="p-6 sm:p-7">
      <div className="flex flex-wrap items-center gap-2">
        <TrackChip track={problem.track} />
        <Badge className="px-2.5 py-1 capitalize">{problem.difficulty}</Badge>
        {problem.custom ? <Badge className="px-2.5 py-1">Your question</Badge> : null}
      </div>
      <h2 className="mt-4 font-display text-display font-extrabold sm:text-[36px] sm:leading-[42px]">{problem.title}</h2>
      {problem.summary ? (
        <figure className="mt-5 rounded-xl bg-sunken p-4 ring-1 ring-inset ring-border">
          <figcaption className="text-meta text-muted-foreground">The interviewer opens with</figcaption>
          <blockquote className="mt-1.5 text-body text-foreground">&ldquo;{problem.summary}&rdquo;</blockquote>
        </figure>
      ) : null}
      <dl className="mt-5 grid grid-cols-3 divide-x divide-border rounded-xl bg-sunken ring-1 ring-inset ring-border">
        {[
          ["Status", STATUS_LABEL[status]],
          ["Round", mode === "guided" ? "No limit" : `${minutes} min`],
          ["Debrief", `${DEBRIEF_MINUTES} min`],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 px-4 py-3">
            <dt className="text-meta text-muted-foreground">{label}</dt>
            <dd className={cn("mt-0.5 truncate text-body font-semibold", label === "Status" && status === "redo" && "text-warning")}>{value}</dd>
          </div>
        ))}
      </dl>
      {openRound ? (
        <p className="mt-5 text-ui text-muted-foreground">This problem has a round you did not finish. Finish it before you start another.</p>
      ) : (
        <div className="mt-5">
          <div className="mb-2 flex items-center gap-1.5 text-ui text-muted-foreground">
            Mode
            <InfoTip label="About the modes">
              <span className="block">
                <b>Interview:</b> {INTERVIEW_HINT}
                <br />
                <b>Guided:</b> {GUIDED_HINT}
              </span>
            </InfoTip>
          </div>
          <ModeSwitch value={mode} onChange={setMode} />
        </div>
      )}
      <div className="mt-5">
        {openRound ? (
          <Button asChild size="lg" variant="default" className="w-full">
            <Link href={`/session/${openRound.id}`}>
              <PlayFilledIcon size={14} />
              Finish the open round
            </Link>
          </Button>
        ) : (
          <Button size="lg" variant="default" className="w-full" busy={data.starting === key} disabled={data.starting !== null} onClick={() => data.start(problem.id, mode)}>
            <PlayFilledIcon size={14} />
            Start {MODE_LABEL[mode].toLowerCase()} round
          </Button>
        )}
        <p className="mt-3 text-center text-meta text-muted-foreground">
          {mode === "guided" ? "Guided has no clock. You can stop at any step." : "You read the plan before the clock starts."}
        </p>
        {lastDebrief ? (
          <p className="mt-2 text-center text-meta">
            <Link href={`/session/${lastDebrief.id}`} className="text-primary-text underline underline-offset-4">
              Open the last debrief
            </Link>
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]" role="status">
      <span className="sr-only">Loading problems…</span>
      <Card className="space-y-3 p-4">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </Card>
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}
