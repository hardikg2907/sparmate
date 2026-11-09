import { useEffect, useMemo, useRef, useState } from "react";
import { PASSES_TO_CLOSE, type DrillPrompt, type DrillResult, type DrillTarget } from "../../shared/drills";
import { ApiError, api } from "../backend";
import { ConfirmModal } from "../components/ConfirmModal";
import { DrillIcon } from "../components/DrillIcon";
import { Markdown } from "../components/Markdown";
import { ArrowLeftIcon, CheckIcon, WarnIcon } from "../components/icons";
import { InfoTip, TrackChip } from "../components/study";
import { Alert, Button, Card, Skeleton, Spinner, Textarea, cn } from "../components/ui";
import { parseDay, shortDay } from "../lib/dates";
import { testHooksEnabled } from "../session/testHooks";
import { countdownText, useCountdown } from "../lib/useCountdown";
import { Link, drillPath, guardNavigation, navigate } from "../router";
import { HOW_A_GAP_CLOSES, Pips } from "./Gym";
import type { PageContext } from "./context";

const MAX_ANSWER = 8000;

function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.message ? error.message : fallback;
}

/**
 * One drill, full screen like a round: the prompt on the left, the answer on the right, and a soft timer that shows
 * overtime and never blocks. Submitting swaps the screen for the result.
 */
