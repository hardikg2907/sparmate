import { useEffect, useState, type ReactNode } from "react";
import type { BoardPin, PublicStepCheck, Scorecard, StepSummary } from "../../../shared/types";
import { phasesFor, type Track } from "../../../shared/phases";
import { evidenceStepFor } from "../../../shared/stepFrames";
import { frameImageUrl } from "../../board/frameImage";
import { PIN_TONE_LABEL, pinAnchor } from "../../board/PinLayer";
import { elementBounds, findStepFrame } from "../../board/stepFrames";
import { ringView } from "../../lib/steps";
import { CheckIcon, MinusIcon } from "../icons";
import { StepRing } from "../StepRing";
import { Card, cn } from "../ui";
import { EvidenceItem } from "./Dimensions";

type Raw = Record<string, unknown>;

interface StepsProps {
  scorecard: Scorecard;
  track: Track;
  /** The checklist per step as the debrief may show it: every item, covered or not. */
  steps?: Readonly<Record<string, PublicStepCheck>>;
  pins?: readonly BoardPin[];
  /** The saved board, for each step's frame; null when it could not be loaded. */
  elements?: readonly Raw[] | null;
  /** Written step text and notepads that a round may hold. */
  notes?: Readonly<Record<string, string>>;
  summaries?: Readonly<Record<string, StepSummary>>;
}

/** The steps that the judge read, or that hold coverage, pins or notes; the others have nothing to show. */
export function stepsWithContent({ scorecard, track, steps = {}, pins = [], notes = {}, summaries = {} }: Omit<StepsProps, "elements">) {
  const judged = new Set((scorecard.steps ?? []).map((s) => s.phase));
  return phasesFor(track).filter((p) => {
    const step = steps[p.id];
    return (
      judged.has(p.id) ||
      (step?.covered ?? 0) + (step?.partial ?? 0) > 0 ||
      pins.some((pin) => pin.phase === p.id) ||
      (notes[p.id] ?? "").trim() !== "" ||
      (summaries[p.id]?.proposed.length ?? 0) + (summaries[p.id]?.agreed.length ?? 0) > 0
    );
  });
}

/**
 * Each step as the judge read it, beside the frame that held his answer: what held, with his own quoted words,
 * what is missing, and the pins the guide and the judge attached to his drawing.
 */
