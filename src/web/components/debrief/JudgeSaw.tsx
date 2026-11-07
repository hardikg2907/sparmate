import { useState } from "react";
import { CodeEditor } from "../../code/CodeEditor";
import { phasesFor, type Track } from "../../../shared/phases";
import { StepAnswers } from "../StepAnswers";
import type { CodeState } from "../../session/types";
import type { Theme } from "../../theme";
import { Card, SectionTitle, Tooltip } from "../ui";

interface JudgeSawProps {
  imageUrl: string;
  graphText: string;
  /** Present for LLD rounds. */
  code: CodeState | null;
  lld: boolean;
  theme: Theme;
  track: Track;
  /** His written step answers, as the judge read them. */
  answers: Readonly<Record<string, string>>;
}

export function JudgeSaw({ imageUrl, graphText, code, lld, theme, track, answers }: JudgeSawProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const text = graphText.trim();

  return (
    <section id="judge-saw" aria-labelledby="judge-saw-heading" className="scroll-mt-14">
      <SectionTitle id="judge-saw-heading" aside="The record the judge read">
        What the judge saw
      </SectionTitle>
      <div className="space-y-4">
        <Card variant="raised" className="p-4 sm:p-5">
          <h3 className="mb-2 text-ui font-semibold text-muted-foreground">Final board</h3>
          {imageFailed ? (
            <p className="rounded-lg border border-dashed border-input px-3 py-6 text-center text-ui text-muted-foreground">No board image was saved for this round.</p>
          ) : (
            <Tooltip content="Open the full-size image">
              <a href={imageUrl} target="_blank" rel="noopener noreferrer" className="inline-block rounded-lg">
                <img
                  src={imageUrl}
                  alt="The whiteboard as it stood when the round ended"
                  onError={() => setImageFailed(true)}
                  className="max-h-[26rem] w-auto max-w-full rounded-md border border-border bg-card"
                />
              </a>
            </Tooltip>
          )}
        </Card>

        <Card variant="raised" className="p-4 sm:p-5">
          <h3 className="mb-2 text-ui font-semibold text-muted-foreground">Board as text</h3>
          {text ? (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted p-3 font-mono text-ui leading-relaxed" tabIndex={0}>
              {text}
            </pre>
          ) : (
            <p className="text-ui text-muted-foreground">The board was empty.</p>
          )}
        </Card>

        {Object.values(answers).some((text) => text.trim() !== "") ? (
          <Card variant="raised" className="overflow-hidden">
            <StepAnswers phases={phasesFor(track)} currentPhase="" texts={answers} />
          </Card>
        ) : null}

        {lld ? (
          <Card variant="raised" className="p-4 sm:p-5">
            <h3 className="mb-2 text-ui font-semibold text-muted-foreground">Final code</h3>
            {code ? (
              <div className="h-[22rem] overflow-hidden rounded-md border border-border [&>*]:h-full [&>*]:w-full">
                <CodeEditor value={code.content} version={code.version} diagnostics={[]} theme={theme} readOnly />
              </div>
            ) : (
              <p className="text-ui text-muted-foreground">The final code is not available.</p>
            )}
          </Card>
        ) : null}
      </div>
    </section>
  );
}
