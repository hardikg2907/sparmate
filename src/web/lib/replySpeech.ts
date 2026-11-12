import { blocksToSpeechText } from "../../shared/blocks";
import type { ChatItem } from "../session/types";
import { cleanMarkdownForSpeech } from "./speechCleaning";
import { splitSentences } from "./speechSentences";

function isReply(item: ChatItem): boolean {
  return item.role !== "candidate" && item.role !== "system";
}

/**
 * The reply to read aloud, or null. A reply counts as heard once it is finished, interrupted or arrived while
 * speech was off, and a heard reply stays silent unless it is the one being read now.
 */
export function replyToSpeak(items: readonly ChatItem[], heard: ReadonlySet<string>, activeId: string | null): ChatItem | null {
  const latest = items.findLast(isReply);
  if (!latest) return null;
  if (heard.has(latest.id) && activeId !== latest.id) return null;
  return latest;
}

/** Marks every reply on screen as heard, so speech that comes back on starts with the next one. */
export function markRepliesHeard(items: readonly ChatItem[], heard: Set<string>): void {
  for (const item of items) if (isReply(item)) heard.add(item.id);
}

/**
 * Sentences to speak for an assistant turn. Streaming turns speak prose as it arrives; once done, a blocks-only turn
 * speaks every block's summary while a prose+blocks turn appends only callouts and options so visual diagrams and kv
 * rows are not read out redundantly.
 */
export function replySpeechSentences(item: ChatItem): string[] {
  const isFinal = item.state === "done";
  const hasProse = item.text.trim().length > 0;
  if (!isFinal || !item.blocks?.length) {
    const cleaned = cleanMarkdownForSpeech(item.text, isFinal);
    return splitSentences(cleaned, isFinal).sentences;
  }
  if (!hasProse) {
    const cleaned = cleanMarkdownForSpeech(blocksToSpeechText(item.blocks), true);
    return splitSentences(cleaned, true).sentences;
  }
  const proseSentences = splitSentences(cleanMarkdownForSpeech(item.text, true), true).sentences;
  const spokenBlocks = item.blocks.filter((b) => b.kind === "callout" || b.kind === "options");
  if (spokenBlocks.length === 0) return proseSentences;
  const blockSentences = splitSentences(cleanMarkdownForSpeech(blocksToSpeechText(spokenBlocks), true), true).sentences;
  return [...proseSentences, ...blockSentences];
}
