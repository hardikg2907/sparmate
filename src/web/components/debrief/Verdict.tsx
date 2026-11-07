import type { CSSProperties } from "react";
import type { Tone } from "../../lib/format";
import { useCountUp } from "../../hooks/useCountUp";
import { DEFAULT_TARGET } from "../../../shared/target";
import type { Scorecard } from "../../../shared/types";
import { MARK_LABEL, MARK_TONE, SCORE_TONE, SCORE_WORD, VERDICT_TONE } from "../../lib/format";
import { VERDICT_EXPLANATION, VERDICT_LABEL } from "../../lib/verdict";
import { Markdown } from "../Markdown";
import { ChevronDownIcon } from "../icons";
import { Badge, Button, Card, TONE_FILL, TONE_TEXT, cn } from "../ui";

const stagger = (index: number) => ({ "--i": index }) as CSSProperties;

const BAND_GLOW: Partial<Record<Tone, string>> = {
  good: "shadow-[0_0_18px_var(--success-fill)]",
  warn: "shadow-[0_0_18px_var(--warning-fill)]",
  bad: "shadow-[0_0_18px_var(--destructive-fill)]",
};

export function jumpTo(id: string): void {
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

export function ScoreMeter({ score, wide, stretch }: { score: number; wide?: boolean; stretch?: boolean }) {
  const tone = SCORE_TONE[score] ?? "neutral";
  return (
    <span className={cn("flex gap-1", stretch && "w-full")} role="img" aria-label={`Score ${score} of 4`}>
      {[1, 2, 3, 4].map((step) => (
        <span
          key={step}
          style={{ "--j": step - 1, "--fill-at": "400ms" } as CSSProperties}
          className={cn(
            "h-2 rounded-full transition-colors duration-150",
            stretch ? "flex-1" : wide ? "w-7" : "w-5",
            step <= score ? cn("fill-x bg-linear-to-b from-white/25 to-transparent", TONE_FILL[tone]) : "bg-muted ring-1 ring-inset ring-border",
          )}
        />
      ))}
    </span>
  );
}

/**
 * The whole result on one screen. The call at the target level bar sits on a band tinted by that call, so the outcome reads
 * before any word does; the scores run under it as one strip, and the way on to the gaps is the next button.
 */
/** One dimension in the score strip: a jump link to its evidence, whose score counts up when the debrief opens. */
function ScoreCell({ dimension }: { dimension: Scorecard["dimensions"][number] }) {
  const tone = SCORE_TONE[dimension.score] ?? "neutral";
  const score = useCountUp(dimension.score, { delay: 350, duration: 700 });
  return (
    <button
      type="button"
      onClick={() => jumpTo(`dim-${dimension.id}`)}
      className="mesh-tile lift-row flex h-full w-full flex-col gap-2 rounded-2xl px-4 py-3.5 text-left hover:bg-accent"
    >
      <span className="truncate text-ui font-semibold text-foreground">{dimension.name}</span>
      <span className="flex items-baseline gap-2">
        <span className={cn("text-title font-bold tabular-nums", TONE_TEXT[tone])}>{score}</span>
        <span className="text-meta font-semibold text-muted-foreground">of 4, {(SCORE_WORD[dimension.score] ?? "").toLowerCase()}</span>
      </span>
      <ScoreMeter score={dimension.score} stretch />
    </button>
  );
}

/** The level names the round was judged at; a card saved without them was judged at the defaults. */
export function levelNames(verdict: Scorecard["verdict"]): { target: string; stretch: string } {
  return { target: verdict.targetLevel ?? DEFAULT_TARGET.level, stretch: verdict.stretchLevel ?? DEFAULT_TARGET.stretch };
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function VerdictCard({ scorecard }: { scorecard: Scorecard }) {
  const { verdict, trackerMark, trackerMarkReason } = scorecard;
  const tone = VERDICT_TONE[verdict.sde2];
  const levels = levelNames(verdict);
  const gapCount = scorecard.gaps.length;
  return (
    <section id="verdict" aria-labelledby="verdict-heading" className="scroll-mt-16">
      <h2 id="verdict-heading" className="sr-only">
        Verdict
      </h2>
      <Card variant="mesh" className="overflow-hidden">
        <div className="relative grid gap-x-12 gap-y-5 px-6 pb-4 pt-8 sm:px-9 md:grid-cols-[auto_1fr] md:items-center">
          <span aria-hidden="true" className={cn("absolute inset-y-6 left-0 w-1.5 rounded-r-full", TONE_FILL[tone], BAND_GLOW[tone])} />
          <div>
            <p className="text-ui font-semibold text-muted-foreground">At the {levels.target} bar</p>
            <p className="font-display text-display font-extrabold tracking-[-0.02em] text-foreground sm:text-mega">{VERDICT_LABEL[verdict.sde2]}</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-ui sm:grid-cols-3 md:justify-self-end">
            <div>
              <dt className="text-muted-foreground">{capitalize(levels.stretch)} bar</dt>
              <dd className={cn("text-lead font-bold", TONE_TEXT[VERDICT_TONE[verdict.senior]])}>{VERDICT_LABEL[verdict.senior]}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Confidence</dt>
              <dd className="text-lead font-bold capitalize text-foreground">{verdict.confidence}</dd>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <dt className="mb-0.5 text-muted-foreground">Tracker mark</dt>
              <dd>
                <Badge mono tone={MARK_TONE[trackerMark]} className="bg-card" title={MARK_LABEL[trackerMark]}>
                  {trackerMark} {MARK_LABEL[trackerMark].toLowerCase()}
                </Badge>
              </dd>
            </div>
          </dl>
          <p className="text-body text-foreground md:col-span-2">{VERDICT_EXPLANATION[verdict.sde2]}</p>
        </div>

        <div className="reveal space-y-3 px-6 pb-4 pt-2 sm:px-9" style={stagger(1)}>
          <Markdown text={verdict.summary} className="max-w-[68ch] text-body text-foreground" />
          {trackerMarkReason ? (
            <p className="max-w-[68ch] text-ui text-muted-foreground">
              <span className="font-semibold text-foreground">Why {trackerMark}:</span> {trackerMarkReason}
            </p>
          ) : null}
          {gapCount > 0 ? (
            <div className="pt-1">
              <Button variant="default" onClick={() => jumpTo("gaps")}>
                Work the {gapCount} {gapCount === 1 ? "gap" : "gaps"}
                <ChevronDownIcon size={14} />
              </Button>
            </div>
          ) : null}
        </div>

        <p className="px-6 pb-3 pt-4 text-meta text-faint sm:px-9">Scores run from 1 to 4. A 3 meets the {levels.target} bar. Select a score to read its evidence.</p>
        <nav aria-label="Scores by dimension" className="px-4 pb-4 sm:px-5 sm:pb-5">
          <ul className={cn("grid grid-cols-2 gap-3", scorecard.dimensions.length % 4 === 0 ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
            {scorecard.dimensions.map((dimension, index) => (
              <li key={dimension.id} className="reveal" style={stagger(2 + index)}>
                <ScoreCell dimension={dimension} />
              </li>
            ))}
          </ul>
        </nav>
      </Card>
    </section>
  );
}
