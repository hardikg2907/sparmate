import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Mode, Track } from "../../shared/phases";
import type { CustomProblemJobStatus } from "../../shared/protocol";
import { ApiError, api } from "../backend";
import { ArrowLeftIcon, CheckIcon, WarnIcon } from "../components/icons";
import { PageHeader, PageShell } from "../components/PageShell";
import { GUIDED_HINT } from "../components/study";
import { Alert, Badge, Button, Card, Segmented, Spinner, Textarea, Tooltip, cn } from "../components/ui";
import { isFactualCorrection, lookupNote, preparedSummary, prepProgress } from "../lib/customPrep";
import { TRACK_LABEL, TRACK_TITLE } from "../lib/format";
import { useStudyData, type StudyData } from "../lib/useStudyData";
import { Link } from "../router";
import type { PageContext } from "./context";

const CUSTOM_MIN = 10;
const CUSTOM_MAX = 4000;

function ErrorLine({ text }: { text: string }) {
  return (
    <Alert tone="bad" role="alert" icon={<WarnIcon size={16} />}>
      {text}
    </Alert>
  );
}

const CUSTOM_JOB_KEY = "sparmate-custom-job";

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
  const progress = prepProgress(job);
  const factual = (job?.corrections ?? []).filter(isFactualCorrection);

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

  const jobId = job?.id;
  const jobStage = job?.stage;
  useEffect(() => {
    if (jobId === undefined || jobStage === undefined || !preparing) return;
    if (jobStage === "ready" || jobStage === "failed" || jobStage === "cancelled") {
      setPreparing(false);
      return;
    }

    let active = true;
    const timer = setInterval(async () => {
      try {
        const next = await api.customProblemJob(jobId);
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
  }, [jobId, jobStage, preparing]);

  return (
    <section aria-label="Prepare a question" className="max-w-3xl">
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
                <p className="mt-1 text-ui text-muted-foreground">{preparedSummary(job, factual.length)}</p>
              </div>
            </div>

            {factual.length > 0 ? (
              <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2">
                <p className="text-ui font-medium text-foreground">
                  {factual.length} {factual.length === 1 ? "correction applied" : "corrections applied"}:
                </p>
                <ul className="space-y-1 text-meta text-muted-foreground">
                  {factual.map((c, i) => (
                    <li key={i}>
                      <span className="font-semibold text-foreground">[{c.section}]</span> {c.claim} → <span className="text-success">{c.fix}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {job.confidence ? <p className="text-ui text-muted-foreground italic">Confidence: {job.confidence}</p> : null}

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
              {progress.steps.map((step, index) => {
                const activeIndex = progress.steps.indexOf(progress.active);
                const state = index < activeIndex ? "done" : index === activeIndex ? "active" : "waiting";
                return (
                  <li
                    key={step}
                    className={cn(
                      "flex items-center gap-2.5 transition-colors duration-200",
                      state === "active" ? "font-semibold text-foreground" : state === "done" ? "text-muted-foreground" : "text-faint",
                    )}
                  >
                    {state === "active" ? (
                      <Spinner label="" className="size-4" />
                    ) : state === "done" ? (
                      <CheckIcon size={16} className="text-success" />
                    ) : (
                      <span className="size-4 rounded-full border border-border inline-block" />
                    )}
                    <span>{step === "writing" ? "Writing the brief" : "Checking facts"}</span>
                  </li>
                );
              })}
            </ol>
            <p className="text-meta text-faint">{[lookupNote(job), "Preparing a brief can take a few minutes."].filter(Boolean).join(" ")}</p>
            <div className="pt-1">
              <Button variant="ghost" disabled={busy || cancelling} busy={cancelling} onClick={cancelPreparation}>
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

export function LibraryNewView({ data, ctx }: { data: StudyData; ctx: PageContext }) {
  return (
    <PageShell testMode={ctx.testMode}>
      <div className="reveal-children space-y-6">
        <Link href="/practice" className="inline-flex items-center gap-1.5 text-ui text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon size={14} />
          Practice
        </Link>
        <PageHeader title="Practise any question" />
        <p className="-mt-2 max-w-[60ch] text-body text-muted-foreground">
          Paste a question from a list or a past interview. The app can look up real systems, writes a private brief, and checks its facts before you start.
        </p>
        {data.startError ? <ErrorLine text={data.startError} /> : null}
        <CustomPrompt starting={data.starting} busy={data.starting !== null} onStart={(id, mode) => data.start(id, mode)} onReloadProblems={data.reload} />
      </div>
    </PageShell>
  );
}

export function LibraryNewPage({ ctx }: { ctx: PageContext }) {
  const data = useStudyData();
  useEffect(() => {
    document.title = "Practise any question · Sparmate";
  }, []);
  return <LibraryNewView data={data} ctx={ctx} />;
}