export function Steps({ scorecard, track, steps = {}, pins = [], elements = null, notes = {}, summaries = {} }: StepsProps) {
  const judged = new Map((scorecard.steps ?? []).map((s) => [s.phase, s]));
  const dimMap = new Map(scorecard.dimensions.map((d) => [d.id, d.name]));
  const stepChecks = new Map<string, boolean>();
  for (const check of scorecard.stepQuoteChecks ?? []) stepChecks.set(`${check.phase}:${check.index}`, check.verified);

  const shown = stepsWithContent({ scorecard, track, steps, pins, notes, summaries });
  if (shown.length === 0) return null;

  // Pins are numbered once across the board, in step order, so a number means the same pin everywhere.
  const order = new Map(phasesFor(track).map((p, i) => [p.id, i]));
  const numbered = [...pins].sort((a, b) => (order.get(a.phase ?? "") ?? 99) - (order.get(b.phase ?? "") ?? 99) || a.at - b.at);
  const numberOf = new Map(numbered.map((pin, i) => [pin.id, i + 1]));

  return (
    <section id="steps" aria-label="Evidence by step">
      <div className="space-y-4">
        {shown.map((phase) => {
          const judgedStep = judged.get(phase.id);
          const step = steps[phase.id];
          const held = (judgedStep?.took ?? []).map((t, i) => ({ t, i })).filter(({ t }) => t.evidence.polarity === "plus");
          const against = (judgedStep?.took ?? []).map((t, i) => ({ t, i })).filter(({ t }) => t.evidence.polarity === "minus");
          // Without the judge's reading of a step, the checklist's open items say what is missing.
          const missing = judgedStep ? judgedStep.missing : (step?.items ?? []).filter((i) => i.state !== "covered").map((i) => i.label);
          // A step that borrows another step's frame shows no image of its own; that frame appears under its own step.
          const thumbStep = elements && evidenceStepFor(track, phase.id) === phase.id && findStepFrame(elements, phase.id) ? phase.id : null;
          const stepPins = numbered.filter((pin) => pin.phase === phase.id);
          const ring = ringView(step);
          return (
            <Card key={phase.id} variant="raised" className="p-5">
              <div className={cn("grid gap-5", thumbStep ? "md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]" : "")}>
                {thumbStep && elements ? <FrameThumb elements={elements} step={thumbStep} pins={stepPins} numberOf={numberOf} label={phase.label} /> : null}
                <div className="min-w-0">
                  <header className="mb-3 flex items-center gap-3">
                    <h3 className="text-lead font-bold text-foreground">{phase.label}</h3>
                    {step && step.total > 0 ? (
                      <span className="tint flex items-center gap-1.5 rounded-full bg-muted py-0.5 pl-1 pr-2.5 text-meta font-semibold text-muted-foreground">
                        <StepRing view={ring} size={18} enter />
                        {step.covered} of {step.total} on the checklist
                      </span>
                    ) : null}
                  </header>

                  <StepHeading tone="good">What held</StepHeading>
                  {held.length > 0 ? (
                    <ul className="mt-2 space-y-3">
                      {held.map(({ t, i }) => (
                        <EvidenceItem
                          key={i}
                          evidence={t.evidence}
                          verified={stepChecks.get(`${phase.id}:${i}`)}
                          point={t.point}
                          dimensionName={dimMap.get(t.dimensionId) ?? t.dimensionId}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-ui text-muted-foreground">{judgedStep ? "Nothing in this step met the bar." : "The judge gave this step no reading of its own."}</p>
                  )}

                  <div className="mt-4 border-t border-border pt-3">
                    <StepHeading tone="bad">What's missing</StepHeading>
                    {missing.length + against.length > 0 ? (
                      <>
                        {missing.length > 0 ? (
                          <ul className="mt-1 list-disc space-y-1 pl-4 text-ui text-foreground">
                            {missing.map((line, i) => (
                              <li key={i} className="break-words">
                                {line}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {against.length > 0 ? (
                          <ul className="mt-3 space-y-3">
                            {against.map(({ t, i }) => (
                              <EvidenceItem
                                key={i}
                                evidence={t.evidence}
                                verified={stepChecks.get(`${phase.id}:${i}`)}
                                point={t.point}
                                dimensionName={dimMap.get(t.dimensionId) ?? t.dimensionId}
                              />
                            ))}
                          </ul>
                        ) : null}
                      </>
                    ) : (
                      <p className="mt-1 text-ui text-success">Nothing missing.</p>
                    )}
                  </div>

                  {stepPins.length > 0 ? (
                    <div className="mt-4 border-t border-border pt-3">
                      <h4 className="text-ui font-semibold text-muted-foreground">Pinned on the board</h4>
                      <ol className="mt-1.5 space-y-1.5">
                        {stepPins.map((pin) => (
                          <li key={pin.id} className="flex gap-2 text-ui">
                            <span className="ir-pin ir-pin--inline" data-tone={pin.tone} aria-hidden="true">
                              {numberOf.get(pin.id)}
                            </span>
                            <span className="min-w-0">
                              <span className="font-semibold">{PIN_TONE_LABEL[pin.tone]}.</span> {pin.note}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : null}

                  <RoundNotes text={notes[phase.id]} summary={summaries[phase.id]} />
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

/** A sub-heading of a step, with a tinted mark so held and missing read apart at a glance, not by colour alone. */
function StepHeading({ tone, children }: { tone: "good" | "bad"; children: ReactNode }) {
  return (
    <h4 className={cn("flex items-center gap-2 text-ui font-semibold", tone === "good" ? "text-success" : "text-destructive")}>
      <span aria-hidden="true" className={cn("tint flex size-5 items-center justify-center rounded-full", tone === "good" ? "bg-success-soft" : "bg-destructive-soft")}>
        {tone === "good" ? <CheckIcon size={12} /> : <MinusIcon size={12} />}
      </span>
      {children}
    </h4>
  );
}

/** One frame of the saved board with its pins at the places they were attached. */
function FrameThumb({
  elements,
  step,
  pins,
  numberOf,
  label,
}: {
  elements: readonly Raw[];
  step: string;
  pins: readonly BoardPin[];
  numberOf: ReadonlyMap<string, number>;
  label: string;
}) {
  const frame = findStepFrame(elements, step);
  const frameId = frame ? String(frame.id) : null;
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!frameId) return;
    let live = true;
    let made: string | null = null;
    frameImageUrl(elements, frameId).then(
      (u) => {
        made = u;
        if (live) setUrl(u);
        else URL.revokeObjectURL(u);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [elements, frameId]);

  if (!frame) return null;
  const box = elementBounds(frame);
  const byId = new Map(elements.map((el) => [String(el.id), el]));
  return (
    <figure className="step-well m-0 self-start">
      <div className="step-thumb" style={{ aspectRatio: `${Math.max(1, box.w)} / ${Math.max(1, box.h)}` }}>
        {url ? <img src={url} alt={`The ${label} frame of your board`} /> : <div className={cn("size-full", !failed && "skeleton")} />}
        {url
          ? pins.map((pin) => {
              const el = byId.get(pin.elementId);
              if (!el) return null;
              const a = pinAnchor(el);
              const left = ((a.x - box.x) / Math.max(1, box.w)) * 100;
              const top = ((a.y - box.y) / Math.max(1, box.h)) * 100;
              if (left < 0 || left > 100 || top < 0 || top > 100) return null;
              return (
                <span key={pin.id} className="ir-pin" data-tone={pin.tone} style={{ left: `${left}%`, top: `${top}%` }} aria-hidden="true">
                  {numberOf.get(pin.id)}
                </span>
              );
            })
          : null}
      </div>
      {failed ? <figcaption className="mt-1 text-meta text-muted-foreground">The image of this frame could not be drawn.</figcaption> : null}
    </figure>
  );
}

/** Text he wrote for the step and the notepad of the step, for a round that holds them. */
function RoundNotes({ text, summary }: { text: string | undefined; summary: StepSummary | undefined }) {
  const lines = summary?.status === "done" ? summary : null;
  const hasLines = (lines?.proposed.length ?? 0) + (lines?.agreed.length ?? 0) > 0;
  if (!hasLines && !(text ?? "").trim()) return null;
  return (
    <div className="mt-4 rounded-lg bg-sunken px-3 py-2.5">
      <h4 className="text-meta font-semibold text-muted-foreground">Your notes from the round</h4>
      {lines && lines.proposed.length > 0 ? <NoteList title="You proposed" lines={lines.proposed} /> : null}
      {lines && lines.agreed.length > 0 ? <NoteList title="Agreed" lines={lines.agreed} /> : null}
      {(text ?? "").trim() ? <p className="mt-1.5 whitespace-pre-wrap break-words text-ui text-foreground">{text}</p> : null}
    </div>
  );
}

function NoteList({ title, lines }: { title: string; lines: readonly string[] }) {
  return (
    <div className="mt-1.5">
      <p className="text-meta font-semibold text-muted-foreground">{title}</p>
      <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-ui text-foreground">
        {lines.map((line, i) => (
          <li key={i} className="break-words">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}
