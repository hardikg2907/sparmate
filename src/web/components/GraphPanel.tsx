import { useEffect } from "react";
import { splitGraphText } from "../lib/graphText";
import type { GraphState, SessionActions } from "../session/types";
import { CrossIcon, EyeIcon, WarnIcon } from "./icons";
import { Alert, Badge, Button, Tooltip } from "./ui";

/**
 * The board as the interviewer reads it: plain text, built from the boxes and arrows. Showing it lets the
 * candidate fix an unlabeled box or a loose arrow before the interviewer misreads it.
 */
export function GraphPanel({ graph, actions, onClose }: { graph: GraphState; actions: SessionActions; onClose: () => void }) {
  useEffect(() => {
    // Ask for the current text on open and after each board change, so the panel never depends on a
    // push message having reached this tab.
    actions.refreshGraph();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = actions.onBoardActivity(() => {
      clearTimeout(timer);
      timer = setTimeout(actions.refreshGraph, 1600);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [actions]);

  const parsed = splitGraphText(graph.text);
  const warnings = graph.warnings.length > 0 ? graph.warnings : parsed.warnings;
  const body = parsed.body.trim();

  return (
    <section aria-label="What the interviewer sees" className="absolute inset-x-0 bottom-0 z-30 flex max-h-[52%] min-h-[9rem] animate-in fade-in-0 slide-in-from-bottom-1 duration-200 flex-col rounded-t-lg border-x border-t border-border bg-card shadow-md">
      <header className="flex items-center justify-between gap-3 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <EyeIcon size={16} className="shrink-0 text-muted-foreground" />
          <h2 className="shrink-0 whitespace-nowrap text-ui font-semibold">What the interviewer sees</h2>
          {warnings.length > 0 ? (
            <Badge tone="warn" className="tabular-nums">
              {warnings.length === 1 ? "1 warning" : `${warnings.length} warnings`}
            </Badge>
          ) : null}
          <span className="hidden min-w-0 truncate text-meta text-muted-foreground md:inline">The text form of your board. Label every box and connect every arrow so it reads correctly.</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="ghost" onClick={actions.refreshGraph}>
            Refresh
          </Button>
          <Tooltip content="Hide what the interviewer sees">
            <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Hide what the interviewer sees">
              <CrossIcon size={14} />
            </Button>
          </Tooltip>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
        {warnings.length > 0 ? (
          <Alert tone="warn" icon={<WarnIcon size={14} />} className="mb-2 py-2">
            <ul className="space-y-1" aria-label="Board warnings">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {body ? (
          <pre className="whitespace-pre-wrap break-words rounded-lg border border-border bg-muted p-3 font-mono text-ui leading-relaxed text-foreground">{body}</pre>
        ) : (
          <p className="rounded-lg border border-dashed border-input px-3 py-4 text-ui text-muted-foreground">The board is empty. The interviewer sees nothing until something is drawn.</p>
        )}
      </div>
    </section>
  );
}
