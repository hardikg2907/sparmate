import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Board } from "../board/Board";
import { CodeEditor } from "../code/CodeEditor";
import { Console } from "../code/Console";
import { ChatPanel } from "../components/ChatPanel";
import { ChatResizeHandle, useChatWidth } from "../components/ChatWidth";
import { ConfirmModal } from "../components/ConfirmModal";
import { DiscardNote } from "../components/DiscardNote";
import { GraphPanel } from "../components/GraphPanel";
import { EndInterviewButton } from "../components/EndInterviewButton";
import { ArrowLeftIcon, CheckIcon, CopyIcon, InfoIcon, PauseIcon, PlayIcon, SpinnerIcon, TrashIcon, WarnIcon } from "../components/icons";
import { ConnectionBanner, MessageBanners } from "../components/Notices";
import { OverflowMenu, type MenuItem } from "../components/OverflowMenu";
import { PlanTrack } from "../components/PlanTrack";
import { StepChecklist, StepNeeds } from "../components/StepChecklist";
import { StepVerdictNote } from "../components/StepVerdictNote";
import { Timer } from "../components/Timer";
import { Banner, Button, Badge, EmptyState, Tooltip, cn, toast } from "../components/ui";
import { phasesFor } from "../../shared/phases";
import { evidenceStepFor } from "../../shared/stepFrames";
import { isTimedRound, planDelta, type PlanDelta } from "../lib/plan";
import { revealFor } from "../lib/reveal";
import { phaseSpentMs } from "../lib/timing";
import { useRoundMs } from "../hooks/useClock";
import { useDelayed } from "../hooks/useDelayed";
import { MODE_LABEL, TRACK_LABEL, TRACK_TITLE, formatClock } from "../lib/format";
import { ERROR_PAUSE_TEXT, pauseText } from "../lib/pause";
import { Link, navigate } from "../router";
import type { SessionController } from "../session/types";
import type { PublicSession } from "../../shared/types";
import type { Theme } from "../theme";

type Tab = "code" | "diagram";

// The guided step actions sit just above the composer as small pills.
const CHIP = "h-7 rounded-full px-3 text-meta";

interface RoomViewProps {
  ctl: SessionController;
  session: PublicSession;
  theme: Theme;
  studyRoot: string | null;
}

