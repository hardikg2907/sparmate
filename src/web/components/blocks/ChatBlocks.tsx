import type { AnchorTarget, ChatBlock } from "../../../shared/blocks";
import { cn } from "../ui";
import { AnchorBlock } from "./AnchorBlock";
import { CalloutBlock } from "./CalloutBlock";
import { DiagramBlock } from "./DiagramBlock";
import { KvBlock } from "./KvBlock";
import { OptionsBlock } from "./OptionsBlock";

export interface ChatBlocksProps {
  blocks: readonly ChatBlock[];
  hasProse?: boolean;
  settled: boolean;
  disabled: boolean;
  answeredText?: string | null;
  onChoose: (text: string, action: "send" | "prefill") => boolean;
  onAnchor?: (target: AnchorTarget) => void;
}

export function ChatBlocks({ blocks, hasProse = true, settled, disabled, answeredText, onChoose, onAnchor }: ChatBlocksProps) {
  if (blocks.length === 0) return null;

  return (
    <div className={cn("flex flex-col gap-2.5", hasProse ? "mt-2.5" : "mt-0.5")}>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "options":
            return <OptionsBlock key={index} block={block} settled={settled} disabled={disabled} answeredText={answeredText} onChoose={onChoose} />;
          case "diagram":
            return <DiagramBlock key={index} block={block} />;
          case "anchor":
            return <AnchorBlock key={index} block={block} onAnchor={onAnchor} />;
          case "callout":
            return <CalloutBlock key={index} block={block} />;
          case "kv":
            return <KvBlock key={index} block={block} />;
        }
      })}
    </div>
  );
}
