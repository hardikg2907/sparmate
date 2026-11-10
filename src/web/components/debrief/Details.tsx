import type { PublicSession, Scorecard } from "../../../shared/types";
import { MARK_LABEL, MARK_TONE } from "../../lib/format";
import type { CodeState } from "../../session/types";
import type { Theme } from "../../theme";
import { Badge, Segmented, Tabs, TabsContent, TabsUnderlineList, TabsUnderlineTrigger } from "../ui";
import { DimensionsTable } from "./Dimensions";
import { JudgeSaw } from "./JudgeSaw";
import { ReferenceAnswer } from "./Reference";
import { ScenarioTable } from "./Scenarios";
import { Steps, stepsWithContent } from "./Steps";
import { TimingSection } from "./Timing";

export type DetailTab = "evidence" | "time" | "judge" | "reference";
export type EvidenceView = "step" | "score";

interface DetailsProps {
  tab: DetailTab;
  onTab: (tab: DetailTab) => void;
  view: EvidenceView;
  onView: (view: EvidenceView) => void;
  session: PublicSession;
  scorecard: Scorecard;
  board: readonly Record<string, unknown>[] | null;
  graphText: string;
  code: CodeState | null;
  theme: Theme;
  boardImageUrl: string | null;
}

/** The detail behind the verdict, one tab at a time: evidence, time, the record the judge read, and the reference answer. */
export function Details({ tab, onTab, view, onView, session, scorecard, board, graphText, code, theme, boardImageUrl }: DetailsProps) {
  const lld = session.track === "lld";
  const hasTime = (scorecard.phaseTiming?.length ?? 0) > 0 || scorecard.timeline.length > 0;
  const hasReference = (session.reference?.sections.length ?? 0) > 0;
  const hasSteps =
    stepsWithContent({ scorecard, track: session.track, steps: session.steps, pins: session.pins, notes: session.stepNotes, summaries: session.stepSummaries }).length > 0;
  const shown: DetailTab = (tab === "time" && !hasTime) || (tab === "reference" && !hasReference) ? "evidence" : tab;
  const { trackerMark, trackerMarkReason } = scorecard;

  return (
    <section id="details" aria-label="Details" className="scroll-mt-4">
      <Tabs value={shown} onValueChange={(value) => onTab(value as DetailTab)}>
        <TabsUnderlineList className="h-auto overflow-x-auto border-b border-border" aria-label="Details">
          <TabsUnderlineTrigger value="evidence">Evidence</TabsUnderlineTrigger>
          {hasTime ? <TabsUnderlineTrigger value="time">Time</TabsUnderlineTrigger> : null}
          <TabsUnderlineTrigger value="judge">What the judge saw</TabsUnderlineTrigger>
          {hasReference ? <TabsUnderlineTrigger value="reference">Reference</TabsUnderlineTrigger> : null}
        </TabsUnderlineList>

        <TabsContent value="evidence" className="space-y-4 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="text-ui text-muted-foreground">Quotes are checked against the saved record.</p>
            {hasSteps ? (
              <Segmented
                label="Group the evidence"
                value={view}
                onChange={onView}
                size="sm"
                options={[
                  { value: "step", label: "By step" },
                  { value: "score", label: "By score" },
                ]}
              />
            ) : null}
          </div>
          {trackerMarkReason ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ui text-muted-foreground">
              <Badge mono tone={MARK_TONE[trackerMark]} title={MARK_LABEL[trackerMark]}>
                {trackerMark} {MARK_LABEL[trackerMark].toLowerCase()}
              </Badge>
              <span>
                Why {trackerMark}: {trackerMarkReason}
              </span>
            </p>
          ) : (
            <Badge mono tone={MARK_TONE[trackerMark]} title={MARK_LABEL[trackerMark]} className="w-fit">
              {trackerMark} {MARK_LABEL[trackerMark].toLowerCase()}
            </Badge>
          )}
          {view === "step" && hasSteps ? (
            <Steps
              scorecard={scorecard}
              track={session.track}
              steps={session.steps}
              pins={session.pins}
              elements={board}
              notes={session.stepNotes}
              summaries={session.stepSummaries}
            />
          ) : (
            <DimensionsTable scorecard={scorecard} />
          )}
          {lld ? <ScenarioTable scorecard={scorecard} /> : null}
        </TabsContent>

        {hasTime ? (
          <TabsContent value="time" className="pt-4">
            <TimingSection scorecard={scorecard} />
          </TabsContent>
        ) : null}

        <TabsContent value="judge" className="pt-4">
          <JudgeSaw
            imageUrl={boardImageUrl}
            graphText={graphText}
            code={code}
            lld={lld}
            theme={theme}
            track={session.track}
            answers={session.stepNotes}
            lint={scorecard.lintIssues ?? []}
          />
        </TabsContent>

        {hasReference && session.reference ? (
          <TabsContent value="reference" className="pt-4">
            <ReferenceAnswer reference={session.reference} />
          </TabsContent>
        ) : null}
      </Tabs>
    </section>
  );
}