export function RoomView({ ctl, session, theme, studyRoot }: RoomViewProps) {
  const { state, actions } = ctl;
  const guided = session.mode === "guided";
  const lld = session.track === "lld";
  const paused = session.status === "paused";
  // After time is up the round is frozen while the interviewer closes it; the debrief page takes over next.
  const ended = session.status === "ended";
  const agent = state.agent.interview;
  const [tab, setTab] = useState<Tab>(lld ? "code" : "diagram");
  const [graphOpen, setGraphOpen] = useState(false);
  // Which board view he last asked for; the board opens on the current step's frame.
  const [boardView, setBoardView] = useState<"step" | "board">("step");
  const [confirm, setConfirm] = useState<"end" | "leave" | "discard" | null>(null);
  const [reveal, setReveal] = useState<{ line: number; column: number; nonce: number } | null>(null);
  const [chatWidth, setChatWidth] = useChatWidth();

  const errored = agent.state === "error";
  // A model error offers Retry; every other pause is the user's to lift with Resume.
  const needsRetry = errored || (paused && session.pauseReason === "error");
  const chatLocked = errored || paused || ended;
  const connected = state.connection === "open";
  const speaker = guided ? "Guide" : "Interviewer";
  const leaveNeedsConfirm = session.status === "live" && !guided;

  const jumpTo = (line: number, column: number) => {
    setTab("code");
    setReveal({ line, column, nonce: (reveal?.nonce ?? 0) + 1 });
  };

  const frameStep = evidenceStepFor(session.track, session.phase);
  const boardShown = !lld || tab === "diagram";
  const currentPhase = phasesFor(session.track).find((p) => p.id === session.phase);
  const phaseLabel = currentPhase?.label ?? session.phase;
  const verdict = session.stepVerdicts?.[session.phase];
  // A passed step turns the check button into "Move on"; the last step has nowhere to go, so it stays a check.
  const nextStep = verdict?.verdict === "pass" ? session.phasePlan[session.phasePlan.findIndex((p) => p.id === session.phase) + 1] : undefined;

  // The class diagram mounts hidden behind the code, so its first view is fitted when the tab is first opened.
  const diagramFitted = useRef(false);
  useEffect(() => {
    if (!lld || tab !== "diagram" || diagramFitted.current) return;
    diagramFitted.current = ctl.boardRef.current?.showStep(frameStep, false) ?? false;
  }, [lld, tab, frameStep, ctl.boardRef]);

  // A step's answer lives in its frame, so a step coming onto the rail brings that frame into view. In a
  // machine-coding round a step with no frame is answered in the code, so the editor comes forward instead.
  const showPhase = (phase: string) => {
    const target = revealFor(session.track, phase);
    if (target.view === "code") {
      setTab("code");
      return;
    }
    if (lld) {
      diagramFitted.current = true;
      setTab("diagram");
    }
    setBoardView("step");
    ctl.boardRef.current?.showStep(target.step);
  };

  // The guide and the interviewer move the rail as well as a click, and the board already opens on the first step.
  const shownPhase = useRef(session.phase);
  useEffect(() => {
    if (shownPhase.current === session.phase) return;
    shownPhase.current = session.phase;
    showPhase(session.phase);
  }, [session.phase]);

  // A click moves the rail and the effect above reveals it; the step already on the rail has no move to react to.
  const selectPhase = (phase: string) => {
    if (phase === session.phase) showPhase(phase);
    else actions.setPhase(phase);
  };

  const errorCount = state.code?.diagnostics.filter((d) => d.severity === "error").length ?? 0;
  const warningCount = state.graph.warnings.length;

  const attemptPath = lld ? (session.code?.path ?? state.code?.path ?? null) : null;
  const copyAttemptPath = () => {
    if (!attemptPath) return;
    // The session keeps the path relative to the study folder, but the file endpoint can return an absolute one.
    const full = attemptPath.startsWith("/") || !studyRoot ? attemptPath : `${studyRoot.replace(/\/$/, "")}/${attemptPath}`;
    void navigator.clipboard?.writeText(full).then(
      () => toast.success("Path copied"),
      () => {},
    );
  };

  const pauseCover = needsRetry ? (
    <PauseCover
      tone="bad"
      title="Paused by an error"
      body={`${agent.error ?? ERROR_PAUSE_TEXT} The clock is stopped.`}
      action="Retry"
      connected={connected}
      onAction={actions.resume}
    />
  ) : paused ? (
    <PauseCover tone="warn" session={session} offsetMs={state.clockOffsetMs} action="Resume" connected={connected} onAction={actions.resume} />
  ) : null;

  return (
    <div className="room-canvas flex h-full min-h-0 flex-col overflow-hidden">
      <RoomHeader
        session={session}
        offsetMs={state.clockOffsetMs}
        connected={connected}
        frozen={ended}
        onLeave={() => (leaveNeedsConfirm ? setConfirm("leave") : navigate("/"))}
        onEnd={() => setConfirm("end")}
        onEndNow={actions.end}
        onDiscard={() => setConfirm("discard")}
        onCopyPath={attemptPath ? copyAttemptPath : undefined}
        onPause={actions.pause}
        onResume={actions.resume}
        onSelectPhase={selectPhase}
      />

      <ConnectionBanner status={state.connection} onRetry={actions.reconnect} />
      {ended ? <EndedBanner connected={connected} onStart={actions.retryDebrief} /> : null}
      <MessageBanners state={state} actions={actions} />

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" tabIndex={-1} inert={pauseCover !== null} aria-hidden={pauseCover !== null}>
          <div className="room-toolbar flex min-h-9 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 max-md:py-1.5 md:h-9 md:flex-nowrap">
            <PhaseGoal session={session} />
            <div className="flex shrink-0 items-center gap-2">
              {lld ? <WorkTabs tab={tab} onChange={setTab} errorCount={errorCount} /> : null}
              {boardShown ? (
                <BoardViews
                  view={boardView}
                  canShowStep={frameStep !== null}
                  stepLabel={phaseLabel}
                  graphOpen={graphOpen}
                  warningCount={warningCount}
                  onStep={() => {
                    setBoardView("step");
                    ctl.boardRef.current?.showStep(frameStep);
                  }}
                  onWhole={() => {
                    setBoardView("board");
                    ctl.boardRef.current?.showStep(null);
                  }}
                  onGraph={() => setGraphOpen((open) => !open)}
                />
              ) : null}
              {lld && tab === "code" ? (
                <Button
                  size="sm"
                  className="h-7 min-w-20"
                  onClick={() => {
                    if (!state.code?.running) actions.runCode();
                  }}
                  disabled={!connected || ended || !state.code}
                  aria-disabled={state.code?.running || undefined}
                  title="Compile and run"
                >
                  {state.code?.running ? (
                    <>
                      <SpinnerIcon size={12} />
                      Running…
                    </>
                  ) : (
                    <>
                      <PlayIcon size={12} />
                      Run
                    </>
                  )}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="relative min-h-0 min-w-0 flex-1 bg-background overflow-hidden">
              <Pane active={!lld || tab === "diagram"} id="pane-diagram" labelledBy={lld ? "tab-diagram" : undefined}>
                {state.board ? (
                  <Board
                    ref={ctl.boardRef}
                    sessionId={session.id}
                    initialElements={state.board.elements}
                    initialVersion={state.board.version}
                    track={session.track}
                    theme={theme}
                    readOnly={ended}
                    pins={session.pins}
                    initialStep={frameStep}
                    onSceneChange={actions.onBoardChange}
                  />
                ) : (
                  <LoadFailed what="board" onReload={ctl.reload} />
                )}
              </Pane>

              {lld ? (
                <Pane active={tab === "code"} id="pane-code" labelledBy="tab-code" column>
                  {state.code ? (
                    <>
                      <div className="relative min-h-0 flex-1">
                        <div className="absolute inset-0 [&>*]:h-full [&>*]:w-full">
                          <CodeEditor
                            value={state.code.content}
                            version={state.code.version}
                            diagnostics={state.code.diagnostics}
                            theme={theme}
                            readOnly={ended}
                            onChange={actions.editCode}
                            revealLine={reveal}
                          />
                        </div>
                      </div>
                      <div className="room-console h-56 shrink-0 overflow-hidden [&>*]:h-full">
                        <Console
                          lastRun={state.code.lastRun}
                          running={state.code.running}
                          onRun={actions.runCode}
                          onJumpTo={jumpTo}
                          disabled={!connected || ended}
                          showRun={false}
                        />
                      </div>
                    </>
                  ) : (
                    <LoadFailed what="code file" onReload={ctl.reload} />
                  )}
                </Pane>
              ) : null}

              {/* It floats over the work area: shrinking the board below about 500 px tall flips Excalidraw into its phone layout. */}
              {graphOpen ? <GraphPanel graph={state.graph} actions={actions} onClose={() => setGraphOpen(false)} /> : null}
            </div>
          </div>
        </main>

        <ChatResizeHandle width={chatWidth} onChange={setChatWidth} />
        <aside
          style={{ "--chat-w": `${chatWidth}px` } as CSSProperties}
          className="room-side flex min-h-0 shrink-0 flex-col overflow-hidden max-md:h-[68%] max-md:w-full md:w-(--chat-w)"
          inert={pauseCover !== null}
          aria-hidden={pauseCover !== null}
        >
          {guided ? <StepVerdictNote stepLabel={phaseLabel} verdict={verdict} className="shrink-0" /> : null}
          <div className="min-h-0 flex-1">
            <ChatPanel
              heading={speaker}
              speaker={speaker}
              items={ctl.chat.interview}
              agent={agent}
              showTimes
              disabled={chatLocked}
              inputLabel={`Message to the ${speaker.toLowerCase()}`}
              placeholder={
                ended
                  ? "The round is over."
                  : needsRetry
                    ? "Retry to continue the round."
                    : chatLocked
                      ? "Resume to continue the round."
                      : guided
                        ? "Reply to the guide…"
                        : "Reply to the interviewer…"
              }
              empty={guided ? "The guide starts with the first step in a moment." : "The interviewer opens the conversation in a moment."}
              onSend={(text) => actions.sendChat("interview", text)}
              topSlot={!lld ? <StepChecklist step={session.steps[session.phase]} /> : null}
              afterOpening={lld && currentPhase ? <StepNeeds label={currentPhase.label} goal={currentPhase.goal} step={session.steps[session.phase]} /> : null}
              tools={
                guided ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className={CHIP}
                      onClick={nextStep ? () => actions.setPhase(nextStep.id) : actions.guidedFeedback}
                      disabled={agent.state === "thinking" || chatLocked || !connected}
                    >
                      <CheckIcon size={13} className="text-primary-text" />
                      {nextStep ? "Move on" : "Check this step"}
                    </Button>
                    <Button size="sm" variant="outline" className={CHIP} onClick={actions.guidedHint} disabled={agent.state === "thinking" || chatLocked || !connected}>
                      Hint
                    </Button>
                    <Button size="sm" variant="outline" className={CHIP} onClick={actions.guidedStuck} disabled={agent.state === "thinking" || chatLocked || !connected}>
                      I&apos;m stuck
                    </Button>
                    {session.hints.length > 0 ? (
                      <span className="ml-auto text-meta text-muted-foreground">
                        {session.hints.length} {session.hints.length === 1 ? "hint" : "hints"} used
                      </span>
                    ) : null}
                  </>
                ) : null
              }
            />
          </div>
        </aside>

        {pauseCover}
      </div>

      {confirm === "end" ? (
        <ConfirmModal
          title="End the interview now?"
          confirmLabel="End interview"
          cancelLabel="Keep going"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            actions.end();
          }}
        >
          <p>This ends the round and runs the scored debrief. You cannot return to the round after this.</p>
        </ConfirmModal>
      ) : null}
      {confirm === "discard" ? (
        <ConfirmModal
          title="Discard this round?"
          confirmLabel="Discard round"
          cancelLabel="Keep the round"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            actions.discard();
          }}
        >
          <DiscardNote track={session.track} />
        </ConfirmModal>
      ) : null}
      {confirm === "leave" ? (
        <ConfirmModal
          title="Leave the room?"
          confirmLabel="Leave"
          cancelLabel="Stay"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            navigate("/");
          }}
        >
          <p>The round pauses about a minute after you leave. Open it from the history list and press Resume to carry on.</p>
        </ConfirmModal>
      ) : null}
    </div>
  );
}

