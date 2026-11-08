import { useEffect, useState, type ReactNode } from "react";
import { isOpenRound } from "../../shared/today";
import type { SessionHistoryItem } from "../../shared/types";
import { ConfirmModal } from "../components/ConfirmModal";
import { DiscardNote } from "../components/DiscardNote";
import { WarnIcon } from "../components/icons";
import { PageHeader, PageShell } from "../components/PageShell";
import { Alert, Badge, Button, Card, EmptyState, Skeleton, Tooltip } from "../components/ui";
import { MODE_LABEL, TRACK_LABEL, formatDateTime, type Tone } from "../lib/format";
import { useStudyData, type StudyData } from "../lib/useStudyData";
import { attemptBadge } from "../lib/verdict";
import { Link } from "../router";
import type { PageContext } from "./context";

const SHOWN = 15;

const STATUS_LABEL: Record<SessionHistoryItem["status"], { label: string; tone: Tone }> = {
  live: { label: "Unfinished", tone: "warn" },
  paused: { label: "Unfinished", tone: "warn" },
  ended: { label: "Round ended", tone: "neutral" },
  debriefing: { label: "Debriefing", tone: "accent" },
  debriefed: { label: "Debriefed", tone: "neutral" },
  failed: { label: "Debrief failed", tone: "bad" },
};

function Th({ children }: { children?: ReactNode }) {
  return (
    <th scope="col" className="px-5 py-3 text-meta font-semibold text-muted-foreground">
      {children}
    </th>
  );
}

export function HistoryView({ data, ctx }: { data: StudyData; ctx: PageContext }) {
  const { history } = data;
  const [all, setAll] = useState(false);
  const [confirm, setConfirm] = useState<SessionHistoryItem | null>(null);
  const shown = history ? (all ? history : history.slice(0, SHOWN)) : [];

  return (
    <PageShell testMode={ctx.testMode}>
      <div className="reveal-children space-y-6">
        <PageHeader
          title="History"
          aside={
            history && history.length > 0 ? (
              <span className="text-ui text-muted-foreground">
                {history.length} {history.length === 1 ? "round" : "rounds"}
              </span>
            ) : undefined
          }
        />
        {data.actionError ? (
          <Alert tone="bad" role="alert" icon={<WarnIcon size={16} />}>
            {data.actionError}
          </Alert>
        ) : null}
        {history === null ? (
          <Card className="space-y-3 p-5" role="status">
            <span className="sr-only">Loading rounds…</span>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </Card>
        ) : history.length === 0 ? (
          <EmptyState title="Your finished rounds will appear here." />
        ) : (
          <Card variant="raised" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] border-collapse text-left text-ui">
                <thead className="border-b border-border">
                  <tr>
                    <Th>Date</Th>
                    <Th>Problem</Th>
                    <Th>Mode</Th>
                    <Th>Result</Th>
                    <Th>
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shown.map((item) => {
                    const open = isOpenRound(item);
                    const status = STATUS_LABEL[item.status];
                    const attempt = attemptBadge(item);
                    const label = `${item.title}, ${formatDateTime(item.createdAt)}`;
                    const openLabel = open ? "Finish" : item.status === "debriefed" ? "Open debrief" : "Open";
                    const discardButton = (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="hover:text-destructive"
                        aria-label={`Discard: ${label}`}
                        disabled={item.status === "debriefing" || data.working !== null}
                        busy={data.working === item.id}
                        onClick={() => setConfirm(item)}
                      >
                        Discard
                      </Button>
                    );
                    return (
                      <tr key={item.id} className="transition-colors hover:bg-accent/40">
                        <td className="whitespace-nowrap px-5 py-3 font-mono text-meta tabular-nums text-muted-foreground">{formatDateTime(item.createdAt)}</td>
                        <td className="px-5 py-3">
                          <span className="text-body font-semibold">{item.title}</span>
                          <span className="ml-2 text-meta font-semibold text-muted-foreground">{TRACK_LABEL[item.track]}</span>
                        </td>
                        <td className="px-5 py-3 text-muted-foreground">{MODE_LABEL[item.mode]}</td>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {open ? (
                              <Badge tone={status.tone}>{status.label}</Badge>
                            ) : attempt ? (
                              <Badge tone={attempt.tone}>{attempt.label}</Badge>
                            ) : (
                              <Badge tone={status.tone}>{status.label}</Badge>
                            )}
                            {item.status === "debriefed" ? <Badge tone={item.notesSaved ? "good" : "neutral"}>{item.notesSaved ? "Notes saved" : "Notes not saved"}</Badge> : null}
                          </div>
                        </td>
                        <td className="px-5 py-2.5">
                          <div className="flex items-center justify-end gap-2">
                            <Button asChild size="sm" variant="secondary">
                              <Link href={`/session/${item.id}`} aria-label={`${openLabel}: ${label}`}>
                                {openLabel}
                              </Link>
                            </Button>
                            {item.status === "debriefing" ? (
                              // A disabled button takes no pointer events, so the hover target is the wrapper.
                              <Tooltip content="The debrief is running. Discard is possible once it finishes.">
                                <span className="inline-flex">{discardButton}</span>
                              </Tooltip>
                            ) : (
                              discardButton
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {history.length > SHOWN ? (
              <div className="border-t border-border px-5 py-3">
                <Button size="sm" variant="ghost" onClick={() => setAll((value) => !value)}>
                  {all ? "Show fewer" : `Show all ${history.length}`}
                </Button>
              </div>
            ) : null}
          </Card>
        )}
      </div>

      {confirm ? (
        <ConfirmModal
          title="Discard this round?"
          confirmLabel="Discard round"
          cancelLabel="Keep the round"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const item = confirm;
            setConfirm(null);
            void data.discard(item.id);
          }}
        >
          <p className="mb-2 font-semibold">
            {confirm.title}, {formatDateTime(confirm.createdAt)}
          </p>
          <DiscardNote track={confirm.track} />
        </ConfirmModal>
      ) : null}
    </PageShell>
  );
}

export function HistoryPage({ ctx }: { ctx: PageContext }) {
  const data = useStudyData();
  useEffect(() => {
    document.title = "History · Sparmate";
  }, []);
  return <HistoryView data={data} ctx={ctx} />;
}
