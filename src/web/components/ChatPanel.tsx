import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { blocksToSpeechText, type AnchorTarget } from "../../shared/blocks";
import { useVoiceInput } from "../hooks/useVoiceInput";
import { useVoiceOutput } from "../hooks/useVoiceOutput";
import { CHAT_MAX_CHARS } from "../lib/contract";
import { followAfterScroll, scrollsBack } from "../lib/chatScroll";
import { formatClock } from "../lib/format";
import { isPanelActiveAndVisible } from "../lib/panelVisibility";
import { useVoices, useVoiceSettings, type VoiceSettings } from "../lib/voiceSettings";
import type { AgentState, ChatItem } from "../session/types";
import { ChatBlocks } from "./blocks/ChatBlocks";
import { ChevronDownIcon, MicIcon, MicOffIcon, SendIcon, VolumeXIcon } from "./icons";
import { Markdown } from "./Markdown";
import { Button, Badge, Tooltip, cn } from "./ui";

// Runs once when a message mounts. Streaming updates keep the same element, so they do not replay it.
const ENTER = "animate-in fade-in-0 slide-in-from-bottom-1 duration-200";

const SPEECH_NOTE_KEY = "sparmate-speech-note-dismissed";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(SPEECH_NOTE_KEY) === "1";
  } catch {
    return false;
  }
}

/** The speech-pack note is asked once per browser: "Not now" keeps it away on later visits. */
function useSpeechNoteDismissed(): [boolean, () => void] {
  const [dismissed, setDismissed] = useState(readDismissed);
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(SPEECH_NOTE_KEY, "1");
    } catch {
      // The note then returns on the next visit, which is harmless.
    }
  };
  return [dismissed, dismiss];
}

interface ChatPanelProps {
  heading: string;
  /** Name shown on the other side's messages. */
  speaker: string;
  items: ChatItem[];
  agent: AgentState;
  /** Returns false when the message could not be sent, so the draft stays in the box. */
  onSend: (text: string) => boolean;
  inputLabel: string;
  placeholder: string;
  disabled?: boolean;
  empty?: ReactNode;
  tools?: ReactNode;
  showTimes?: boolean;
  headerExtra?: ReactNode;
  /** A row between the header and the conversation. It sits in the flow, so it never adds a scroller of its own. */
  topSlot?: ReactNode;
  /** Shown under the conversation while the other side's opening message is the only one. */
  afterOpening?: ReactNode;
  /** Called whenever the draft changes, typed or dictated. */
  onDraft?: () => void;
  /** Jumps to a board element or code line range referenced by an anchor block. */
  onAnchor?: (target: AnchorTarget) => void;
}

