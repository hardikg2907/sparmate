import { useCallback, useEffect, useState } from "react";
import { KOKORO_DEFAULT_SPEED, KOKORO_DEFAULT_VOICE, type KokoroVoice } from "./contract";
import { rankSystemVoices } from "./systemVoiceRanking";

export type SendMode = "review" | "pause";
export type VoiceEngine = "kokoro" | "system";

export interface VoiceSettings {
  engine: VoiceEngine;
  kokoroVoice: KokoroVoice;
  kokoroSpeed: number;
  useHeadphones: boolean;
  sendMode: SendMode;
  speakReplies: boolean;
  voiceURI: string | null;
  rate: number;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  engine: "kokoro",
  kokoroVoice: KOKORO_DEFAULT_VOICE,
  kokoroSpeed: KOKORO_DEFAULT_SPEED,
  useHeadphones: false,
  sendMode: "review",
  speakReplies: false,
  voiceURI: null,
  rate: 1.0,
};

const KEY = "sparmate-voice";

const listeners = new Set<(settings: VoiceSettings) => void>();

/** Reads browser-local voice preferences from storage with fallbacks. */
export function getVoiceSettings(): VoiceSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_VOICE_SETTINGS };
    const parsed = JSON.parse(raw);
    // One voice for everyone: the engine and the voice are fixed, so a stored choice is ignored.
    const engine: VoiceEngine = "kokoro";
    const kokoroVoice: KokoroVoice = KOKORO_DEFAULT_VOICE;
    const kokoroSpeed = typeof parsed.kokoroSpeed === "number" && parsed.kokoroSpeed >= 0.6 && parsed.kokoroSpeed <= 1.6 ? parsed.kokoroSpeed : KOKORO_DEFAULT_SPEED;
    const useHeadphones = Boolean(parsed.useHeadphones);

    return {
      engine,
      kokoroVoice,
      kokoroSpeed,
      useHeadphones,
      sendMode: parsed.sendMode === "pause" ? "pause" : "review",
      speakReplies: Boolean(parsed.speakReplies),
      voiceURI: typeof parsed.voiceURI === "string" ? parsed.voiceURI : null,
      rate: typeof parsed.rate === "number" && parsed.rate >= 0.5 && parsed.rate <= 2.0 ? parsed.rate : 1.0,
    };
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

/** Persists browser-local voice preferences and notifies active listeners. */
export function saveVoiceSettings(settings: VoiceSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage can be blocked; in-memory notification still updates the open page.
  }
  for (const listener of listeners) listener(settings);
}

/** Subscribes to changes to voice preferences across components. */
export function subscribeVoiceSettings(listener: (settings: VoiceSettings) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React hook for voice preferences synchronized with storage. */
export function useVoiceSettings(): [VoiceSettings, (settings: VoiceSettings) => void] {
  const [settings, setSettings] = useState<VoiceSettings>(getVoiceSettings);

  useEffect(() => {
    return subscribeVoiceSettings(setSettings);
  }, []);

  const update = useCallback((next: VoiceSettings) => {
    saveVoiceSettings(next);
  }, []);

  return [settings, update];
}

/** Sorts speech synthesis voices placing English voices first, then alphabetically. */
export function sortVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return rankSystemVoices(voices);
}

/** React hook listing available local speech synthesis voices ranked by quality. */
export function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
    return rankSystemVoices(window.speechSynthesis.getVoices());
  });

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const update = () => {
      setVoices(rankSystemVoices(window.speechSynthesis.getVoices()));
    };
    update();
    window.speechSynthesis.onvoiceschanged = update;
    return () => {
      if (window.speechSynthesis.onvoiceschanged === update) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  return voices;
}