/**
 * The top bar: title, plan track, pace, clock and the round's actions. The plan track and the clock are the only
 * parts that follow the time, so the timer ticking every quarter second re-renders this and nothing else on the page.
 */
function RoomHeader({
  session,
  offsetMs,
  connected,
  frozen,
  onLeave,
  onEnd,
  onEndNow,
  onDiscard,
  onCopyPath,
  onPause,
  onResume,
  onSelectPhase,
}: {
  session: PublicSession;
  offsetMs: number;
  connected: boolean;
  /** The round is over: nothing in the header can change it any more. */
  frozen: boolean;
  onLeave: () => void;
  onEnd: () => void;
  onEndNow: () => void;
  onDiscard: () => void;
  onCopyPath?: () => void;
  onPause: () => void;
  onResume: () => void;
  onSelectPhase: (phase: string) => void;
}) {
  const roundMs = useRoundMs(session, offsetMs);
  const paused = session.status === "paused";
  const guided = session.mode === "guided";
  const spent = phaseSpentMs(session.phaseHistory, session.phasePlan[0]?.id, session.phase, roundMs);
  const delta = frozen ? null : planDelta(session.phasePlan, session.phase, roundMs, isTimedRound(session));
  const passed = new Set(
    Object.entries(session.stepVerdicts ?? {})
      .filter(([, v]) => v.verdict === "pass")
      .map(([id]) => id),
  );
  const menu: MenuItem[] = [];
  if (onCopyPath) menu.push({ label: "Copy path", icon: <CopyIcon size={14} />, onSelect: onCopyPath });
  menu.push({ label: "Discard round", icon: <TrashIcon size={14} />, danger: true, disabled: !connected, onSelect: onDiscard });

  return (
    <header className="room-header shrink-0">
      <div className="room-header__bar header-hairline flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-1 px-3 max-md:py-1.5 md:h-[52px] md:flex-nowrap">
        <Tooltip content="Back to home">
          <Link
            href="/"
            aria-label="Back to home"
            onClick={(event) => {
              event.preventDefault();
              onLeave();
            }}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeftIcon size={16} />
          </Link>
        </Tooltip>
        <h1 className="min-w-0 truncate text-lead font-bold tracking-tight max-md:flex-1 md:max-w-[20ch] lg:max-w-[28ch]" title={session.title}>
          {session.title}
        </h1>
        <span className="room-chip tint shrink-0 max-md:hidden" data-mode={session.mode} title={TRACK_TITLE[session.track]}>
          {TRACK_LABEL[session.track]} {MODE_LABEL[session.mode].toLowerCase()}
        </span>
        <div className="flex min-w-0 items-center gap-3 max-md:order-5 max-md:basis-full md:flex-1">
          <PlanTrack
            plan={session.phasePlan}
            track={session.track}
            currentPhase={session.phase}
            spent={spent}
            roundMs={roundMs}
            passed={guided ? passed : undefined}
            onSelect={onSelectPhase}
            disabled={frozen}
          />
          {guided ? (
            <span className="shrink-0 text-meta text-muted-foreground max-lg:hidden" aria-live="polite" title={`${passed.size} of ${session.phasePlan.length} steps passed`}>
              <span className="font-semibold tabular-nums text-foreground">
                {passed.size}/{session.phasePlan.length}
              </span>{" "}
              passed
            </span>
          ) : null}
          {delta ? <DeltaChip delta={delta} /> : null}
        </div>
        <div className="max-md:order-3">
          <Timer mode={session.mode} roundMs={roundMs} durationMs={session.clock.durationMs} status={session.status} />
        </div>
        <div className="flex shrink-0 items-center gap-1 max-md:order-6 max-md:basis-full max-md:justify-between">
          <Tooltip content={paused ? "Resume the round" : "Pause the clock"}>
            <Button variant={paused ? "default" : "outline"} size="sm" onClick={paused ? onResume : onPause} disabled={!connected || frozen}>
              {paused ? <PlayIcon size={13} /> : <PauseIcon size={13} />}
              {paused ? "Resume" : "Pause"}
            </Button>
          </Tooltip>
          <EndInterviewButton onConfirm={onEnd} onHoldEnd={onEndNow} disabled={frozen} />
        </div>
        <div className="max-md:order-4">
          <OverflowMenu label="More round actions" disabled={frozen} items={menu} />
        </div>
      </div>
    </header>
  );
}

