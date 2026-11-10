import { useState } from "react";
import type { Scorecard } from "../../../shared/types";
import { SEVERITY_LABEL, SEVERITY_ORDER } from "../../lib/format";
import { gapBadge, gapState, isPractised, severitiesDiffer, type GapMark, type GapState } from "../../lib/gapMarks";
import { Link } from "../../router";
import { CheckIcon, ChevronDownIcon, MoreIcon } from "../icons";
import { Badge, Button, Card, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, SectionTitle, Tooltip, cn } from "../ui";

type Gap = Scorecard["gaps"][number];

export function sortedGaps(scorecard: Scorecard): Gap[] {
  return [...scorecard.gaps].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export interface PractiseGap {
  /** Title of the gap whose round is being created, or null. */
  busy: string | null;
  onStart: (gap: Gap) => void;
}

interface GapActions {
  /** Sends the "Teach me this" message for the gap. */
  onTeach: (gap: Gap) => boolean;
  /** Scrolls the coach chat to where the gap begins. */
  onContinue: (gap: Gap) => void;
  practise: PractiseGap;
  /** False while the coach cannot receive a message, so every action that sends one is off. */
  canSend: boolean;
}

const PRACTISE_HINT = "A 20-minute guided round on this problem, aimed at this gap";

/** The mark that says where a gap stands: a tick only for done or practised, so a tick never means "sent". */
function StateMark({ state }: { state: GapState }) {
  if (state === "done" || state === "practised") return <CheckIcon size={14} className="shrink-0 text-success" />;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 shrink-0 rounded-full",
        state === "with_coach" ? "bg-primary" : state === "later" ? "border-[1.5px] border-warning bg-warning-soft" : "border-[1.5px] border-muted-foreground",
      )}
    />
  );
}

