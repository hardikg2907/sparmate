import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Board } from "../board/Board";
import { CodeEditor } from "../code/CodeEditor";
import { Console } from "../code/Console";
import { ChatPanel } from "../components/ChatPanel";
import { ChatResizeHandle, useChatWidth } from "../components/ChatWidth";
import { ConfirmModal } from "../components/ConfirmModal";
import { DiscardNote } from "../components/DiscardNote";
import { GraphPanel } from "../components/GraphPanel";
import { ArrowLeftIcon, CheckIcon, CopyIcon, EyeIcon, InfoIcon, PauseIcon, PlayIcon, ScanIcon, TrashIcon, WarnIcon } from "../components/icons";
import { ConnectionBanner, MessageBanners } from "../components/Notices";
import { OverflowMenu } from "../components/OverflowMenu";
import { PlanTrack } from "../components/PlanTrack";
import { StepVerdictNote } from "../components/StepVerdictNote";
import { Timer } from "../components/Timer";
import { Banner, Button, Badge, EmptyState, Tooltip, cn, toast } from "../components/ui";
import { OVERLAY_SURFACE } from "../components/ui/layer";
import { phasesFor } from "../../shared/phases";
import { evidenceStepFor } from "../../shared/stepFrames";
import { behindPlanMs } from "../lib/plan";
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
  const phaseLabel = phasesFor(session.track).find((p) => p.id === session.phase)?.label ?? session.phase;
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
    <PauseCover tone="warn" title="Paused" body={pauseBody(session.pauseReason)} action="Resume" connected={connected} onAction={actions.resume} />
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
        onDiscard={() => setConfirm("discard")}
        onPause={actions.pause}
        onResume={actions.resume}
        onSelectPhase={selectPhase}
      />

      <ConnectionBanner status={state.connection} onRetry={actions.reconnect} />
      {ended ? <EndedBanner connected={connected} onStart={actions.retryDebrief} /> : null}
      <MessageBanners state={state} actions={actions} />

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" tabIndex={-1} inert={pauseCover !== null} aria-hidden={pauseCover !== null}>
          <div className="room-toolbar flex h-11 shrink-0 items-center justify-between gap-2 px-3">
            {lld ? <WorkTabs tab={tab} onChange={setTab} errorCount={errorCount} /> : null}
            <PhaseGoal session={session} />
            {boardShown ? (
              <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Board view">
                {frameStep ? (
                  <Tooltip content={`Bring the ${phaseLabel} frame into view`}>
                    <Button size="sm" variant="outline" onClick={() => ctl.boardRef.current?.showStep(frameStep)}>
                      Show this step
                    </Button>
                  </Tooltip>
                ) : null}
                <Tooltip content="Zoom out to every step's frame">
                  <Button size="sm" variant="outline" onClick={() => ctl.boardRef.current?.showStep(null)}>
                    <ScanIcon size={14} />
                    Whole board
                  </Button>
                </Tooltip>
              </div>
            ) : null}
            <Tooltip
              content={
                <>
                  {graphOpen ? "Hide" : "Show"} the board as the interviewer reads it.
                  {warningCount > 0 ? ` ${warningCount} ${warningCount === 1 ? "problem" : "problems"} in how the board reads.` : null}
                </>
              }
            >
              <Button
                size="sm"
                variant="outline"
                className={cn(graphOpen && "tint border-transparent bg-primary-soft text-primary-soft-foreground hover:border-transparent hover:bg-primary-soft")}
                aria-pressed={graphOpen}
                onClick={() => setGraphOpen((open) => !open)}
              >
                <EyeIcon size={14} />
                What the interviewer sees
                {warningCount > 0 ? (
                  <span className="tint ml-0.5 rounded-full bg-warning-soft px-1.5 font-mono text-meta text-warning">
                    <span aria-hidden="true">{warningCount}</span>
                    <span className="sr-only">
                      , {warningCount} {warningCount === 1 ? "warning" : "warnings"}
                    </span>
                  </span>
                ) : null}
              </Button>
            </Tooltip>
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
                      <AttemptPath path={session.code?.path ?? state.code.path} studyRoot={studyRoot} />
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
                        <Console lastRun={state.code.lastRun} running={state.code.running} onRun={actions.runCode} onJumpTo={jumpTo} disabled={!connected || ended} />
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
        <aside style={{ width: chatWidth }} className="room-side flex min-h-0 shrink-0 flex-col overflow-hidden" inert={pauseCover !== null} aria-hidden={pauseCover !== null}>
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
              tools={
                guided ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={nextStep ? () => actions.setPhase(nextStep.id) : actions.guidedFeedback}
                      disabled={agent.state === "thinking" || chatLocked || !connected}
                    >
                      <CheckIcon size={14} className="text-primary-text" />
                      {nextStep ? "Move on" : "Check this step"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={actions.guidedHint} disabled={agent.state === "thinking" || chatLocked || !connected}>
                      Hint
                    </Button>
                    <Button size="sm" variant="outline" onClick={actions.guidedStuck} disabled={agent.state === "thinking" || chatLocked || !connected}>
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
 * The title row and the plan track. They are the only parts that follow the clock, so the timer ticking
 * every quarter second re-renders this and nothing else on the page.
 */
function RoomHeader({
  session,
  offsetMs,
  connected,
  frozen,
  onLeave,
  onEnd,
  onDiscard,
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
  onDiscard: () => void;
  onPause: () => void;
  onResume: () => void;
  onSelectPhase: (phase: string) => void;
}) {
  const roundMs = useRoundMs(session, offsetMs);
  const paused = session.status === "paused";
  const guided = session.mode === "guided";
  const spent = phaseSpentMs(session.phaseHistory, session.phasePlan[0]?.id, session.phase, roundMs);
  const behind = guided || frozen ? 0 : behindPlanMs(session.phasePlan, session.phase, roundMs);
  const passed = new Set(
    Object.entries(session.stepVerdicts ?? {})
      .filter(([, v]) => v.verdict === "pass")
      .map(([id]) => id),
  );

  return (
    <header className="room-header shrink-0">
      <div className="room-header__bar header-hairline flex h-14 items-center gap-3 px-3">
        <Tooltip content="Back to home">
          <Link
            href="/"
            aria-label="Back to home"
            onClick={(event) => {
              event.preventDefault();
              onLeave();
            }}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeftIcon size={16} />
          </Link>
        </Tooltip>
        <h1 className="min-w-0 truncate text-lead font-bold tracking-tight" title={session.title}>
          {session.title}
        </h1>
        <span className="room-chip tint shrink-0" data-mode={session.mode} title={TRACK_TITLE[session.track]}>
          {TRACK_LABEL[session.track]} {MODE_LABEL[session.mode].toLowerCase()}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {behind >= 30_000 ? <BehindPlan ms={behind} /> : null}
          <Timer mode={session.mode} roundMs={roundMs} durationMs={session.clock.durationMs} status={session.status} />
          <Tooltip content={paused ? "Resume the round" : "Pause the clock"}>
            <Button variant="ghost" onClick={paused ? onResume : onPause} disabled={!connected || frozen}>
              {paused ? <PlayIcon size={14} /> : <PauseIcon size={14} />}
              {paused ? "Resume" : "Pause"}
            </Button>
          </Tooltip>
          <Button variant="destructive-soft" onClick={onEnd} disabled={frozen}>
            End interview
          </Button>
          <OverflowMenu
            label="More round actions"
            disabled={frozen}
            items={[{ label: "Discard round", icon: <TrashIcon size={14} />, danger: true, disabled: !connected, onSelect: onDiscard }]}
          />
        </div>
      </div>
      <div className="px-3 py-2">
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
          <p className="mt-1.5 text-meta text-muted-foreground" aria-live="polite">
            <span className="font-semibold tabular-nums text-foreground">{passed.size}</span> of {session.phasePlan.length} steps passed
          </p>
        ) : null}
      </div>
    </header>
  );
}