export function ChatPanel({
  heading,
  speaker,
  items,
  agent,
  onSend,
  inputLabel,
  placeholder,
  disabled,
  empty,
  tools,
  showTimes,
  headerExtra,
  topSlot,
  afterOpening,
  onDraft,
  onAnchor,
}: ChatPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastTop = useRef(0);
  const held = useRef(false);
  const [atBottom, setAtBottom] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null);
  const streaming = items.some((item) => item.state === "streaming");
  const busy = agent.state === "thinking" || streaming;

  // Track parent pane inert and hidden styling to silence inactive panels.
  useLayoutEffect(() => {
    const updateActive = () => {
      const visible = isPanelActiveAndVisible(panelRef.current);
      setIsActive(visible);
    };
    updateActive();

    if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
      const observer = new MutationObserver(updateActive);
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["inert", "aria-hidden", "class", "style"],
        subtree: true,
      });
      return () => {
        observer.disconnect();
      };
    }
  }, []);

  const effectiveDisabled = disabled === true || !isActive;

  const [voiceSettings] = useVoiceSettings();
  const voices = useVoices();
  const { isSpeaking, stopSpeaking } = useVoiceOutput({
    items,
    disabled: effectiveDisabled,
    voiceSettings,
    voices,
  });

  // Escape key interrupts speaking immediately so the microphone resumes in half-duplex.
  useEffect(() => {
    if (!isSpeaking || !isActive) return;
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!isPanelActiveAndVisible(panelRef.current)) return;
        e.preventDefault();
        stopSpeaking();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSpeaking, isActive, stopSpeaking]);

  // A streaming reply changes many times a second, so the log is silent and a finished reply is read out once.
  const [announcement, setAnnouncement] = useState("");
  const seeded = useRef(false);
  const announced = useRef<string | null>(null);
  useEffect(() => {
    const last = items.findLast((item) => item.state === "done" && item.role !== "candidate" && item.role !== "system");
    if (!seeded.current) {
      seeded.current = true;
      announced.current = last?.id ?? null;
      return;
    }
    if (last && last.id !== announced.current) {
      announced.current = last.id;
      const prose = last.text.trim();
      const blockSpeech = blocksToSpeechText(last.blocks);
      const combined = [prose, blockSpeech].filter(Boolean).join(" ");
      if (combined) {
        setAnnouncement(`${speaker}: ${combined.slice(0, 500)}`);
      }
    }
  }, [items, speaker]);

  const stopFollowing = () => {
    stick.current = false;
    setAtBottom(false);
  };

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    stick.current = followAfterScroll(stick.current, {
      prevTop: lastTop.current,
      top: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    });
    lastTop.current = el.scrollTop;
    setAtBottom(stick.current);
  };

  // A streaming reply re-renders many times a second, and each render can land before the browser reports his
  // scroll. So intent is read from the input itself (wheel, key, a held pointer), not only from the scroll event.
  const onWheel = (e: { deltaY: number }) => {
    if (e.deltaY < 0) stopFollowing();
  };
  const onLogKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (scrollsBack(e.key)) stopFollowing();
  };
  const onPointerDown = () => {
    held.current = true;
    const release = () => {
      held.current = false;
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
  };

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current && !held.current) {
      el.scrollTop = el.scrollHeight;
      lastTop.current = el.scrollTop;
    }
  }, [items, busy]);

  const jumpToLatest = () => {
    const el = scroller.current;
    if (!el) return;
    stick.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  const handleSend = (text: string): boolean => {
    const sent = onSend(text);
    if (sent) stick.current = true;
    return sent;
  };

  const handlePrefill = (text: string): boolean => {
    if (effectiveDisabled) return false;
    setPrefill((prev) => ({ text, nonce: (prev?.nonce ?? 0) + 1 }));
    return true;
  };

  return (
    <section ref={panelRef} aria-label={heading} className="flex h-full min-h-0 flex-col bg-card">
      <header className="chat-head header-hairline flex h-11 shrink-0 items-center justify-between gap-2 px-4">
        <h2 className="text-ui font-bold">{heading}</h2>
        <div className="flex items-center gap-3">
          {isSpeaking ? (
            <Button type="button" variant="ghost" size="sm" onClick={stopSpeaking} className="text-primary-text" aria-label="Stop speaking">
              <VolumeXIcon size={14} />
              <span>Stop speaking</span>
            </Button>
          ) : null}
          <span className="flex items-center gap-1.5 text-meta text-muted-foreground">
            <span
              className={cn(
                "status-dot size-2 rounded-full",
                agent.state === "error" ? "bg-destructive-fill text-destructive-fill" : busy ? "animate-pulse bg-primary text-primary" : "bg-success-fill text-success-fill",
              )}
              aria-hidden="true"
            />
            {agent.state === "error" ? "Not answering" : busy ? "Thinking" : "Listening"}
          </span>
        </div>
        {headerExtra}
      </header>

      {topSlot}

      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          onScroll={onScroll}
          onWheel={onWheel}
          onKeyDown={onLogKeyDown}
          onPointerDown={onPointerDown}
          role="log"
          aria-label={`${heading} conversation`}
          aria-live="off"
          className="h-full overflow-y-auto px-4 py-4"
        >
          {items.length === 0 && !busy ? (
            <div className="px-2 py-8 text-center text-ui text-muted-foreground">{empty}</div>
          ) : (
            <ul className="space-y-5">
              {items.map((item, index) => {
                const isAssistant = item.role !== "candidate" && item.role !== "system";
                const nextCandidate = isAssistant && item.blocks?.length ? items.slice(index + 1).find((m) => m.role === "candidate") : undefined;
                return (
                  <Message
                    key={item.id}
                    item={item}
                    speaker={speaker}
                    showTime={showTimes === true}
                    settled={Boolean(nextCandidate)}
                    answeredText={nextCandidate?.text ?? null}
                    blocksDisabled={effectiveDisabled || agent.state === "thinking"}
                    onChoose={(text, action) => (action === "prefill" ? handlePrefill(text) : handleSend(text))}
                    onAnchor={onAnchor}
                  />
                );
              })}
            </ul>
          )}
          {busy ? <Typing speaker={speaker} early={streaming} /> : null}
          {afterOpening && items.length === 1 && items[0]?.role === "interviewer" ? <div className="mt-4">{afterOpening}</div> : null}
        </div>
        <div className="sr-only" role="status" aria-live="polite">
          {announcement}
        </div>
        {!atBottom ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <Button type="button" variant="outline" size="sm" onClick={jumpToLatest} className="pointer-events-auto pop-in rounded-full shadow-md">
              <ChevronDownIcon size={14} />
              Jump to latest
            </Button>
          </div>
        ) : null}
      </div>

      <Composer
        label={inputLabel}
        placeholder={placeholder}
        disabled={effectiveDisabled}
        isActive={isActive}
        isSpeaking={isSpeaking}
        tools={tools}
        voiceSettings={voiceSettings}
        prefill={prefill}
        onBargeIn={stopSpeaking}
        onDraft={onDraft}
        onSend={handleSend}
      />
    </section>
  );
}