/**
 * Says how the round stands against its plan: the time past the planned end of the phase he is in, or a quiet
 * "On plan". Turning behind lights it once with a single soft ring.
 */
function DeltaChip({ delta }: { delta: PlanDelta }) {
  const behind = delta.kind === "behind";
  const wasBehind = useRef(behind);
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (behind && !wasBehind.current) setPulse(true);
    if (!behind) setPulse(false);
    wasBehind.current = behind;
  }, [behind]);
  return (
    <span
      className={cn("delta-chip flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-meta font-semibold", behind ? "tint bg-warning-soft text-warning" : "text-faint")}
      data-pulse={pulse || undefined}
      onAnimationEnd={() => setPulse(false)}
      title={behind ? "Time past the planned end of the phase you are in" : "Within the planned time for the phase you are in"}
    >
      {behind ? (
        <>
          <span aria-hidden="true" className="status-dot size-1.5 shrink-0 rounded-full bg-warning-fill text-warning-fill" />
          <span className="font-mono tabular-nums">{formatClock(delta.ms)}</span> behind plan
        </>
      ) : (
        "On plan"
      )}
    </span>
  );
}

/** What the current phase must produce, in the candidate's own method, so the next step never has to be recalled. */
function PhaseGoal({ session }: { session: PublicSession }) {
  const phase = phasesFor(session.track).find((p) => p.id === session.phase);
  if (!phase) return <span className="min-w-0 flex-1" />;
  return (
    <p className="min-w-0 flex-1 truncate text-ui max-md:basis-full" title={`${phase.label}: ${phase.goal}`}>
      <span className="font-semibold text-foreground">{phase.label}.</span> <span className="text-muted-foreground">{phase.goal}.</span>
    </p>
  );
}

