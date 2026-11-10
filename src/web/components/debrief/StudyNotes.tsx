import { useEffect, useMemo, useRef, useState } from "react";
import type { Proposal, ProposalOp, Session } from "../../../shared/types";
import { formatDateTime } from "../../lib/format";
import type { NotesState } from "../../session/types";
import { CheckIcon, CrossIcon, InfoIcon, WarnIcon } from "../icons";
import { Alert, Badge, Button, Card, Checkbox, Label, SectionTitle, Spinner, toast } from "../ui";
import { DiffView } from "./DiffView";

interface StudyNotesProps {
  notes: NotesState;
  /** The saved state the server keeps, so a reload still shows that the notes were written. */
  saved: Session["studyNotes"];
  enabled: boolean;
  onDraft: () => void;
  onApply: (proposalId: string, opIds: string[]) => void;
}

export function StudyNotes({ notes, saved, enabled, onDraft, onApply }: StudyNotesProps) {
  const { proposal, drafting } = notes;
  // Compares by object identity: a second save of the same draft is a new result and should confirm again.
  const announced = useRef(notes.result);
  useEffect(() => {
    const result = notes.result;
    if (result === announced.current) return;
    announced.current = result;
    if (result && result.applied.length > 0 && result.failed.length === 0 && notes.proposal?.status !== "stale") {
      toast.success("Study notes saved");
    }
  }, [notes.result, notes.proposal]);
  return (
    <section id="notes" aria-labelledby="notes-heading" className="scroll-mt-4">
      <SectionTitle id="notes-heading" aside={saved && saved.appliedCount > 0 ? undefined : "Draft once the gaps are done. You can draft any time."}>
        Study notes
      </SectionTitle>
      {drafting ? (
        <Card variant="raised" className="p-5">
          <Spinner label="Drafting study notes. This can take a minute." />
        </Card>
      ) : proposal ? (
        <ProposalView key={proposal.id} proposal={proposal} notes={notes} saved={saved} enabled={enabled} onDraft={onDraft} onApply={onApply} />
      ) : saved && saved.appliedCount > 0 ? (
        <Card variant="raised" className="flex flex-wrap items-center justify-between gap-4 p-5">
          <p className="flex items-center gap-2 text-body text-foreground" role="status">
            <CheckIcon size={16} className="text-success" />
            <span>
              Saved {saved.appliedCount} {saved.appliedCount === 1 ? "change" : "changes"} to your study files
              {saved.savedAt ? ` on ${formatDateTime(saved.savedAt)}` : ""}.
            </span>
          </p>
          <Button onClick={onDraft} disabled={!enabled}>
            Draft again
          </Button>
        </Card>
      ) : (
        <Card variant="raised" className="flex flex-wrap items-center justify-between gap-4 p-5">
          <p className="max-w-xl text-body leading-relaxed text-muted-foreground">
            Draft updates to your tracker, review questions and notes from this round and the coach chat. Nothing is written until you read the changes and save.
          </p>
          <Button variant="outline" onClick={onDraft} disabled={!enabled}>
            Draft study notes
          </Button>
        </Card>
      )}
    </section>
  );
}

