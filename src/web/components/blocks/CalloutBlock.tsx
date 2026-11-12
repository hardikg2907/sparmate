import type { CalloutBlock as CalloutBlockType } from "../../../shared/blocks";
import { Markdown } from "../Markdown";

export interface CalloutBlockProps {
  block: CalloutBlockType;
}

export function CalloutBlock({ block }: CalloutBlockProps) {
  return (
    <div className="rounded-r-md border-l-2 border-primary/70 bg-raised/70 px-3 py-2">
      {block.label ? <p className="mb-0.5 text-meta font-semibold text-muted-foreground">{block.label}</p> : null}
      <Markdown text={block.text} className="text-ui text-foreground" />
    </div>
  );
}