/** The board's views as one switch: this step's frame, the whole board, and the board as the interviewer reads it. */
function BoardViews({
  view,
  canShowStep,
  stepLabel,
  graphOpen,
  warningCount,
  onStep,
  onWhole,
  onGraph,
}: {
  view: "step" | "board";
  canShowStep: boolean;
  stepLabel: string;
  graphOpen: boolean;
  warningCount: number;
  onStep: () => void;
  onWhole: () => void;
  onGraph: () => void;
}) {
  return (
    <div role="group" aria-label="Board view" className="seg flex h-7 items-center">
      <Tooltip content={`Bring the ${stepLabel} frame into view`}>
        <button
          type="button"
          className="seg__item"
          data-active={(view === "step" && !graphOpen) || undefined}
          aria-pressed={view === "step" && !graphOpen}
          disabled={!canShowStep}
          onClick={onStep}
        >
          This step
        </button>
      </Tooltip>
      <Tooltip content="Zoom out to every step's frame">
        <button type="button" className="seg__item" data-active={(view === "board" && !graphOpen) || undefined} aria-pressed={view === "board" && !graphOpen} onClick={onWhole}>
          Whole board
        </button>
      </Tooltip>
      <Tooltip
        content={
          <>
            {graphOpen ? "Hide" : "Show"} the board as the interviewer reads it.
            {warningCount > 0 ? ` ${warningCount} ${warningCount === 1 ? "problem" : "problems"} in how the board reads.` : null}
          </>
        }
      >
        <button type="button" className="seg__item flex items-center gap-1.5" data-active={graphOpen || undefined} aria-pressed={graphOpen} onClick={onGraph}>
          Interviewer&apos;s view
          {warningCount > 0 ? (
            <span className="tint rounded-full bg-warning-soft px-1.5 font-mono text-meta leading-4 text-warning">
              <span aria-hidden="true">{warningCount}</span>
              <span className="sr-only">
                , {warningCount} {warningCount === 1 ? "warning" : "warnings"}
              </span>
            </span>
          ) : null}
        </button>
      </Tooltip>
    </div>
  );
}