export function DrillPage({ target }: { ctx: PageContext; target: DrillTarget }) {
  const [prompt, setPrompt] = useState<DrillPrompt | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [result, setResult] = useState<DrillResult | null>(null);
  const [answer, setAnswer] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const typed = answer.trim().length > 0;

  useEffect(() => {
    let live = true;
    setPrompt(null);
    setResult(null);
    setAnswer("");
    setStartedAt(null);
    setLoadError(null);
    api.gymPrompt(target).then(
      (p) => {
        if (!live) return;
        setPrompt(p);
        setStartedAt(Date.now());
        document.title = `${p.title} · Sparmate`;
      },
      (failure: unknown) => live && setLoadError(messageOf(failure, "The drill could not be loaded.")),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.drill, target.problemId, target.drillId]);

  // Leaving with an unsent answer asks first. The result screen and an empty box leave freely.
  const pending = useRef<(() => void) | null>(null);
  const guarded = typed && result === null;
  useEffect(() => {
    if (!guarded) return;
    guardNavigation((to, proceed) => {
      setLeaving(to);
      pending.current = proceed;
    });
    return () => guardNavigation(null);
  }, [guarded]);

  const submit = () => {
    if (!typed || busy) return;
    setBusy(true);
    setSubmitError(null);
    api.gymSubmit(target, answer).then(
      (r) => {
        setResult(r);
        setBusy(false);
      },
      (failure: unknown) => {
        setSubmitError(messageOf(failure, "The answer could not be graded. Try again."));
        setBusy(false);
      },
    );
  };

  return (
    <div className="page-canvas flex h-full min-h-0 flex-col overflow-y-auto">
      <TopBar prompt={prompt} startedAt={result ? null : startedAt} />
      <main tabIndex={-1} className="mx-auto w-full max-w-[1224px] flex-1 px-4 pb-16 pt-8 sm:px-8">
        {loadError ? (
          <Alert
            tone="bad"
            role="alert"
            icon={<WarnIcon size={16} />}
            title="This drill is not available"
            actions={
              <Button asChild>
                <Link href="/gym">Back to the Gym</Link>
              </Button>
            }
          >
            {loadError}
          </Alert>
        ) : !prompt ? (
          <div className="grid gap-6 lg:grid-cols-2" role="status">
            <span className="sr-only">Loading the drill…</span>
            <Skeleton className="h-80 rounded-xl" />
            <Skeleton className="h-80 rounded-xl" />
          </div>
        ) : result ? (
          <ResultView prompt={prompt} result={result} />
        ) : (
          <div className="reveal-children grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <PromptView prompt={prompt} />
            <AnswerView answer={answer} onAnswer={setAnswer} hint={prompt.answerHint} busy={busy} error={submitError} onSubmit={submit} />
          </div>
        )}
      </main>
      {leaving ? (
        <ConfirmModal
          title="Leave this drill?"
          confirmLabel="Leave the drill"
          cancelLabel="Keep working"
          danger
          onCancel={() => {
            pending.current = null;
            setLeaving(null);
          }}
          onConfirm={() => {
            const go = pending.current;
            pending.current = null;
            setLeaving(null);
            go?.();
          }}
        >
          <p>Your answer has not been graded, and it will be lost.</p>
        </ConfirmModal>
      ) : null}
    </div>
  );
}

function TopBar({ prompt, startedAt }: { prompt: DrillPrompt | null; startedAt: number | null }) {
  return (
    <header className="header-hairline sticky top-0 z-20 shrink-0 border-b border-border/70 bg-card/90 shadow-xs backdrop-blur-xl supports-[backdrop-filter]:bg-card/80">
      <div className="mx-auto flex h-14 max-w-[1224px] items-center gap-4 px-4 sm:px-8">
        <Button asChild variant="ghost" size="sm">
          <Link href="/gym">
            <ArrowLeftIcon size={14} />
            Gym
          </Link>
        </Button>
        {prompt ? (
          <span className="flex min-w-0 items-center gap-2 text-ui font-semibold">
            <DrillIcon drill={prompt.drill} size={16} className="text-primary-text" />
            <span className="truncate">{prompt.title}</span>
          </span>
        ) : null}
        <div className="ml-auto">{prompt && startedAt !== null ? <DrillTimer minutes={prompt.minutes} startedAt={startedAt} /> : null}</div>
      </div>
    </header>
  );
}

function DrillTimer({ minutes, startedAt }: { minutes: number; startedAt: number | null }) {
  const { remainingMs, over } = useCountdown(startedAt, minutes * 60_000);
  return (
    <div
      role="timer"
      aria-live="off"
      aria-label={over ? `Over by ${countdownText(remainingMs)}` : `Time left ${countdownText(remainingMs)}`}
      className={cn("flex h-8 items-baseline gap-1.5 rounded-md px-2.5 pt-[3px]", over ? "tint bg-warning-soft text-warning" : "room-timer text-foreground")}
    >
      <span className={cn("font-mono text-title font-bold tabular-nums", !over && "text-gradient")}>{countdownText(remainingMs)}</span>
      <span className="text-meta font-semibold text-muted-foreground">{over ? "over" : "left"}</span>
    </div>
  );
}

function PromptView({ prompt }: { prompt: DrillPrompt }) {
  return (
    <section aria-labelledby="drill-heading" className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <TrackChip track={prompt.problem.track} />
          <span className="text-ui text-muted-foreground">{prompt.minutes} min</span>
        </div>
        <h1 id="drill-heading" className="mt-3 text-display font-bold tracking-[-0.015em]">
          {prompt.title}
        </h1>
        <p className="mt-1 text-lead text-muted-foreground">
          On <b className="font-semibold text-foreground">{prompt.problem.title}</b>
        </p>
      </div>
      <Card variant="raised" className="p-6">
        <h2 className="text-meta font-semibold uppercase tracking-wide text-muted-foreground">Your task</h2>
        <p className="mt-2 text-lead font-semibold">{prompt.task}</p>
      </Card>
      {prompt.material.map((block) => (
        <Card key={block.heading} variant="flat" className="p-6">
          <h2 className="text-meta font-semibold uppercase tracking-wide text-muted-foreground">{block.heading}</h2>
          <Markdown text={block.markdown} className="mt-2 text-body" />
        </Card>
      ))}
    </section>
  );
}

function AnswerView({
  answer,
  onAnswer,
  hint,
  busy,
  error,
  onSubmit,
}: {
  answer: string;
  onAnswer: (text: string) => void;
  hint: string;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
}) {
  const ready = answer.trim().length > 0;
  return (
    <Card variant="raised" className="space-y-4 p-6 lg:sticky lg:top-20">
      <label htmlFor="drill-answer" className="block text-lead font-bold">
        Your answer
      </label>
      <Textarea
        id="drill-answer"
        value={answer}
        maxLength={MAX_ANSWER}
        onChange={(event) => onAnswer(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) onSubmit();
        }}
        placeholder="Type here."
        spellCheck={false}
        className="min-h-[340px] resize-y font-mono text-ui leading-relaxed"
        disabled={busy}
      />
      <p className="text-ui text-muted-foreground">{hint}</p>
      {error ? (
        <Alert tone="bad" role="alert" icon={<WarnIcon size={16} />}>
          {error}
        </Alert>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <span className="text-meta text-faint">{answer.length > 0 ? `${answer.length} of ${MAX_ANSWER} characters` : ""}</span>
        <Button size="lg" variant="default" busy={busy} disabled={!ready} onClick={onSubmit}>
          {busy ? "Grading…" : "Submit answer"}
        </Button>
      </div>
      {busy ? (
        <p className="flex items-center gap-2 text-ui text-muted-foreground" role="status">
          <Spinner label="" />
          The grader is reading your answer.
        </p>
      ) : null}
    </Card>
  );
}

function ResultView({ prompt, result }: { prompt: DrillPrompt; result: DrillResult }) {
  const pass = result.verdict === "pass";
  const next = result.next;
  const motion = !testHooksEnabled();
  return (
    <div className="reveal-children space-y-6">
      <section aria-labelledby="result-title" className="mesh on-mesh rounded-3xl p-6 sm:p-11">
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-ui font-bold", pass ? "bg-success-soft text-success" : "bg-amber text-amber-foreground")}>
          {pass ? <CheckIcon size={14} /> : null}
          {prompt.title}
        </span>
        <h1
          id="result-title"
          className={cn("mt-5 w-fit origin-left font-display text-display font-extrabold tracking-[-0.02em] sm:text-[64px] sm:leading-[68px]", pass && motion && "drill-settle")}
        >
          {pass ? "Pass" : "Not yet"}
        </h1>
        <p className="mt-3 text-body text-muted-foreground sm:text-lead">
          On <b className="font-semibold text-foreground">{prompt.problem.title}</b>
        </p>
        <ScheduleFacts result={result} />
        <div className={cn("mt-6 max-w-[62ch]", !pass && motion && "drill-slide-in")}>
          <h2 className="text-meta font-semibold uppercase tracking-wide text-hero-muted">{pass ? "Sharpen next" : "The one fix"}</h2>
          <p className="mt-1.5 text-lead">{result.fix}</p>
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          {next ? (
            <>
              <Button asChild size="lg" variant="default">
                <Link href={drillPath(next)}>Next drill</Link>
              </Button>
              <Button asChild size="lg" variant="ghost">
                <Link href="/gym">Back to the Gym</Link>
              </Button>
            </>
          ) : (
            <Button size="lg" variant="default" onClick={() => navigate("/gym")}>
              Back to the Gym
            </Button>
          )}
        </div>
      </section>
      <div className="grid gap-6 md:grid-cols-2">
        <Card variant="raised" className="p-6">
          <h2 className="text-meta font-semibold uppercase tracking-wide text-muted-foreground">Your line</h2>
          <blockquote className="mt-3 rounded-lg border border-border bg-sunken px-4 py-3 text-lead">{result.yourLine || "You left the answer empty."}</blockquote>
        </Card>
        <Card variant="raised" className="p-6">
          <h2 className="text-meta font-semibold uppercase tracking-wide text-muted-foreground">What a pass sounds like</h2>
          <blockquote className="mt-3 rounded-lg border border-border bg-sunken px-4 py-3 text-lead">{result.passSounds}</blockquote>
        </Card>
      </div>
    </div>
  );
}

function ScheduleFacts({ result }: { result: DrillResult }) {
  const items = useMemo(() => {
    if (result.passesInRow === null) return null;
    const next = result.nextDueOn ? shortDay(parseDay(result.nextDueOn)) : "Gap closed";
    return { passes: result.passesInRow, next };
  }, [result]);
  if (!items) {
    return <p className="mt-6 text-ui text-muted-foreground">This was a free drill. It does not change your schedule.</p>;
  }
  return (
    <dl className="mesh-tile mt-7 grid w-full auto-cols-fr grid-flow-col divide-x divide-border rounded-xl sm:inline-grid sm:w-auto sm:auto-cols-auto">
      <div className="min-w-0 px-3 py-3 sm:px-5 sm:py-3.5">
        <dt className="flex items-center gap-1 text-meta text-muted-foreground">
          Passes in a row
          <InfoTip label="How a gap closes">{HOW_A_GAP_CLOSES}</InfoTip>
        </dt>
        <dd className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-body font-semibold sm:text-lead">
          <span className="whitespace-nowrap">
            {items.passes} of {PASSES_TO_CLOSE}
          </span>
          <Pips filled={items.passes} onMesh />
        </dd>
      </div>
      <div className="min-w-0 px-3 py-3 sm:px-5 sm:py-3.5">
        <dt className="text-meta text-muted-foreground">{result.closed ? "Status" : "Comes back"}</dt>
        <dd className="mt-0.5 text-body font-semibold sm:text-lead">{items.next}</dd>
      </div>
    </dl>
  );
}
