import { useMemo, useState, type CSSProperties } from "react";
import { ApiError, api } from "../backend";
import type { PublicSession, Scorecard } from "../../shared/types";
import { ChatPanel } from "../components/ChatPanel";
import { ChatResizeHandle, useChatWidth } from "../components/ChatWidth";
import { DebriefFailed, DebriefProgress } from "../components/debrief/Progress";
import { DimensionsTable } from "../components/debrief/Dimensions";
import { GapsSection } from "../components/debrief/Gaps";
import { JudgeSaw } from "../components/debrief/JudgeSaw";
import { ReferenceAnswer } from "../components/debrief/Reference";
import { ScenarioTable } from "../components/debrief/Scenarios";
import { Steps } from "../components/debrief/Steps";
import { StudyNotes } from "../components/debrief/StudyNotes";
import { TimingRows, TimingSection } from "../components/debrief/Timing";
import { VerdictCard, jumpTo } from "../components/debrief/Verdict";
import { VERDICT_LABEL } from "../lib/verdict";
import { RoundUsageCard } from "../components/debrief/RoundUsageCard";
import { ArrowLeftIcon, CheckIcon, WarnIcon } from "../components/icons";
import { ConnectionBanner, MessageBanners } from "../components/Notices";
import { Banner, Badge, Card, SectionTitle, cn } from "../components/ui";
import { gapMarks, workedText, type GapMark } from "../lib/gapMarks";
import { teachMessage } from "../../shared/gaps";
import { MODE_LABEL, TRACK_LABEL, TRACK_TITLE, formatClock, formatDate } from "../lib/format";
import { finalRoundMs, phaseSpentMs } from "../lib/timing";
import { Link, navigate } from "../router";
import type { ChatItem, NotesState, SessionController } from "../session/types";
import type { Theme } from "../theme";

interface DebriefViewProps {
  ctl: SessionController;
  session: PublicSession;
  theme: Theme;
  boardImageUrl: string;
}

export function DebriefView({ ctl, session, theme, boardImageUrl }: DebriefViewProps) {
  const { state, actions } = ctl;
  const [chatWidth, setChatWidth] = useChatWidth();
  const scorecard = session.scorecard;
  const debriefed = session.status === "debriefed";
  const connected = state.connection === "open";
  const roundMs = finalRoundMs(session);
  const coach = state.agent.coach;
  const marks = useGapMarks(scorecard, session, ctl.chat.coach);

  return (
    <div className="fade-in flex h-full min-h-0 flex-col overflow-hidden">
      <header className="header-hairline relative z-10 flex h-14 shrink-0 items-center gap-3 border-b border-border/70 bg-card px-3 shadow-xs sm:px-4">
        <Link href="/" aria-label="Back to home" className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
          <ArrowLeftIcon size={16} />
        </Link>
        <h1 className="min-w-0 truncate text-lead font-bold tracking-[-0.01em]" title={session.title}>
          {session.title}
        </h1>
        <span className="hidden shrink-0 text-ui text-muted-foreground sm:inline" title={TRACK_TITLE[session.track]}>
          {TRACK_LABEL[session.track]} {MODE_LABEL[session.mode].toLowerCase()}, {formatDate(session.createdAt)}
          {roundMs !== null ? `, ${formatClock(roundMs)} of ${Math.round(session.clock.durationMs / 60_000)}:00` : ""}
        </span>
        <span className="ml-auto">
          <StatusChip status={session.status} />
        </span>
      </header>

      <ConnectionBanner status={state.connection} onRetry={actions.reconnect} />
      <MessageBanners state={state} actions={actions} />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <main className="page-canvas relative min-w-0 flex-1 overflow-y-auto" tabIndex={-1}>
          {scorecard ? <StepsBar session={session} scorecard={scorecard} notes={state.notes} marks={marks} /> : null}
          <div className="reveal-children mx-auto max-w-4xl space-y-12 px-4 pb-20 pt-8 sm:px-8">
            {session.status === "debriefing" ? (
              <DebriefProgress track={session.track} debrief={state.debrief}>
                <WhileYouWait session={session} />
              </DebriefProgress>
            ) : null}
            {session.status === "failed" ? <DebriefFailed onRetry={actions.retryDebrief} connected={connected} /> : null}
            {scorecard ? (
              <ScorecardBody ctl={ctl} session={session} scorecard={scorecard} theme={theme} boardImageUrl={boardImageUrl} marks={marks} />
            ) : session.status === "debriefed" ? (
              <Card className="p-6 text-ui text-muted-foreground">The scorecard is not available for this session.</Card>
            ) : null}
          </div>
        </main>

        <div className="hidden md:flex">
          <ChatResizeHandle width={chatWidth} onChange={setChatWidth} />
        </div>
        {/* Below the md breakpoint the coach sits under the scorecard instead of beside it, so the score stays reachable on a phone. */}
        <aside
          style={{ "--chat-width": `${chatWidth}px` } as CSSProperties}
          className="flex h-[42dvh] min-h-0 shrink-0 flex-col border-t border-border md:h-auto md:w-[var(--chat-width)] md:border-l md:border-t-0"
        >
          {coach.state === "error" ? (
            <Banner tone="bad" role="alert">
              <WarnIcon size={16} />
              <span>{coach.error ?? "The coach could not answer."} Send your message again.</span>
            </Banner>
          ) : null}
          <div className="min-h-0 flex-1">
            <ChatPanel
              heading="Coach"
              speaker="Coach"
              items={ctl.chat.coach}
              agent={coach}
              disabled={!debriefed || !connected}
              inputLabel="Message to the coach"
              placeholder={debriefed ? "Ask the coach about a gap…" : "Waiting for the scorecard…"}
              empty={debriefed ? "The coach opens with a short summary and the first gap to work on." : "The coach joins when the scorecard is ready."}
              onSend={(text) => actions.sendChat("coach", text)}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: PublicSession["status"] }) {
  if (status === "debriefed") return <Badge tone="good">Debrief ready</Badge>;
  if (status === "failed") return <Badge tone="bad">Debrief failed</Badge>;
  return <Badge tone="accent">Debriefing</Badge>;
}

