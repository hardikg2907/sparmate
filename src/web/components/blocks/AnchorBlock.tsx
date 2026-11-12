import type { AnchorBlock as AnchorBlockType, AnchorTarget } from "../../../shared/blocks";

export interface AnchorBlockProps {
  block: AnchorBlockType;
  onAnchor?: (target: AnchorTarget) => void;
}

function BoardFrameGlyph() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="mt-0.5 shrink-0 text-primary"
    >
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <rect x="8" y="8" width="8" height="8" rx="1.5" />
    </svg>
  );
}

export function AnchorBlock({ block, onAnchor }: AnchorBlockProps) {
  const badge =
    block.target.kind === "board" ? (
      <BoardFrameGlyph />
    ) : (
      <span className="mt-0.5 shrink-0 font-mono text-meta font-semibold tabular-nums text-primary">
        {block.target.endLine !== undefined && block.target.endLine > block.target.line ? `L${block.target.line}–${block.target.endLine}` : `L${block.target.line}`}
      </span>
    );

  const body = (
    <span className="min-w-0 flex-1">
      <span className="block text-ui font-medium text-foreground">{block.label}</span>
      {block.note ? <span className="mt-0.5 block text-meta text-muted-foreground">{block.note}</span> : null}
    </span>
  );

  if (!onAnchor) {
    return (
      <div className="flex w-full items-start gap-2.5 rounded-md border border-border bg-raised/60 px-3 py-2 text-left">
        {badge}
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onAnchor(block.target)}
      className="group flex w-full items-start justify-between gap-2.5 rounded-md border border-border bg-raised/60 px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex min-w-0 flex-1 items-start gap-2.5">
        {badge}
        {body}
      </span>
      <span aria-hidden="true" className="mt-0.5 shrink-0 font-mono text-meta text-muted-foreground transition-colors group-hover:text-foreground">
        →
      </span>
    </button>
  );
}