function Message({
  item,
  speaker,
  showTime,
  settled,
  answeredText,
  blocksDisabled,
  onChoose,
  onAnchor,
}: {
  item: ChatItem;
  speaker: string;
  showTime: boolean;
  settled: boolean;
  answeredText: string | null;
  blocksDisabled: boolean;
  onChoose: (text: string, action: "send" | "prefill") => boolean;
  onAnchor?: (target: AnchorTarget) => void;
}) {
  if (item.role === "system") {
    return (
      <li className={cn("flex items-center gap-3 px-1 text-meta text-faint", ENTER)} data-gap-divider={item.kind === "gap" ? item.text : undefined}>
        <span className="chat-rule-l h-px flex-1" aria-hidden="true" />
        <span className="max-w-[80%] text-center">{item.text}</span>
        <span className="chat-rule-r h-px flex-1" aria-hidden="true" />
      </li>
    );
  }
  const mine = item.role === "candidate";
  const time = showTime && item.at !== null ? <span className="font-mono tabular-nums text-faint">{formatClock(item.at)}</span> : null;
  if (mine) {
    return (
      // A sent message is replaced by the server's copy under a new key, so only the pending one slides in.
      <li className={cn("flex flex-col items-end pl-8", item.state === "pending" && ENTER)} aria-busy={item.state === "streaming" ? true : undefined}>
        <div className="mb-1 flex items-center gap-2 px-1 text-meta text-muted-foreground">
          <span className="font-semibold">You</span>
          {time}
        </div>
        <div
          className={cn(
            "chat-bubble max-w-full rounded-lg rounded-br-sm bg-primary-soft px-3.5 py-2.5 text-body text-primary-soft-foreground",
            item.state === "pending" && "opacity-70",
          )}
        >
          <p className="whitespace-pre-wrap break-words">{item.text}</p>
        </div>
        {item.state === "pending" ? <span className="mt-0.5 px-1 text-meta text-faint">Sending…</span> : null}
      </li>
    );
  }
  // The other side reads like a transcript rather than a bubble, so long replies with lists and code stay easy to scan.
  // The card sits on an inner element because `attention` and the enter animation both set `animation`.
  const extension = item.kind === "extension";
  const hasProse = item.text.trim().length > 0;
  return (
    <li className={cn("flex flex-col", ENTER, !extension && "pr-2")} aria-busy={item.state === "streaming" ? true : undefined}>
      <div className={cn("flex flex-col", extension && "chat-extension surface-raised rounded-lg bg-raised p-3 attention")}>
        <div className="mb-1 flex items-center gap-2 text-meta text-muted-foreground">
          <span aria-hidden="true" className="chat-avatar size-2 rounded-full" />
          <span className="font-semibold text-foreground">{speaker}</span>
          {time}
          {extension ? <Badge tone="accent">New requirement</Badge> : null}
          {item.kind === "hint" ? <Badge tone="warn">Hint</Badge> : null}
        </div>
        {hasProse ? <Markdown text={item.text} className="text-body text-foreground" /> : null}
        {item.blocks?.length ? (
          <ChatBlocks blocks={item.blocks} hasProse={hasProse} settled={settled} disabled={blocksDisabled} answeredText={answeredText} onChoose={onChoose} onAnchor={onAnchor} />
        ) : null}
      </div>
    </li>
  );
}

