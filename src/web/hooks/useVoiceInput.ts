import { useCallback, useEffect, useRef, useState } from "react";
import { HalfDuplexController } from "../lib/halfDuplexState";
import { PauseSendTimer } from "../lib/pauseSendTimer";
import {
  checkSpeechRecognitionAvailability,
  REASON_ON_DEVICE_UNAVAILABLE,
  type SpeechRecognitionAvailability,
  type SpeechRecognitionConstructor,
} from "../lib/speechRecognitionAvailability";
import { DictationTranscript } from "../lib/dictation";
import { detachAndAbortRecognizer } from "../lib/voiceLifecycle";
import type { SendMode } from "../lib/voiceSettings";

export interface UseVoiceInputProps {
  disabled?: boolean;
  isActive?: boolean;
  isSpeaking?: boolean;
  useHeadphones?: boolean;
  sendMode: SendMode;
  onSend: (text: string) => boolean;
  onBargeIn: () => void;
  draft: string;
  setDraft: (value: string | ((prev: string) => string)) => void;
}

export interface VoiceInputState {
  availability: SpeechRecognitionAvailability;
  isListening: boolean;
  isInstalling: boolean;
  disabledReason: string | null;
  toggleListening: () => void;
  stopListening: () => void;
  installModel: () => Promise<void>;
  resetSpokenDraft: () => void;
  /** He typed in the box: his text replaces what dictation was building. */
  noteTypedDraft: (text: string) => void;
}

