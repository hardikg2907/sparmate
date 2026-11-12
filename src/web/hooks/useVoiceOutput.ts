import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../backend";
import { markRepliesHeard, replySpeechSentences, replyToSpeak } from "../lib/replySpeech";
import { pickDefaultSystemVoice } from "../lib/systemVoiceRanking";
import type { VoiceSettings } from "../lib/voiceSettings";
import type { ChatItem } from "../session/types";

export interface UseVoiceOutputProps {
  items: ChatItem[];
  disabled?: boolean;
  voiceSettings: VoiceSettings;
  voices: SpeechSynthesisVoice[];
}

export interface VoiceOutputState {
  isSpeaking: boolean;
  stopSpeaking: () => void;
}

interface ActiveStream {
  id: string;
  spokenCount: number;
  stopped: boolean;
  fallbackToSystem: boolean;
  sentences: string[];
  playbackIndex: number;
  prefetchPromises: Map<number, Promise<Blob>>;
  abortController: AbortController | null;
  audio: HTMLAudioElement | null;
  currentBlobUrl: string | null;
}

/** Streams incoming interviewer, guide and coach replies sentence by sentence via Kokoro TTS or system voice. */
export function useVoiceOutput({ items, disabled, voiceSettings, voices }: UseVoiceOutputProps): VoiceOutputState {
  const [isSpeaking, setIsSpeaking] = useState(false);

  // History is marked heard on the first render that has any, so a reload never reads old replies aloud.
  const seededRef = useRef(false);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const activeStreamRef = useRef<ActiveStream | null>(null);
  const systemSpeechQueuedRef = useRef(false);
  const disposedRef = useRef(false);

  const stopSpeaking = useCallback(() => {
    // Only cancel system speech synthesis if this instance previously scheduled utterances.
    if (systemSpeechQueuedRef.current && typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Speech cancellation error ignored.
      }
      systemSpeechQueuedRef.current = false;
    }
    const current = activeStreamRef.current;
    if (current) {
      // Later deltas of an interrupted reply must not start it again from the first sentence.
      seenMessageIdsRef.current.add(current.id);
      current.stopped = true;
      current.abortController?.abort();
      current.prefetchPromises.clear();
      if (current.audio) {
        current.audio.onended = null;
        current.audio.onerror = null;
        try {
          current.audio.pause();
          current.audio.removeAttribute("src");
          current.audio.load();
        } catch {
          // Audio cleanup error ignored.
        }
        current.audio = null;
      }
      if (current.currentBlobUrl) {
        try {
          URL.revokeObjectURL(current.currentBlobUrl);
        } catch {
          // URL revocation error ignored.
        }
        current.currentBlobUrl = null;
      }
      activeStreamRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  useEffect(() => {
    if (disabled || !voiceSettings.speakReplies) {
      stopSpeaking();
    }
  }, [disabled, voiceSettings.speakReplies, stopSpeaking]);

  // Tab hidden or navigation away stops speech synthesis and audio playback immediately.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stopSpeaking();
      }
    };
    const handlePageHide = () => {
      stopSpeaking();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [stopSpeaking]);

  // A late fetch or onended after unmount must never start audio on another page.
  useEffect(() => {
    // StrictMode mounts, unmounts and mounts again in development; the second mount must be live.
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      stopSpeaking();
    };
  }, [stopSpeaking]);

  const speakWithSystem = useCallback(
    (textList: string[]) => {
      if (disposedRef.current || typeof window === "undefined" || !("speechSynthesis" in window)) return;
      // Only reached when Kokoro fails; the browser default voice is the worst one on the Mac.
      const chosenVoice = pickDefaultSystemVoice(voices);

      for (const text of textList) {
        if (!text.trim()) continue;
        const utterance = new SpeechSynthesisUtterance(text);
        if (chosenVoice) utterance.voice = chosenVoice;
        utterance.rate = voiceSettings.rate;

        utterance.onstart = () => {
          if (disposedRef.current) return;
          setIsSpeaking(true);
        };
        utterance.onend = () => {
          if (disposedRef.current) return;
          if (!window.speechSynthesis.speaking) {
            systemSpeechQueuedRef.current = false;
            setIsSpeaking(false);
          }
        };
        utterance.onerror = () => {
          if (disposedRef.current) return;
          if (!window.speechSynthesis.speaking) {
            systemSpeechQueuedRef.current = false;
            setIsSpeaking(false);
          }
        };

        systemSpeechQueuedRef.current = true;
        window.speechSynthesis.speak(utterance);
        setIsSpeaking(true);
      }
    },
    [voiceSettings.rate, voices],
  );

  const fetchSentenceWav = useCallback(
    (stream: ActiveStream, index: number, text: string): Promise<Blob> => {
      if (disposedRef.current || stream.stopped) {
        return Promise.reject(new Error("Playback stopped"));
      }
      if (stream.prefetchPromises.has(index)) {
        return stream.prefetchPromises.get(index)!;
      }
      const promise = api.synthesizeSpeech(
        {
          text,
          voice: voiceSettings.kokoroVoice,
          speed: voiceSettings.kokoroSpeed,
        },
        stream.abortController?.signal,
      );
      stream.prefetchPromises.set(index, promise);
      return promise;
    },
    [voiceSettings.kokoroSpeed, voiceSettings.kokoroVoice],
  );

  const playNextSentence = useCallback(
    async (stream: ActiveStream) => {
      if (disposedRef.current || stream.stopped || stream.fallbackToSystem) return;
      if (stream.playbackIndex >= stream.sentences.length) {
        if (stream.currentBlobUrl) {
          try {
            URL.revokeObjectURL(stream.currentBlobUrl);
          } catch {
            // URL revocation error ignored.
          }
          stream.currentBlobUrl = null;
        }
        setIsSpeaking(false);
        return;
      }

      const currentIndex = stream.playbackIndex;
      const currentText = stream.sentences[currentIndex];
      if (!currentText || !currentText.trim()) {
        stream.playbackIndex++;
        void playNextSentence(stream);
        return;
      }

      try {
        setIsSpeaking(true);
        const wavBlob = await fetchSentenceWav(stream, currentIndex, currentText);
        if (disposedRef.current || stream.stopped || stream.fallbackToSystem) return;

        // Prefetch subsequent sentence while current sentence is playing.
        const nextIndex = currentIndex + 1;
        const nextText = stream.sentences[nextIndex];
        if (nextIndex < stream.sentences.length && nextText && !stream.prefetchPromises.has(nextIndex)) {
          void fetchSentenceWav(stream, nextIndex, nextText).catch(() => {
            // Error handled on subsequent sentence playback.
          });
        }

        if (stream.currentBlobUrl) {
          try {
            URL.revokeObjectURL(stream.currentBlobUrl);
          } catch {
            // URL revocation error ignored.
          }
          stream.currentBlobUrl = null;
        }
        if (disposedRef.current || stream.stopped) return;

        const blobUrl = URL.createObjectURL(wavBlob);
        stream.currentBlobUrl = blobUrl;

        if (!stream.audio) {
          stream.audio = new Audio();
        }
        const audio = stream.audio;
        audio.src = blobUrl;

        audio.onended = () => {
          if (disposedRef.current || stream.stopped) return;
          stream.playbackIndex++;
          void playNextSentence(stream);
        };

        audio.onerror = () => {
          if (disposedRef.current || stream.stopped) return;
          // Fall back to system speech synthesis on audio playback failure.
          stream.fallbackToSystem = true;
          const remaining = stream.sentences.slice(stream.playbackIndex);
          speakWithSystem(remaining);
        };

        if (disposedRef.current || stream.stopped) return;
        await audio.play();
        if (disposedRef.current || stream.stopped) {
          try {
            audio.pause();
          } catch {
            // Pause error ignored.
          }
        }
      } catch {
        if (disposedRef.current || stream.stopped || stream.abortController?.signal.aborted) return;
        // On server or network failure, fall back to speech synthesis for remaining reply.
        stream.fallbackToSystem = true;
        const remaining = stream.sentences.slice(stream.playbackIndex);
        speakWithSystem(remaining);
      }
    },
    [fetchSentenceWav, speakWithSystem],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!seededRef.current) {
      if (items.length === 0) return;
      seededRef.current = true;
      for (const item of items) {
        if (item.state === "done" && item.role !== "candidate" && item.role !== "system") {
          seenMessageIdsRef.current.add(item.id);
        }
      }
      return;
    }

    if (disabled || !voiceSettings.speakReplies) {
      markRepliesHeard(items, seenMessageIdsRef.current);
      return;
    }

    const latest = replyToSpeak(items, seenMessageIdsRef.current, activeStreamRef.current?.id ?? null);
    if (!latest) return;

    if (!activeStreamRef.current || activeStreamRef.current.id !== latest.id) {
      if (activeStreamRef.current) {
        stopSpeaking();
      }
      activeStreamRef.current = {
        id: latest.id,
        spokenCount: 0,
        stopped: false,
        fallbackToSystem: voiceSettings.engine === "system",
        sentences: [],
        playbackIndex: 0,
        prefetchPromises: new Map(),
        abortController: new AbortController(),
        audio: null,
        currentBlobUrl: null,
      };
    }

    const currentStream = activeStreamRef.current;
    if (currentStream.stopped) return;

    const isFinal = latest.state === "done";
    const sentences = replySpeechSentences(latest);

    if (sentences.length > currentStream.spokenCount) {
      const newSentences = sentences.slice(currentStream.spokenCount);
      currentStream.spokenCount = sentences.length;
      currentStream.sentences = sentences;

      if (currentStream.fallbackToSystem) {
        speakWithSystem(newSentences);
      } else {
        // Kick off playback if it was idle.
        if (currentStream.playbackIndex === currentStream.spokenCount - newSentences.length) {
          void playNextSentence(currentStream);
        }
      }
    }

    if (isFinal) {
      seenMessageIdsRef.current.add(latest.id);
    }
  }, [disabled, items, playNextSentence, speakWithSystem, stopSpeaking, voiceSettings.engine, voiceSettings.speakReplies]);

  return {
    isSpeaking,
    stopSpeaking,
  };
}