/** Says how far the round has run past the plan for the current phase, the number that decides whether he finishes. */
function BehindPlan({ ms }: { ms: number }) {
  return (
    <span
      className="tint flex h-8 animate-in items-center gap-1.5 rounded-full bg-warning-soft px-3 text-ui font-semibold text-warning fade-in-0 zoom-in-95 duration-200"
      title="Time past the planned end of the phase you are in"
    >
      <span aria-hidden="true" className="status-dot size-1.5 shrink-0 rounded-full bg-warning-fill text-warning-fill" />
      <span className="font-mono tabular-nums">{formatClock(ms)}</span> behind plan
    </span>
  );
}

/** What the current phase must produce, in the candidate's own method, so the next step never has to be recalled. */
function PhaseGoal({ session }: { session: PublicSession }) {
  const phase = phasesFor(session.track).find((p) => p.id === session.phase);
  if (!phase) return <span className="min-w-0 flex-1" />;
  return (
    <p className="min-w-0 flex-1 truncate px-1 text-ui" title={`${phase.label}: ${phase.goal}`}>
      <span className="font-semibold text-foreground">{phase.label}.</span> <span className="text-muted-foreground">{phase.goal}.</span>
    </p>
  );
}

function pauseBody(reason: PublicSession["pauseReason"]): string {
  const kept = "The clock is stopped, and your board, code and chat are kept.";
  return reason === "away" || reason === "restart" ? `${pauseText(reason)} ${kept}` : kept;
}

