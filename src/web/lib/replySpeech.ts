import type { ChatItem } from "../session/types";

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