function ProposalView({ proposal, notes, enabled, onDraft, onApply }: { proposal: Proposal } & StudyNotesProps) {
  const stale = proposal.status === "stale";
  const done = proposal.status === "applied";
  const applied = useMemo(() => new Set(notes.result?.applied ?? []), [notes.result]);
  const failed = useMemo(() => new Map((notes.result?.failed ?? []).map((f) => [f.opId, f.reason])), [notes.result]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(proposal.ops.filter((op) => !op.blocked).map((op) => op.id)));

  const groups = useMemo(() => {
    const byFile = new Map<string, ProposalOp[]>();
    for (const op of proposal.ops) byFile.set(op.file, [...(byFile.get(op.file) ?? []), op]);
    return [...byFile];
  }, [proposal.ops]);

  const toSave = proposal.ops.filter((op) => selected.has(op.id) && !op.blocked && !applied.has(op.id));
  const locked = stale || done || notes.applying;

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-4">
      {stale ? (
        <Alert
          tone="warn"
          role="alert"
          icon={<WarnIcon size={16} />}
          actions={
            <Button size="sm" onClick={onDraft} disabled={!enabled}>
              Draft again
            </Button>
          }
        >
          A file changed since this draft, so nothing was written. Draft again to match the current files.
        </Alert>
      ) : (
        <div className="flex items-start justify-between gap-4">
          <p className="flex min-w-0 items-start gap-2 text-ui text-muted-foreground">
            <InfoIcon size={16} className="mt-0.5 shrink-0" />
            <span>
              This draft has {proposal.ops.length} {proposal.ops.length === 1 ? "change" : "changes"} in {groups.length} {groups.length === 1 ? "file" : "files"}. Read each one and
              untick what you do not want. Only ticked changes are saved.
            </span>
          </p>
          <Button size="sm" onClick={onDraft} disabled={!enabled || notes.applying}>
            Draft again
          </Button>
        </div>
      )}

      {notes.result ? <ApplyResult proposal={proposal} result={notes.result} stale={stale} /> : null}

      {groups.map(([file, ops]) => {
        const diff = proposal.diffs.find((d) => d.file === file);
        return (
          <Card key={file} variant="raised" className="overflow-hidden">
            <h3 className="border-b border-border bg-muted px-4 py-2 font-mono text-ui font-semibold">{file}</h3>
            <ul className="divide-y divide-border px-2 py-1">
              {ops.map((op) => {
                const id = `op-${proposal.id}-${op.id}`;
                const saved = applied.has(op.id);
                const reason = failed.get(op.id);
                return (
                  <li key={op.id} className="flex items-start gap-3 px-2 py-2.5">
                    <Checkbox
                      id={id}
                      className="mt-px"
                      checked={selected.has(op.id) && !op.blocked && !stale}
                      disabled={Boolean(op.blocked) || saved || locked}
                      onCheckedChange={() => toggle(op.id)}
                      aria-label={`${op.summary} (${op.file})`}
                    />
                    <Label htmlFor={id} className="min-w-0 flex-1 font-normal leading-snug text-foreground peer-disabled:opacity-100">
                      <span className="font-medium text-foreground">{op.summary}</span>
                      {op.blocked ? <span className="mt-0.5 block text-meta text-warning">Cannot be applied: {op.blocked}</span> : null}
                      {reason && !stale ? <span className="mt-0.5 block text-meta text-destructive">Not saved: {reason}</span> : null}
                    </Label>
                    {saved ? (
                      <Badge tone="good">
                        <CheckIcon size={12} />
                        Saved
                      </Badge>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {diff ? (
              <div className="border-t border-border p-3">
                <DiffView file={file} diff={diff.diff} />
              </div>
            ) : null}
          </Card>
        );
      })}

      {!stale ? (
        <div className="flex items-center justify-end gap-3">
          <span className="text-ui text-muted-foreground" aria-live="polite">
            {toSave.length === 0 ? "Nothing ticked" : `${toSave.length} ${toSave.length === 1 ? "change" : "changes"} ticked`}
          </span>
          <Button
            variant="default"
            busy={notes.applying}
            disabled={toSave.length === 0 || locked || !enabled}
            onClick={() =>
              onApply(
                proposal.id,
                toSave.map((op) => op.id),
              )
            }
          >
            Save selected
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ApplyResult({ proposal, result, stale }: { proposal: Proposal; result: NonNullable<NotesState["result"]>; stale: boolean }) {
  const summaryOf = (id: string) => proposal.ops.find((op) => op.id === id);
  // A stale draft already has its own banner, and every change failing for the same reason adds only noise.
  if (stale) return null;
  return (
    <Card variant="raised" className="p-4" role="status">
      {result.applied.length > 0 ? (
        <div>
          <h3 className="flex items-center gap-2 text-ui font-semibold text-success">
            <CheckIcon size={16} />
            Saved {result.applied.length} {result.applied.length === 1 ? "change" : "changes"}
          </h3>
          <ul className="mt-1.5 space-y-0.5 pl-6 text-ui text-muted-foreground">
            {result.applied.map((id) => (
              <li key={id}>
                {summaryOf(id)?.summary ?? id} <span className="font-mono text-meta">({summaryOf(id)?.file})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.failed.length > 0 ? (
        <div className={result.applied.length > 0 ? "mt-3 border-t border-border pt-3" : undefined}>
          <h3 className="flex items-center gap-2 text-ui font-semibold text-destructive">
            <CrossIcon size={16} />
            {result.failed.length} {result.failed.length === 1 ? "change was" : "changes were"} not saved
          </h3>
          <ul className="mt-1.5 space-y-0.5 pl-6 text-ui text-muted-foreground">
            {result.failed.map((failure) => (
              <li key={failure.opId}>
                {summaryOf(failure.opId)?.summary ?? failure.opId}: {failure.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
