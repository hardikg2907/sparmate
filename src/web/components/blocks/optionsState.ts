import { CHAT_MAX_CHARS } from "../../lib/contract";
import type { ChatItem } from "../../session/types";

export interface OptionsSettlement {
  settled: boolean;
  answeredText: string | null;
}

/**
 * Settles an assistant options block once any non-system turn follows it. A later guide or coach message
 * (such as a step check, stuck walkthrough, or silence prompt) closes earlier choices without marking one picked.
 */
export function resolveOptionsState(items: readonly ChatItem[], index: number): OptionsSettlement {
  if (index < 0 || index >= items.length) {
    return { settled: false, answeredText: null };
  }
  for (let i = index + 1; i < items.length; i++) {
    const item = items[i];
    if (!item || item.role === "system") continue;
    if (item.role === "candidate") {
      return { settled: true, answeredText: item.text };
    }
    return { settled: true, answeredText: null };
  }
  return { settled: false, answeredText: null };
}

/**
 * Replaces an unedited starter when the candidate tries another prefill option, appends only once they have
 * added their own words, and caps the draft at the wire character limit.
 */
export function mergePrefillDraft(existing: string, incoming: string, lastPrefill: string | null = null, maxChars: number = CHAT_MAX_CHARS): string {
  if (existing.trim() === "") return incoming.slice(0, maxChars);
  if (lastPrefill !== null && lastPrefill.trim() !== "" && existing.trim() === lastPrefill.trim()) {
    return incoming.slice(0, maxChars);
  }
  if (existing.trim() === incoming.trim()) return existing.slice(0, maxChars);
  return `${existing.replace(/[ \t]+$/, "")}${existing.endsWith("\n") ? "" : " "}${incoming}`.slice(0, maxChars);
}

/** Touch devices lack a fine pointer, so focusing the textarea after an immediate send would pop the keyboard over the reply. */
export function prefersFinePointer(matchMediaFn?: ((query: string) => { matches: boolean }) | null): boolean {
  const mm = matchMediaFn !== undefined ? matchMediaFn : typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia.bind(window) : null;
  if (!mm) return true;
  return Boolean(mm("(pointer: fine)").matches);
}

export interface OptionChoiceHandlers {
  disabled: boolean;
  onSend: (text: string) => boolean;
  onPrefill: (text: string) => void;
  onFocusComposer: () => void;
  onFocusGroup?: () => void;
  matchMedia?: ((query: string) => { matches: boolean }) | null;
}

export function applyOptionChoice(text: string, action: "send" | "prefill", handlers: OptionChoiceHandlers): boolean {
  if (handlers.disabled) return false;
  if (action === "prefill") {
    handlers.onPrefill(text);
    return true;
  }
  const sent = handlers.onSend(text);
  if (sent) {
    if (prefersFinePointer(handlers.matchMedia)) {
      handlers.onFocusComposer();
    } else {
      handlers.onFocusGroup?.();
    }
  }
  return sent;
}

export interface FocusableComposerInput {
  focus(): void;
  setSelectionRange(start: number, end: number): void;
}

export interface FocusableOptionsGroup {
  focus(): void;
}

export function applyPrefillToComposer(
  existingDraft: string,
  incomingText: string,
  disabled: boolean,
  input: FocusableComposerInput | null,
  lastPrefill: string | null = null,
  maxChars: number = CHAT_MAX_CHARS,
): string {
  const merged = mergePrefillDraft(existingDraft, incomingText, lastPrefill, maxChars);
  if (input && !disabled) {
    input.focus();
    const end = merged.length;
    input.setSelectionRange(end, end);
  }
  return merged;
}

export function focusComposerInput(disabled: boolean, input: Pick<FocusableComposerInput, "focus"> | null): boolean {
  if (disabled || !input) return false;
  input.focus();
  return true;
}

export function focusSettledOptionsGroup(settled: boolean, pendingFocus: boolean, group: FocusableOptionsGroup | null): boolean {
  if (!settled || !pendingFocus || !group) return false;
  group.focus();
  return true;
}
