import { DEFAULT_TARGET } from "../../../shared/target";
import type { Scorecard } from "../../../shared/types";
import { VERDICT_TONE } from "../../lib/format";
import { READINESS_TITLE, VERDICT_EXPLANATION, VERDICT_LABEL } from "../../lib/verdict";
import { scrollToInScroller } from "../../lib/scrollInScroller";
import { TONE_FILL, TONE_TEXT, Tooltip, cn } from "../ui";

export function jumpTo(id: string): void {
  const target = document.getElementById(id);
  if (!target) return;
  scrollToInScroller(target, { behavior: "smooth" });
}

/** The level names the round was judged at; a card saved without them was judged at the defaults. */
export function levelNames(verdict: Scorecard["verdict"]): { target: string; stretch: string } {
  return { target: verdict.targetLevel ?? DEFAULT_TARGET.level, stretch: verdict.stretchLevel ?? DEFAULT_TARGET.stretch };
}

/**
 * The call in three lines. A guided round with a readiness call answers "Ready for interview mode?"; an interview
 * round, or a guided round saved before the call existed, names the call at the target level.
 */
export function VerdictCard({ scorecard }: { scorecard: Scorecard }) {
  const { verdict } = scorecard;
  const readiness = scorecard.readiness;
  const tone = readiness ? (readiness.call === "ready" ? "good" : "warn") : VERDICT_TONE[verdict.sde2];
  const levels = levelNames(verdict);
  const confidence = `${verdict.confidence} confidence`;
  return (
    <section id="verdict" aria-labelledby="verdict-heading">
      <h2 id="verdict-heading" className="sr-only">
        Verdict
      </h2>
      <p className="text-ui font-semibold text-muted-foreground">{readiness ? "Ready for interview mode?" : `At the ${levels.target} bar`}</p>
      <p className="flex flex-wrap items-baseline gap-x-3">
        <span className={cn("text-title font-bold", TONE_TEXT[tone])}>{readiness ? READINESS_TITLE[readiness.call] : VERDICT_LABEL[verdict.sde2]}</span>
        <span className="text-meta text-muted-foreground">{readiness ? confidence : `${levels.stretch}: ${VERDICT_LABEL[verdict.senior]} · ${confidence}`}</span>
      </p>
      <p className="mt-0.5 text-ui text-muted-foreground">
        {readiness
          ? readiness.reasons.length > 0
            ? readiness.reasons.join(" · ")
            : "Every step passed on your own, inside the planned time. Interview mode is the next test."
          : VERDICT_EXPLANATION[verdict.sde2]}
      </p>
    </section>
  );
}

/**
 * The scores as one strip of equal cells: name, score out of 4 and a four-segment meter. Scores below the bar are in
 * the warning colour, the rest in the success colour. Each cell opens the evidence for its own dimension.
 */
export function ScoreRow({ scorecard, onEvidence }: { scorecard: Scorecard; onEvidence: (dimensionId: string) => void }) {
  const target = levelNames(scorecard.verdict).target;
  const caption = `Scores run from 1 to 4. A 3 meets the ${target} bar. Select a score to read its evidence.`;
  return (
    <Tooltip content={caption} side="top">
      <div
        role="group"
        aria-label="Scores by dimension"
        className="grid w-full grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-flow-col sm:auto-cols-fr sm:grid-cols-none md:grid-flow-row md:auto-cols-auto md:grid-cols-3 xl:grid-flow-col xl:auto-cols-fr xl:grid-cols-none"
      >
        {scorecard.dimensions.map((dimension) => {
          const tone = dimension.score < 3 ? "warn" : "good";
          return (
            <button
              key={dimension.id}
              type="button"
              onClick={() => onEvidence(dimension.id)}
              aria-label={`${dimension.name}, ${dimension.score} of 4`}
              className="flex min-w-0 flex-col gap-1 bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
            >
              <span className="text-meta leading-tight text-muted-foreground max-xl:min-h-[2.5em] xl:truncate" title={dimension.name}>
                {dimension.name}
              </span>
              <span className="flex items-baseline gap-0.5">
                <span className={cn("text-[20px] font-semibold leading-6 tabular-nums", TONE_TEXT[tone])}>{dimension.score}</span>
                <span className="text-meta text-muted-foreground">/4</span>
              </span>
              <span aria-hidden="true" className="flex gap-0.5">
                {[1, 2, 3, 4].map((step) => (
                  <span key={step} className={cn("h-1 flex-1 rounded-full", step <= dimension.score ? TONE_FILL[tone] : "bg-muted")} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </Tooltip>
  );
}