/**
 * A pause covers the work as well as stopping the clock, so a timed round stays honest, and the one way
 * forward is a single large button.
 */
function PauseCover({
  tone,
  title,
  body,
  action,
  connected,
  onAction,
}: {
  tone: "warn" | "bad";
  title: string;
  body: string;
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
    <div className={cn(OVERLAY_SURFACE, "absolute z-40 flex items-center justify-center p-6 animate-in fade-in-0 duration-300")}>
      <div
        role={tone === "bad" ? "alert" : "status"}
        className={cn(
          "flex w-full max-w-md flex-col items-center gap-3 rounded-xl border border-border bg-card bg-linear-to-b from-raised to-card to-40% px-8 py-8 text-center surface-float",
          "animate-in fade-in-0 zoom-in-[0.95] slide-in-from-bottom-2 duration-[260ms] ease-out-quick",
        )}
      >
        <span
          className={cn("tint flex size-12 items-center justify-center rounded-full", tone === "bad" ? "bg-destructive-soft text-destructive" : "bg-warning-soft text-warning")}
          aria-hidden="true"
        >
          {tone === "bad" ? <WarnIcon size={22} /> : <PauseIcon size={22} />}
        </span>
        <h2 className="text-title font-bold">{title}</h2>
        <p className="text-body text-muted-foreground">{body}</p>
        <Button ref={button} id="pause-action" variant="default" size="lg" className="mt-2 min-w-40" onClick={onAction} disabled={!connected}>
          {tone === "bad" ? null : <PlayIcon size={16} />}
          {action}
        </Button>
        {!connected ? <p className="text-ui text-muted-foreground">Waiting for the connection to come back.</p> : null}
      </div>
    </div>
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
    <div role="tablist" aria-label="Work area" onKeyDown={onKeyDown} className="flex h-full items-end gap-1">
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
          className={cn(
            "room-tab relative flex h-10 items-center gap-2 rounded-t-md px-3 text-ui font-medium transition-colors duration-150 after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:transition-transform after:duration-200 hover:bg-accent/70 hover:text-foreground",
            tab === item.id ? "text-foreground after:scale-x-100" : "text-muted-foreground after:scale-x-0",
          )}
        >
          {item.label}
          {item.id === "code" && errorCount > 0 ? <Badge tone="bad">{errorCount === 1 ? "1 error" : `${errorCount} errors`}</Badge> : null}
        </button>
      ))}
    </div>
  );
}

function AttemptPath({ path, studyRoot }: { path: string; studyRoot: string | null }) {
  const [copied, setCopied] = useState(false);
  // The session keeps the path relative to the study folder, but the file endpoint can return an absolute one.
  const full = path.startsWith("/") || !studyRoot ? path : `${studyRoot.replace(/\/$/, "")}/${path}`;
  const copy = () => {
    void navigator.clipboard?.writeText(full).then(
      () => {
        setCopied(true);
        toast.success("Path copied");
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };
  return (
    <div className="room-strip flex shrink-0 items-center gap-2 px-3 py-1 text-meta text-muted-foreground">
      <span className="shrink-0">Attempt file</span>
      <code className="min-w-0 truncate font-mono text-foreground" title={full}>
        {full}
      </code>
      <Button variant="ghost" size="sm" onClick={copy} className="h-6 shrink-0 px-1.5 text-meta text-primary-text hover:text-primary-text">
        {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
        {copied ? "Copied" : "Copy path"}
      </Button>
      <span className="ml-auto hidden shrink-0 text-faint xl:inline">Edits in your editor appear here. Ctrl+Shift+M lets Tab leave the editor.</span>
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