function GapMenu({ gap, state, actions }: { gap: Gap; state: GapState; actions: GapActions }) {
  const { practise } = actions;
  const restart = state === "with_coach" || state === "done";
  const showPractise = state !== "done";
  return (
    <DropdownMenu>
      <Tooltip content="More actions" side="top">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`More actions: ${gap.title}`}>
            <MoreIcon size={16} />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent>
        {restart ? (
          <DropdownMenuItem disabled={!actions.canSend} onSelect={() => actions.onTeach(gap)}>
            Restart lesson
          </DropdownMenuItem>
        ) : null}
        {showPractise ? (
          <DropdownMenuItem disabled={practise.busy !== null} onSelect={() => practise.onStart(gap)} className="flex-col items-start gap-0">
            <span>Practise this gap</span>
            <span className="text-meta text-muted-foreground">{PRACTISE_HINT}</span>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PrimaryAction({ gap, state, mark, actions, size }: { gap: Gap; state: GapState; mark: GapMark | undefined; actions: GapActions; size: "sm" | "default" }) {
  const { practise } = actions;
  if (isPractised(mark)) {
    return (
      <Button asChild size={size} variant="outline">
        <Link href={`/session/${mark.practised.sessionId}`} aria-label={`Open the practice round: ${gap.title}`}>
          Open the practice round
        </Link>
      </Button>
    );
  }
  if (state === "done") {
    return (
      <Tooltip content={PRACTISE_HINT}>
        <Button
          size={size}
          variant="outline"
          busy={practise.busy === gap.title}
          disabled={practise.busy !== null}
          aria-label={`Practise this gap: ${gap.title}`}
          onClick={() => practise.onStart(gap)}
        >
          Practise this gap
        </Button>
      </Tooltip>
    );
  }
  const [label, run] =
    state === "with_coach"
      ? ["Continue in chat", () => actions.onContinue(gap)]
      : state === "later"
        ? ["Finish the lesson", () => void actions.onTeach(gap)]
        : ["Teach me this", () => void actions.onTeach(gap)];
  return (
    <Button size={size} variant="outline" disabled={state !== "with_coach" && !actions.canSend} aria-label={`${label}: ${gap.title}`} onClick={run}>
      {label}
    </Button>
  );
}

function GapBody({ gap, state, mark, actions }: { gap: Gap; state: GapState; mark: GapMark | undefined; actions: GapActions }) {
  return (
    <>
      <dl className="mt-2 grid gap-x-8 gap-y-3 md:grid-cols-2">
        <div>
          <dt className="text-meta font-semibold text-muted-foreground">Why it matters</dt>
          <dd className="mt-0.5 text-ui text-foreground">{gap.whyItMatters}</dd>
        </div>
        <div>
          <dt className="text-meta font-semibold text-muted-foreground">What good looks like</dt>
          <dd className="mt-0.5 text-ui text-foreground">{gap.whatGoodLooksLike}</dd>
        </div>
      </dl>
      <div className="mt-3 flex items-center gap-2">
        <PrimaryAction gap={gap} state={state} mark={mark} actions={actions} size="default" />
        <span className="flex-1" />
        <GapMenu gap={gap} state={state} actions={actions} />
      </div>
    </>
  );
}

function GapHeading({ gap, state, mark, severity }: { gap: Gap; state: GapState; mark: GapMark | undefined; severity: boolean }) {
  const badge = gapBadge(state, mark);
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {badge ? (
        <Badge tone={badge.tone} role="status">
          {state === "done" || state === "practised" ? <CheckIcon size={12} /> : state === "with_coach" ? <span aria-hidden="true">●</span> : null}
          {badge.label}
        </Badge>
      ) : null}
      {severity ? <Badge>{SEVERITY_LABEL[gap.severity]}</Badge> : null}
      <h3 className="min-w-0 flex-1 basis-40 text-body font-semibold text-foreground">{gap.title}</h3>
      <span className="text-meta text-muted-foreground">{gap.teachMinutes} min</span>
    </div>
  );
}

function CurrentGap({ gap, state, mark, severity, actions }: { gap: Gap; state: GapState; mark: GapMark | undefined; severity: boolean; actions: GapActions }) {
  return (
    <Card variant="raised" className="border-primary/40 p-4">
      <GapHeading gap={gap} state={state} mark={mark} severity={severity} />
      <GapBody gap={gap} state={state} mark={mark} actions={actions} />
    </Card>
  );
}

function GapRow({ gap, index, state, mark, severity, actions }: { gap: Gap; index: number; state: GapState; mark: GapMark | undefined; severity: boolean; actions: GapActions }) {
  const [open, setOpen] = useState(false);
  const panel = `gap-panel-${index}`;
  return (
    <div className="px-1 py-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? panel : undefined}
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 basis-60 items-center gap-2.5 rounded py-1 text-left text-ui"
        >
          <StateMark state={state} />
          {severity ? <Badge>{SEVERITY_LABEL[gap.severity]}</Badge> : null}
          <span className="min-w-0 flex-1 text-foreground">{gap.title}</span>
          <span className="sr-only">{`, ${gapBadge(state, mark)?.label ?? "not started"}`}</span>
          <span className="text-meta text-muted-foreground">{gap.teachMinutes} min</span>
          <ChevronDownIcon size={14} className={cn("shrink-0 text-muted-foreground transition-transform duration-150", open && "rotate-180")} />
        </button>
        {/* The lesson starts from the row, so a gap never has to be opened to be taught. The open body has its own. */}
        {open || state === "done" || state === "practised" ? null : (
          <span className="ml-auto">
            <PrimaryAction gap={gap} state={state} mark={mark} actions={actions} size="sm" />
          </span>
        )}
      </div>
      {open ? (
        <div id={panel} className="pb-2">
          {gapBadge(state, mark) ? (
            <div className="mt-1">
              <GapHeadingBadge state={state} mark={mark} />
            </div>
          ) : null}
          <GapBody gap={gap} state={state} mark={mark} actions={actions} />
        </div>
      ) : null}
    </div>
  );
}

function GapHeadingBadge({ state, mark }: { state: GapState; mark: GapMark | undefined }) {
  const badge = gapBadge(state, mark);
  if (!badge) return null;
  return (
    <Badge>
      {state === "done" || state === "practised" ? <CheckIcon size={12} /> : state === "with_coach" ? <span aria-hidden="true">●</span> : null}
      {badge.label}
    </Badge>
  );
}

export function GapsSection({
  scorecard,
  marks,
  current,
  onTeach,
  onContinue,
  practise,
  canSend,
}: {
  scorecard: Scorecard;
  marks: ReadonlyMap<string, GapMark>;
  current: Gap | undefined;
  onTeach: (gap: Gap) => boolean;
  onContinue: (gap: Gap) => void;
  practise: PractiseGap;
  canSend: boolean;
}) {
  const gaps = sortedGaps(scorecard);
  const actions: GapActions = { onTeach, onContinue, practise, canSend };
  // Two gaps can share a title, so rows are keyed by their place in the sorted list.
  const others = gaps.map((gap, index) => ({ gap, index })).filter(({ gap }) => gap !== current);
  const severity = severitiesDiffer(gaps);
  return (
    <section id="gaps" aria-labelledby="gaps-heading" className="scroll-mt-4">
      <SectionTitle id="gaps-heading" aside={gaps.length > 1 ? "Most serious first" : undefined}>
        Gaps to work on
      </SectionTitle>
      {gaps.length > 0 ? (
        <div className="space-y-3">
          {current ? <CurrentGap gap={current} state={gapState(marks.get(current.title))} mark={marks.get(current.title)} severity={severity} actions={actions} /> : null}
          {others.length > 0 ? (
            <div className="divide-y divide-border border-y border-border">
              {others.map(({ gap, index }) => (
                <GapRow key={index} gap={gap} index={index} state={gapState(marks.get(gap.title))} mark={marks.get(gap.title)} severity={severity} actions={actions} />
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-ui text-muted-foreground">No gaps were listed for this round.</p>
      )}
    </section>
  );
}
