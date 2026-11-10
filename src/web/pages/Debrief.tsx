import { useMemo, useState, type CSSProperties } from "react";
import { ApiError, api } from "../backend";
import type { PublicSession, Scorecard } from "../../shared/types";
import { ChatPanel } from "../components/ChatPanel";
import { ChatResizeHandle, useChatWidth } from "../components/ChatWidth";
import { DebriefFailed, DebriefProgress } from "../components/debrief/Progress";
import { Details, type DetailTab, type EvidenceView } from "../components/debrief/Details";
import { GapsSection } from "../components/debrief/Gaps";
import { GapProgressLine, NextStep } from "../components/debrief/NextStep";
import { StudyNotes } from "../components/debrief/StudyNotes";
import { SummaryCard } from "../components/debrief/Summary";
import { TimingRows } from "../components/debrief/Timing";
import { ScoreRow, VerdictCard, jumpTo } from "../components/debrief/Verdict";
import { sortedGaps } from "../components/debrief/Gaps";
import { ArrowLeftIcon, WarnIcon } from "../components/icons";
import { ConnectionBanner, MessageBanners } from "../components/Notices";
import { Banner, Badge, Card, SectionTitle } from "../components/ui";
import { currentGap, gapCounts, gapMarks, gapState, type GapMark } from "../lib/gapMarks";
import { nextAction } from "../lib/debriefNext";
import { gapDividerText, teachMessage } from "../../shared/gaps";
import { MODE_LABEL, TRACK_LABEL, TRACK_TITLE, formatClock, formatDate } from "../lib/format";
import { finalRoundMs, phaseSpentMs } from "../lib/timing";
import { scrollToInScroller } from "../lib/scrollInScroller";
import { Link, navigate } from "../router";
import type { ChatItem, SessionController } from "../session/types";
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
    <div className="fade-in flex h-full min-h-0 flex-col overflow-clip">
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
        {session.status === "debriefed" ? null : (
          <span className="ml-auto">
            <StatusChip status={session.status} />
          </span>
        )}
      </header>

      <ConnectionBanner status={state.connection} onRetry={actions.reconnect} />
      <MessageBanners state={state} actions={actions} />

      <div className="flex min-h-0 flex-1 flex-col overflow-clip md:flex-row">
        <main className="page-canvas relative min-w-0 flex-1 overflow-y-auto" tabIndex={-1}>
          <div className="reveal-children mx-auto max-w-4xl space-y-6 px-4 pb-20 pt-6 sm:px-8">
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
  if (status === "debriefed") return null;
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

/**
 * Brings the coach chat to the divider where the gap began, or to the chat itself when the round has no divider.
 * The gap's newest divider is often already on screen at the foot of the chat, so scrolling alone shows no change.
 * The divider flashes to show which lesson is meant, and the cursor lands in the coach's box, ready for an answer.
 */
function showGapInChat(title: string): void {
  const text = gapDividerText(title);
  const coach = document.querySelector<HTMLElement>('section[aria-label="Coach"]');
  const dividers = [...document.querySelectorAll<HTMLElement>("[data-gap-divider]")].filter((el) => el.dataset.gapDivider === text);
  const divider = dividers.at(-1);
  scrollToInScroller(divider ?? coach, { behavior: "smooth", block: divider ? "nearest" : "start" });
  if (divider) {
    divider.classList.remove("chat-flash");
    void divider.offsetWidth;
    divider.classList.add("chat-flash");
  }
  coach?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
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
  const [tab, setTab] = useState<DetailTab>("evidence");
  const [view, setView] = useState<EvidenceView>("step");
  const [practising, setPractising] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const start = (body: Parameters<typeof api.createSession>[0], fallback: string, onFail: () => void) => {
    setStartError(null);
    api.createSession(body).then(
      ({ sessionId }) => navigate(`/session/${sessionId}`),
      (error: unknown) => {
        onFail();
        setStartError(error instanceof ApiError && error.message ? error.message : fallback);
      },
    );
  };
  const practise = (gap: Scorecard["gaps"][number]) => {
    setPractising(gap.title);
    start({ problemId: session.problemId, mode: "guided", focus: { title: gap.title, goodLooksLike: gap.whatGoodLooksLike } }, "The practice round could not start.", () =>
      setPractising(null),
    );
  };
  const tryInterview = () => {
    setStarting(true);
    start({ problemId: session.problemId, mode: "interview" }, "The interview could not be started.", () => setStarting(false));
  };

  const gaps = sortedGaps(scorecard);
  const current = currentGap(gaps, marks);
  const counts = gapCounts(gaps, marks);
  const notesSaved = (state.notes.result?.applied.length ?? session.studyNotes?.appliedCount ?? 0) > 0;
  const next = nextAction({ gaps, marks, notesSaved, mode: session.mode, readiness: scorecard.readiness?.call ?? null });
  const teach = (gap: Scorecard["gaps"][number]) => actions.sendChat("coach", teachMessage(gap));
  const act = () => {
    if (next.kind === "answer_coach") showGapInChat(next.gap.title);
    else if (next.kind === "start_gap") teach(next.gap);
    else if (next.kind === "draft_notes") jumpTo("notes");
    else if (next.kind === "try_interview") tryInterview();
    else if (next.kind === "practise_gap") practise(next.gap);
  };
  const openEvidence = (dimensionId: string) => {
    setTab("evidence");
    setView("score");
    // The tab content mounts on the next render, so the target is looked up one frame later.
    requestAnimationFrame(() => requestAnimationFrame(() => jumpTo(`dim-${dimensionId}`)));
  };
  const canSend = session.status === "debriefed" && state.connection === "open";

  return (
    <>
      <VerdictCard scorecard={scorecard} />
      <ScoreRow scorecard={scorecard} onEvidence={openEvidence} />
      <div className="space-y-2">
        <NextStep next={next} busy={practising !== null || starting} canSend={canSend} onAct={act} />
        <GapProgressLine counts={counts} states={gaps.map((gap) => gapState(marks.get(gap.title)))} />
      </div>
      {startError ? (
        <Banner tone="bad" role="alert">
          <WarnIcon size={16} />
          <span>{startError}</span>
        </Banner>
      ) : null}
      <GapsSection
        scorecard={scorecard}
        marks={marks}
        current={current}
        onTeach={teach}
        onContinue={(gap) => showGapInChat(gap.title)}
        practise={{ busy: practising, onStart: practise }}
        canSend={canSend}
      />
      <StudyNotes
        notes={state.notes}
        saved={session.studyNotes}
        enabled={session.status === "debriefed" && state.connection === "open"}
        onDraft={actions.draftNotes}
        onApply={actions.applyNotes}
      />
      <SummaryCard scorecard={scorecard} />
      <Details
        tab={tab}
        onTab={setTab}
        view={view}
        onView={setView}
        session={session}
        scorecard={scorecard}
        board={state.board?.elements ?? null}
        graphText={state.graph.text}
        code={state.code}
        theme={theme}
        boardImageUrl={boardImageUrl}
      />
    </>
  );
}