/**
 * What each gap has with the coach, from the session's records. A round saved before records existed has none,
 * so its coach chat is read for "Teach me this" messages instead.
 */
function useGapMarks(scorecard: Scorecard | null, session: PublicSession, coach: ChatItem[]): Map<string, GapMark> {
  return useMemo(() => {
    const texts = coach.filter((item) => item.role === "candidate").map((item) => item.text);
    return gapMarks(scorecard?.gaps ?? [], session.gapProgress, texts);
  }, [scorecard, session.gapProgress, coach]);
}

const MORE_LINKS = [
  { id: "timing", label: "Time" },
  { id: "steps", label: "Step by step" },
  { id: "dimensions", label: "Evidence" },
  { id: "scenarios", label: "Scenarios" },
  { id: "judge-saw", label: "What the judge saw" },
  { id: "reference", label: "Reference" },
] as const;

type StepState = "done" | "next" | "todo";

/**
 * The debrief is finished only when the gaps are taught and the notes are saved, so the three steps stay in view
 * with their state, and the first open one is marked as next.
 */
function StepsBar({ session, scorecard, notes, marks }: { session: PublicSession; scorecard: Scorecard; notes: NotesState; marks: ReadonlyMap<string, GapMark> }) {
  const gapCount = scorecard.gaps.length;
  const gapsDone = gapCount === 0 || marks.size >= gapCount;
  const saved = notes.result?.applied.length ?? session.studyNotes?.appliedCount ?? 0;
  const notesDone = saved > 0;
  const notesText = notesDone
    ? `Saved ${saved} ${saved === 1 ? "change" : "changes"}`
    : notes.drafting
      ? "Drafting…"
      : notes.proposal?.status === "stale"
        ? "Draft is out of date"
        : notes.proposal
          ? "Draft ready to review"
          : "Not drafted yet";
  const steps: { id: string; title: string; detail: string; state: StepState }[] = [
    { id: "verdict", title: "Read the score", detail: VERDICT_LABEL[scorecard.verdict.sde2], state: "done" },
    { id: "gaps", title: "Work the gaps", detail: gapCount === 0 ? "No gaps listed" : workedText(marks.size, gapCount), state: gapsDone ? "done" : "next" },
    { id: "notes", title: "Save study notes", detail: notesText, state: notesDone ? "done" : gapsDone ? "next" : "todo" },
  ];

  const available = new Set<string>(["dimensions", "judge-saw"]);
  if ((scorecard.phaseTiming?.length ?? 0) > 0 || scorecard.timeline.length > 0) available.add("timing");
  if ((scorecard.steps?.length ?? 0) > 0) available.add("steps");
  if (scorecard.lldScenarios.length > 0) available.add("scenarios");
  if (session.reference && session.reference.sections.length > 0) available.add("reference");

  return (
    <nav aria-label="Debrief steps" className="sticky top-0 z-10 border-b border-border/70 bg-card/85 shadow-xs backdrop-blur-xl backdrop-saturate-150">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 sm:px-6">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {steps.map((step, index) => (
            <li key={step.id} className="flex items-center gap-2">
              {index > 0 ? <span className="h-px w-5 bg-border-strong max-sm:hidden" aria-hidden="true" /> : null}
              <button
                type="button"
                onClick={() => jumpTo(step.id)}
                aria-current={step.state === "next" ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg border px-3 py-1.5 text-left transition-colors duration-150",
                  step.state === "next" ? "border-primary bg-primary-soft text-primary-soft-foreground" : "border-transparent hover:bg-accent",
                )}
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-meta font-bold",
                    step.state === "done"
                      ? "bg-success-fill text-success-soft"
                      : step.state === "next"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
                  )}
                  aria-hidden="true"
                >
                  {step.state === "done" ? <CheckIcon size={12} /> : index + 1}
                </span>
                <span className="flex flex-col">
                  <span className={cn("text-ui font-bold", step.state === "next" ? "text-primary-soft-foreground" : "text-foreground")}>{step.title}</span>
                  <span className={cn("text-meta max-sm:hidden", step.state === "next" ? "text-primary-soft-foreground" : "text-muted-foreground")}>
                    {step.detail}
                    {step.state === "done" ? <span className="sr-only">, done</span> : null}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
        <ul className="ml-auto flex flex-wrap gap-x-1 max-sm:hidden">
          {MORE_LINKS.filter((link) => available.has(link.id)).map((link) => (
            <li key={link.id}>
              <button
                type="button"
                onClick={() => jumpTo(link.id)}
                className="whitespace-nowrap rounded-md px-2 py-1 text-ui font-semibold text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
              >
                {link.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

/** The plan against the clock, worked out from the phase history while the judge is still busy. */
function WhileYouWait({ session }: { session: PublicSession }) {
  const roundMs = finalRoundMs(session);
  if (roundMs === null || session.phasePlan.length === 0) return null;
  const spent = phaseSpentMs(session.phaseHistory, session.phasePlan[0]?.id, session.phase, roundMs);
  const rows = session.phasePlan.map((phase) => ({
    phase: phase.id,
    label: phase.label,
    plannedMinutes: phase.minutes,
    actualMinutes: Math.round(((spent[phase.id] ?? 0) / 60_000) * 10) / 10,
  }));
  return (
    <section aria-labelledby="wait-timing-heading">
      <SectionTitle id="wait-timing-heading" aside="Your plan against what happened">
        Where the time went
      </SectionTitle>
      <TimingRows rows={rows} />
    </section>
  );
}

function ScorecardBody({
  ctl,
  session,
  scorecard,
  theme,
  boardImageUrl,
  marks,
}: {
  ctl: SessionController;
  session: PublicSession;
  scorecard: Scorecard;
  theme: Theme;
  boardImageUrl: string;
  marks: ReadonlyMap<string, GapMark>;
}) {
  const { state, actions } = ctl;
  const lld = session.track === "lld";
  const [practising, setPractising] = useState<string | null>(null);
  const [practiseError, setPractiseError] = useState<string | null>(null);
  const practise = (gap: Scorecard["gaps"][number]) => {
    setPractising(gap.title);
    setPractiseError(null);
    api.createSession({ problemId: session.problemId, mode: "guided", focus: { title: gap.title, goodLooksLike: gap.whatGoodLooksLike } }).then(
      ({ sessionId }) => navigate(`/session/${sessionId}`),
      (error: unknown) => {
        setPractising(null);
        setPractiseError(error instanceof ApiError && error.message ? error.message : "The practice round could not start.");
      },
    );
  };
  const lint = scorecard.lintIssues ?? [];

  return (
    <>
      <VerdictCard scorecard={scorecard} />
      {practiseError ? (
        <Banner tone="bad" role="alert">
          <WarnIcon size={16} />
          <span>{practiseError}</span>
        </Banner>
      ) : null}
      <GapsSection scorecard={scorecard} marks={marks} onTeach={(gap) => actions.sendChat("coach", teachMessage(gap))} practise={{ busy: practising, onStart: practise }} />
      <StudyNotes
        notes={state.notes}
        saved={session.studyNotes}
        enabled={session.status === "debriefed" && state.connection === "open"}
        onDraft={actions.draftNotes}
        onApply={actions.applyNotes}
      />
      <TimingSection scorecard={scorecard} />
      <RoundUsageCard sessionId={session.id} />
      <Steps
        scorecard={scorecard}
        track={session.track}
        steps={session.steps}
        pins={session.pins}
        elements={state.board?.elements ?? null}
        notes={session.stepNotes}
        summaries={session.stepSummaries}
      />
      <DimensionsTable scorecard={scorecard} />
      {lld ? <ScenarioTable scorecard={scorecard} /> : null}
      <JudgeSaw imageUrl={boardImageUrl} graphText={state.graph.text} code={state.code} lld={lld} theme={theme} track={session.track} answers={session.stepNotes} />
      {session.reference ? <ReferenceAnswer reference={session.reference} /> : null}

      {lint.length > 0 ? (
        <details className="text-meta text-faint">
          <summary className="w-fit rounded">Writing checks ({lint.length})</summary>
          <ul className="mt-1.5 list-inside list-disc space-y-0.5">
            {lint.map((issue, index) => (
              <li key={index}>
                {issue.field}: {issue.issue}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