/** Provides continuous on-device speech-to-text input with half-duplex pause detection. */
export function useVoiceInput({ disabled, isActive = true, isSpeaking, useHeadphones, sendMode, onSend, onBargeIn, draft, setDraft }: UseVoiceInputProps): VoiceInputState {
  const [availability, setAvailability] = useState<SpeechRecognitionAvailability>({
    status: "unavailable",
    reason: REASON_ON_DEVICE_UNAVAILABLE,
  });
  const [isListening, setIsListening] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  const halfDuplexRef = useRef(new HalfDuplexController({ useHeadphones }));
  halfDuplexRef.current.setUseHeadphones(Boolean(useHeadphones));
  const userMicEnabledRef = useRef(false);
  const disposedRef = useRef(false);

  const recognitionRef = useRef<any>(null);
  const isListeningRef = useRef(false);
  const transcriptRef = useRef(new DictationTranscript());
  const latestDraftRef = useRef(draft);
  latestDraftRef.current = draft;

  const disabledRef = useRef(Boolean(disabled));
  disabledRef.current = Boolean(disabled);
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const sendModeRef = useRef(sendMode);
  sendModeRef.current = sendMode;

  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const onBargeInRef = useRef(onBargeIn);
  onBargeInRef.current = onBargeIn;

  const pauseTimerRef = useRef<PauseSendTimer | null>(null);

  useEffect(() => {
    pauseTimerRef.current = new PauseSendTimer({
      pauseMs: 2000,
      onSend: (text) => {
        if (!isListeningRef.current) return;
        if (!halfDuplexRef.current.canPauseTimerFire()) return;
        const sent = onSendRef.current(text);
        if (sent) {
          transcriptRef.current.edit("");
          setDraft("");
        }
      },
    });
    return () => {
      pauseTimerRef.current?.cancel();
    };
  }, [setDraft]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SpeechClass = ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) as SpeechRecognitionConstructor | undefined;
    void checkSpeechRecognitionAvailability(SpeechClass).then(setAvailability);
  }, []);

  const stopListening = useCallback(() => {
    userMicEnabledRef.current = false;
    halfDuplexRef.current.disableMic();
    isListeningRef.current = false;
    setIsListening(false);
    pauseTimerRef.current?.cancel();
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    detachAndAbortRecognizer(rec);
  }, []);

  const resetSpokenDraft = useCallback(() => {
    transcriptRef.current.edit("");
    pauseTimerRef.current?.cancel();
  }, []);

  // A pending pause-send holds the text from before the edit, so it must not fire.
  const noteTypedDraft = useCallback((text: string) => {
    transcriptRef.current.edit(text);
    pauseTimerRef.current?.cancel();
  }, []);

  const startListening = useCallback(() => {
    if (availability.status !== "available" || disabledRef.current || !isActiveRef.current || disposedRef.current) {
      return;
    }
    // Starting while an instance is active must be a no-op to avoid orphaned sessions.
    if (isListeningRef.current && recognitionRef.current) {
      return;
    }

    if (halfDuplexRef.current.isHeadphonesEnabled()) {
      onBargeInRef.current();
    }

    const SpeechClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechClass) return;

    if (recognitionRef.current) {
      const oldRec = recognitionRef.current;
      recognitionRef.current = null;
      detachAndAbortRecognizer(oldRec);
    }

    const rec = new SpeechClass();
    rec.lang = "en-US";
    rec.processLocally = true;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onspeechstart = () => {
      if (disposedRef.current || recognitionRef.current !== rec) return;
      pauseTimerRef.current?.onSpeechActivity();
      if (halfDuplexRef.current.isHeadphonesEnabled()) {
        onBargeInRef.current();
      }
    };

    rec.onsoundstart = () => {
      if (disposedRef.current || recognitionRef.current !== rec) return;
      pauseTimerRef.current?.onSpeechActivity();
    };

    rec.onresult = (event: any) => {
      if (disposedRef.current || recognitionRef.current !== rec) return;
      if (halfDuplexRef.current.isPausedForSpeaking()) return;

      const update = transcriptRef.current.result(event);
      setDraft(update.text);

      if (sendModeRef.current === "pause" && halfDuplexRef.current.canPauseTimerFire()) {
        if (update.hearing) {
          pauseTimerRef.current?.onSpeechActivity();
        } else if (update.heardFinal) {
          pauseTimerRef.current?.onSpeechPause(update.text);
        }
      }
    };

    rec.onerror = (event: any) => {
      if (disposedRef.current || recognitionRef.current !== rec) return;
      // Benign events in continuous speech are ignored.
      if (event.error === "no-speech" || event.error === "aborted") return;
      stopListening();
    };

    rec.onend = () => {
      // Discard callbacks from previous or disposed instances so restarts stay tied to the active session.
      if (disposedRef.current || recognitionRef.current !== rec) return;
      const isDisabled = disabledRef.current || !isActiveRef.current;
      if (isListeningRef.current && !isDisabled && !halfDuplexRef.current.isPausedForSpeaking()) {
        try {
          transcriptRef.current.restart();
          rec.start();
        } catch {
          stopListening();
        }
      }
    };

    transcriptRef.current.begin(latestDraftRef.current);

    try {
      rec.start();
      recognitionRef.current = rec;
      isListeningRef.current = true;
      setIsListening(true);
    } catch {
      detachAndAbortRecognizer(rec);
      stopListening();
    }
  }, [availability.status, setDraft, stopListening]);

  // Half-duplex coordination: pause recognition and drop interim text during speaker output.
  useEffect(() => {
    if (isSpeaking) {
      const action = halfDuplexRef.current.onSpeakingStarted();
      if (action.abortRecognition && recognitionRef.current) {
        const rec = recognitionRef.current;
        recognitionRef.current = null;
        detachAndAbortRecognizer(rec);
      }
      if (action.cancelTimer) {
        pauseTimerRef.current?.cancel();
      }
      if (action.dropInterim) {
        setDraft(transcriptRef.current.dropInterim());
      }
    } else {
      const action = halfDuplexRef.current.onSpeakingEnded();
      const isDisabled = disabledRef.current || !isActiveRef.current;
      if (action.resumeRecognition && userMicEnabledRef.current && !isDisabled) {
        startListening();
      }
    }
  }, [isSpeaking, setDraft, startListening]);

  const toggleListening = useCallback(() => {
    if (userMicEnabledRef.current) {
      userMicEnabledRef.current = false;
      halfDuplexRef.current.disableMic();
      stopListening();
      return;
    }
    // Inactive panels and disabled sessions refuse mic enablement.
    if (disabledRef.current || !isActiveRef.current || availability.status !== "available" || disposedRef.current) {
      return;
    }
    userMicEnabledRef.current = true;
    const { startRecognition } = halfDuplexRef.current.enableMic();
    if (startRecognition) {
      startListening();
    }
  }, [availability.status, startListening, stopListening]);

  useEffect(() => {
    if ((disabled || !isActive) && (isListeningRef.current || userMicEnabledRef.current)) {
      userMicEnabledRef.current = false;
      halfDuplexRef.current.disableMic();
      stopListening();
    }
  }, [disabled, isActive, stopListening]);

  // Backgrounding the tab must immediately halt the microphone without auto-resuming.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stopListening();
      }
    };
    const handlePageHide = () => {
      stopListening();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [stopListening]);

  // Unmounting the component tears down speech recognition and detaches listeners.
  useEffect(() => {
    // StrictMode mounts, unmounts and mounts again in development; the second mount must be live.
    disposedRef.current = false;
    const halfDuplex = halfDuplexRef.current;
    return () => {
      disposedRef.current = true;
      userMicEnabledRef.current = false;
      isListeningRef.current = false;
      halfDuplex.disableMic();
      pauseTimerRef.current?.cancel();
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      detachAndAbortRecognizer(rec);
    };
  }, []);

  // Ctrl+M toggles voice input when the panel is active and visible.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "m" || e.key === "M")) {
        if (disabledRef.current || !isActiveRef.current || disposedRef.current) return;
        e.preventDefault();
        toggleListening();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [toggleListening]);

  const installModel = useCallback(async () => {
    if (availability.status !== "downloadable") return;
    setIsInstalling(true);
    try {
      await availability.install();
      setAvailability({ status: "available" });
    } catch {
      setAvailability({ status: "unavailable", reason: REASON_ON_DEVICE_UNAVAILABLE });
    } finally {
      setIsInstalling(false);
    }
  }, [availability]);

  const disabledReason = disabled || !isActive ? "Voice input is paused" : availability.status !== "available" ? REASON_ON_DEVICE_UNAVAILABLE : null;

  return {
    availability,
    isListening,
    isInstalling,
    disabledReason,
    toggleListening,
    stopListening,
    installModel,
    resetSpokenDraft,
    noteTypedDraft,
  };
}