/**
 * A pause covers the work as well as stopping the clock, so a timed round stays honest, and the one way
 * forward is a single large button. The top bar stays live, so Resume is there as well.
 */
function PauseCover({
  tone,
  title,
  body,
  session,
  offsetMs,
  action,
  connected,
  onAction,
}: {
  tone: "warn" | "bad";
  title?: string;
  body?: string;
  session?: PublicSession;
  offsetMs?: number;
  action: string;
  connected: boolean;
  onAction: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const focused = useRef(false);
  useEffect(() => {
    // Focus inside the hidden work area is lost when it turns inert, so it moves to the only control left.
    // The button is disabled until the socket is up, so the move waits for the connection.
    if (focused.current || !connected) return;
    if (document.activeElement?.closest("[role=dialog], [role=alertdialog]")) return;
    focused.current = true;
    button.current?.focus();
  }, [connected]);
  return (
    // The board under the cover is inert and still while paused, so the blur costs nothing while he works.
    <div className="pause-cover absolute inset-0 z-40 flex items-center justify-center p-6 animate-in fade-in-0 duration-300">
      <div
        role={tone === "bad" ? "alert" : "status"}
        className={cn(
          "flex w-full max-w-md flex-col items-center gap-3 text-center animate-in fade-in-0 zoom-in-[0.95] duration-[260ms] ease-out-quick",
          tone === "bad" && "rounded-xl border border-border bg-card bg-linear-to-b from-raised to-card to-40% px-8 py-8 surface-float",
        )}
      >
        {tone === "bad" ? (
          <>
            <span className="tint flex size-12 items-center justify-center rounded-full bg-destructive-soft text-destructive" aria-hidden="true">
              <WarnIcon size={22} />
            </span>
            <h2 className="text-title font-bold">{title}</h2>
            <p className="text-body text-muted-foreground">{body}</p>
          </>
        ) : (
          <h2 className="sr-only">Paused</h2>
        )}
        <Button
          ref={button}
          id="pause-action"
          variant="default"
          size="lg"
          className={cn("min-w-40", tone === "warn" ? "h-16 min-w-56 rounded-xl text-lead" : "mt-2")}
          onClick={onAction}
          disabled={!connected}
        >
          {tone === "bad" ? null : <PlayIcon size={20} />}
          {action}
        </Button>
        {tone === "warn" && session ? <PausedAt session={session} offsetMs={offsetMs ?? 0} /> : null}
        {!connected ? <p className="text-ui text-muted-foreground">Waiting for the connection to come back.</p> : null}
      </div>
    </div>
  );
}

/** Says when the clock stopped, from the same round time as the timer; it is still while paused, so nothing ticks here. */
function PausedAt({ session, offsetMs }: { session: PublicSession; offsetMs: number }) {
  const roundMs = useRoundMs(session, offsetMs);
  const away = session.pauseReason === "away" || session.pauseReason === "restart";
  return (
    <p className="text-body font-medium text-foreground">
      {away ? `${pauseText(session.pauseReason)} ` : null}You paused <span className="font-mono tabular-nums">{formatClock(roundMs)}</span> into the round. The clock is stopped.
    </p>
  );
}

/**
 * Both work panes stay mounted: Excalidraw and Monaco lose their state and take seconds to start,
 * so the hidden one is only made invisible and inert.
 */
function Pane({ active, id, labelledBy, column, children }: { active: boolean; id: string; labelledBy?: string; column?: boolean; children: ReactNode }) {
  return (
    <div
      id={id}
      role={labelledBy ? "tabpanel" : undefined}
      aria-labelledby={labelledBy}
      inert={!active}
      aria-hidden={!active}
      className={cn("absolute inset-0", column ? "flex flex-col" : "[&>*]:h-full [&>*]:w-full", !active && "pane-hidden")}
    >
      {children}
    </div>
  );
}

function WorkTabs({ tab, onChange, errorCount }: { tab: Tab; onChange: (tab: Tab) => void; errorCount: number }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "code", label: "Code" },
    { id: "diagram", label: "Class diagram" },
  ];
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next: Tab = event.key === "ArrowRight" || event.key === "End" ? "diagram" : "code";
    onChange(next);
    document.getElementById(`tab-${next}`)?.focus();
  };
  return (
    <div role="tablist" aria-label="Work area" onKeyDown={onKeyDown} className="seg flex h-7 items-center">
      {tabs.map((item) => (
        <button
          key={item.id}
          id={`tab-${item.id}`}
          type="button"
          role="tab"
          aria-selected={tab === item.id}
          aria-controls={`pane-${item.id}`}
          tabIndex={tab === item.id ? 0 : -1}
          onClick={() => onChange(item.id)}
          title={item.id === "code" ? "Edits in your editor appear here. Ctrl+Shift+M lets Tab leave the editor." : undefined}
          className="seg__item flex items-center gap-2"
          data-active={tab === item.id || undefined}
        >
          {item.label}
          {item.id === "code" && errorCount > 0 ? <Badge tone="bad">{errorCount === 1 ? "1 error" : `${errorCount} errors`}</Badge> : null}
        </button>
      ))}
    </div>
  );
}

function EndedBanner({ connected, onStart }: { connected: boolean; onStart: () => void }) {
  // The debrief normally starts within seconds. If it has not, offer the same retry a failed debrief gets.
  const waitedLong = useDelayed(true, 20_000);
  return (
    <Banner
      tone="info"
      actions={
        waitedLong ? (
          <Button size="sm" variant="default" onClick={onStart} disabled={!connected}>
            Start the debrief
          </Button>
        ) : null
      }
    >
      <InfoIcon size={16} />
      <span>The round is over. The debrief starts next.</span>
    </Banner>
  );
}

function LoadFailed({ what, onReload }: { what: string; onReload: () => void }) {
  // The pane stretches its direct child to full size, so the wrapper stops the empty state from filling the pane.
  return (
    <div className="flex h-full items-center justify-center p-8">
      <EmptyState className="w-full max-w-sm" icon={<WarnIcon size={18} />} title={`The ${what} could not be loaded.`} action={<Button onClick={onReload}>Try again</Button>} />
    </div>
  );
}
