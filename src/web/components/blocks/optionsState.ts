import type { ChatItem, SendChatOptions } from "../../session/types";

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

/** Appends a prefill starter without discarding notes the candidate has already begun typing. */
export function mergePrefillDraft(existing: string, incoming: string): string {
  if (existing.trim() === "") return incoming;
  if (existing.trim() === incoming.trim()) return existing;
  return `${existing.replace(/[ \t]+$/, "")}${existing.endsWith("\n") ? "" : " "}${incoming}`;
}

export interface OptionChoiceHandlers {
  disabled: boolean;
  onSend: (text: string, opts?: SendChatOptions) => boolean;
  onPrefill: (text: string) => void;
  onFocusComposer: () => void;
}

export function applyOptionChoice(text: string, action: "send" | "prefill", handlers: OptionChoiceHandlers): boolean {
  if (handlers.disabled) return false;
  if (action === "prefill") {
    handlers.onPrefill(text);
    return true;
  }
  const sent = handlers.onSend(text, { fromOption: true });
  if (sent) handlers.onFocusComposer();
  return sent;
}

export interface FocusableComposerInput {
  focus(): void;
  setSelectionRange(start: number, end: number): void;
}

export function applyPrefillToComposer(existingDraft: string, incomingText: string, disabled: boolean, input: FocusableComposerInput | null): string {
  const merged = mergePrefillDraft(existingDraft, incomingText);
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
