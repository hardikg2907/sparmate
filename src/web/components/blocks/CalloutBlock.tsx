import type { CalloutBlock as CalloutBlockType } from "../../../shared/blocks";
import { Markdown } from "../Markdown";

export interface CalloutBlockProps {
  block: CalloutBlockType;
}

export function CalloutBlock({ block }: CalloutBlockProps) {
  return (
    <div className="min-w-0 rounded-r-md border-l-2 border-primary/70 bg-raised/70 px-3 py-2 [overflow-wrap:anywhere]">
      {block.label ? <p className="mb-0.5 min-w-0 text-meta font-semibold [overflow-wrap:anywhere] text-muted-foreground">{block.label}</p> : null}
      <Markdown text={block.text} className="min-w-0 text-ui [overflow-wrap:anywhere] text-foreground" />
    </div>
  );
}