function Typing({ speaker, early }: { speaker: string; early: boolean }) {
  return (
    <div className={cn("mt-4 flex items-center", !early && "fade-in-late")} role="status">
      <div className="flex items-center gap-1 py-2" aria-hidden="true">
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" />
      </div>
      <span className="sr-only">{speaker} is typing</span>
    </div>
  );
}

function Composer({
  label,
  placeholder,
  disabled,
  isActive,
  isSpeaking,
  tools,
  prefill,
  onSend,
  onBargeIn,
  onDraft,
  voiceSettings,
}: {
  label: string;
  placeholder: string;
  disabled: boolean;
  isActive: boolean;
  isSpeaking: boolean;
  tools?: ReactNode;
  prefill: { text: string; nonce: number } | null;
  onSend: (text: string) => boolean;
  onBargeIn: () => void;
  onDraft?: () => void;
  voiceSettings: VoiceSettings;
}) {
  const [draft, setDraft] = useState("");
  const onDraftRef = useRef(onDraft);
  onDraftRef.current = onDraft;
  // Dictation fills the box through setDraft as well, so the draft itself is watched rather than the key presses.
  useEffect(() => {
    if (draft) onDraftRef.current?.();
  }, [draft]);
  const input = useRef<HTMLTextAreaElement>(null);
  // The room stays mounted behind the debrief, so two chat boxes can exist at once and each needs its own id.
  const inputId = useId();
  const prefillSeen = useRef<number>(0);

  const voiceInput = useVoiceInput({
    disabled,
    isActive,
    isSpeaking,
    useHeadphones: voiceSettings.useHeadphones,
    sendMode: voiceSettings.sendMode,
    onSend: (text) => {
      const sent = onSend(text);
      if (sent) {
        setDraft("");
        input.current?.focus();
      }
      return sent;
    },
    onBargeIn,
    draft,
    setDraft,
  });
  const { noteTypedDraft } = voiceInput;

  useEffect(() => {
    if (!prefill || prefill.nonce === prefillSeen.current) return;
    prefillSeen.current = prefill.nonce;
    setDraft(prefill.text);
    noteTypedDraft(prefill.text);
    const el = input.current;
    if (el && !disabled) {
      el.focus();
      const end = prefill.text.length;
      el.setSelectionRange(end, end);
    }
  }, [prefill, disabled, noteTypedDraft]);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [draft]);

  const submit = () => {
    if (disabled || draft.trim() === "") return;
    if (onSend(draft)) {
      setDraft("");
      voiceInput.resetSpokenDraft();
    }
    // The box keeps focus so a run of short answers needs no mouse.
    input.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  const nearLimit = draft.length > CHAT_MAX_CHARS * 0.9;
  const [noteDismissed, dismissNote] = useSpeechNoteDismissed();
  const showSpeechNote = voiceInput.availability.status === "downloadable" && (!noteDismissed || voiceInput.isInstalling);

  return (
    <footer className="composer-foot shrink-0 border-t border-border px-3 pb-2 pt-3">
      {showSpeechNote ? (
        <div className="speech-note mb-2 flex max-md:hidden items-center justify-between gap-2 rounded-md px-3 py-1.5 text-meta" role="note">
          <span className="min-w-0 font-semibold text-primary-soft-foreground">Voice input needs the speech pack.</span>
          <span className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              className="rounded-sm font-semibold text-primary-text hover:underline disabled:opacity-60"
              onClick={() => void voiceInput.installModel()}
              disabled={voiceInput.isInstalling || disabled}
            >
              {voiceInput.isInstalling ? "Downloading…" : "Install"}
            </button>
            {voiceInput.isInstalling ? null : (
              <button type="button" className="rounded-sm text-muted-foreground hover:text-foreground hover:underline" onClick={dismissNote}>
                Not now
              </button>
            )}
          </span>
        </div>
      ) : null}
      {tools ? <div className="mb-2 flex flex-wrap items-center gap-2">{tools}</div> : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="composer flex flex-col rounded-lg border border-input/70"
      >
        <label className="sr-only" htmlFor={inputId}>
          {label}
        </label>
        <textarea
          id={inputId}
          ref={input}
          rows={2}
          value={draft}
          maxLength={CHAT_MAX_CHARS}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => {
            setDraft(event.target.value);
            voiceInput.noteTypedDraft(event.target.value);
          }}
          onKeyDown={onKeyDown}
          className="min-h-[2.75rem] w-full resize-none bg-transparent px-3 pb-1 pt-2.5 text-body text-foreground placeholder:text-faint focus:outline-none disabled:cursor-not-allowed"
        />
        <div className="flex items-center gap-1.5 px-1.5 pb-1.5">
          <Tooltip content={voiceInput.isListening ? "Turn the microphone off" : "Turn the microphone on"} shortcut={["Ctrl", "M"]} side="top">
            <Button
              type="button"
              variant={voiceInput.isListening ? "destructive" : "secondary"}
              size="sm"
              onClick={voiceInput.toggleListening}
              disabled={disabled || voiceInput.disabledReason !== null}
              aria-label={voiceInput.disabledReason ?? (voiceInput.isListening ? "Stop listening (Ctrl+M)" : "Voice input (Ctrl+M)")}
              // A disabled button never opens the tooltip, so the reason it is off needs the native title.
              title={voiceInput.disabledReason ?? undefined}
              className={cn("px-2.5", voiceInput.isListening && "animate-pulse")}
            >
              {voiceInput.disabledReason ? <MicOffIcon size={15} /> : <MicIcon size={15} />}
              {voiceInput.isListening ? <span className="ml-1 text-meta">Listening</span> : null}
            </Button>
          </Tooltip>
          <Tooltip content="Send" shortcut={["Enter"]} side="top">
            <Button type="submit" variant="default" size="sm" disabled={disabled || draft.trim() === ""} className="ml-auto px-2.5" aria-label="Send message">
              <SendIcon size={15} />
              Send
            </Button>
          </Tooltip>
        </div>
      </form>
      <p className="mt-1.5 flex justify-between px-1 text-meta text-faint max-md:hidden">
        {voiceInput.isListening ? (
          <span className="flex items-center gap-1.5 font-medium text-primary">
            <span className="size-2 rounded-full bg-primary animate-pulse" aria-hidden="true" />
            Listening… (Ctrl+M to pause)
          </span>
        ) : (
          <span>Enter to send. Shift+Enter for a new line.</span>
        )}
        {nearLimit ? (
          <span className="tabular-nums text-warning">
            {draft.length} / {CHAT_MAX_CHARS}
          </span>
        ) : null}
      </p>
    </footer>
  );
}
