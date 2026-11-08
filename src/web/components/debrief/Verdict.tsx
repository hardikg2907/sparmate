import { DEFAULT_TARGET } from "../../../shared/target";
import type { Scorecard } from "../../../shared/types";
import { VERDICT_TONE } from "../../lib/format";
import { READINESS_TITLE, VERDICT_EXPLANATION, VERDICT_LABEL } from "../../lib/verdict";
import { TONE_FILL, TONE_TEXT, Tooltip, cn } from "../ui";

export function jumpTo(id: string): void {
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
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
    <section id="verdict" aria-labelledby="verdict-heading" className="relative pl-4">
      <h2 id="verdict-heading" className="sr-only">
        Verdict
      </h2>
      <span aria-hidden="true" className={cn("absolute inset-y-0.5 left-0 w-1 rounded-full", TONE_FILL[tone])} />
      <p className="text-ui font-semibold text-muted-foreground">{readiness ? "Ready for interview mode?" : `At the ${levels.target} bar`}</p>
      <p className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-title font-bold tracking-[-0.01em] text-foreground">{readiness ? READINESS_TITLE[readiness.call] : VERDICT_LABEL[verdict.sde2]}</span>
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
 * the warning colour, the rest in the success colour. The whole strip opens the evidence tab.
 */
export function ScoreRow({ scorecard, onEvidence }: { scorecard: Scorecard; onEvidence: () => void }) {
  const target = levelNames(scorecard.verdict).target;
  const caption = `Scores run from 1 to 4. A 3 meets the ${target} bar. Select to read the evidence.`;
  return (
    <Tooltip content={caption} side="top">
      <button
        type="button"
        onClick={onEvidence}
        aria-label={`Scores by dimension. ${caption}`}
        className="grid w-full grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border text-left transition-colors hover:bg-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:grid-flow-col sm:auto-cols-fr sm:grid-cols-none"
      >
        {scorecard.dimensions.map((dimension) => {
          const tone = dimension.score < 3 ? "warn" : "good";
          return (
            <span key={dimension.id} className="flex min-w-0 flex-col gap-1 bg-card px-3 py-2.5">
              <span className="line-clamp-2 min-h-[2lh] text-meta leading-snug text-muted-foreground" title={dimension.name}>
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
            </span>
          );
        })}
      </button>
    </Tooltip>
  );
}
