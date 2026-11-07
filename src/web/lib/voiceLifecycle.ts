import { DictationTranscript } from "./dictation";
import { HalfDuplexController } from "./halfDuplexState";
import { PauseSendTimer } from "./pauseSendTimer";
import { pickDefaultSystemVoice } from "./systemVoiceRanking";
import type { SendMode, VoiceSettings } from "./voiceSettings";

/** Clears all event handlers before aborting so no late event restarts recognition. */
export function detachAndAbortRecognizer(rec: any): void {
  if (!rec) return;
  rec.onend = null;
  rec.onresult = null;
  rec.onerror = null;
  rec.onspeechstart = null;
  rec.onsoundstart = null;
  rec.onaudiostart = null;
  rec.onaudioend = null;
  rec.onspeechend = null;
  rec.onsoundend = null;
  rec.onnomatch = null;
  rec.onstart = null;
  try {
    rec.abort();
  } catch {
    // Recognition instance already stopped.
  }
}

export interface VoiceInputLifecycleOptions {
  getSpeechClass?: () => any;
  getAvailabilityStatus: () => string;
  isDisabled: () => boolean;
  isActive?: () => boolean;
  useHeadphones?: () => boolean;
  getSendMode: () => SendMode;
  onListeningChange?: (isListening: boolean) => void;
  onSend: (text: string) => boolean;
  onBargeIn: () => void;
  getDraft: () => string;
  setDraft: (text: string) => void;
  pauseMs?: number;
}

/** Pure controller coordinating speech recognition lifecycle, events and half-duplex arbitration. */
export class VoiceInputLifecycle {
  private recognition: any = null;
  private isListening = false;
  private userMicEnabled = false;
  private disposed = false;
  private halfDuplex: HalfDuplexController;
  private pauseTimer: PauseSendTimer;
  private transcript = new DictationTranscript();

  constructor(private readonly options: VoiceInputLifecycleOptions) {
    this.halfDuplex = new HalfDuplexController({
      useHeadphones: options.useHeadphones ? options.useHeadphones() : false,
    });
    this.pauseTimer = new PauseSendTimer({
      pauseMs: options.pauseMs ?? 2000,
      onSend: (text) => {
        if (!this.isListening) return;
        if (!this.halfDuplex.canPauseTimerFire()) return;
        const sent = this.options.onSend(text);
        if (sent) {
          this.transcript.edit("");
          this.options.setDraft("");
        }
      },
    });
  }

  getIsListening(): boolean {
    return this.isListening;
  }

  getUserMicEnabled(): boolean {
    return this.userMicEnabled;
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  getActiveRecognizer(): any {
    return this.recognition;
  }

  setUseHeadphones(use: boolean): void {
    this.halfDuplex.setUseHeadphones(use);
  }

  resetSpokenDraft(): void {
    this.transcript.edit("");
    this.pauseTimer.cancel();
  }

  noteTypedDraft(text: string): void {
    this.transcript.edit(text);
    this.pauseTimer.cancel();
  }

  /** Starts voice recognition idempotently if current state allows input. */
  startListening(): boolean {
    if (this.disposed) return false;
    if (this.options.isDisabled() || (this.options.isActive && !this.options.isActive())) {
      return false;
    }
    if (this.options.getAvailabilityStatus() !== "available") {
      return false;
    }
    // Prevent duplicate instances if recognition is already running.
    if (this.isListening && this.recognition) {
      return false;
    }

    if (this.halfDuplex.isHeadphonesEnabled()) {
      this.options.onBargeIn();
    }

    const SpeechClass = this.options.getSpeechClass
      ? this.options.getSpeechClass()
      : typeof window !== "undefined"
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : undefined;

    if (!SpeechClass) return false;

    if (this.recognition) {
      const oldRec = this.recognition;
      this.recognition = null;
      detachAndAbortRecognizer(oldRec);
    }

    const rec = new SpeechClass();
    rec.lang = "en-US";
    rec.processLocally = true;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onspeechstart = () => {
      if (this.disposed || this.recognition !== rec) return;
      this.pauseTimer.onSpeechActivity();
      if (this.halfDuplex.isHeadphonesEnabled()) {
        this.options.onBargeIn();
      }
    };

    rec.onsoundstart = () => {
      if (this.disposed || this.recognition !== rec) return;
      this.pauseTimer.onSpeechActivity();
    };

    rec.onresult = (event: any) => {
      if (this.disposed || this.recognition !== rec) return;
      if (this.halfDuplex.isPausedForSpeaking()) return;

      const update = this.transcript.result(event);
      this.options.setDraft(update.text);

      if (this.options.getSendMode() === "pause" && this.halfDuplex.canPauseTimerFire()) {
        if (update.hearing) {
          this.pauseTimer.onSpeechActivity();
        } else if (update.heardFinal) {
          this.pauseTimer.onSpeechPause(update.text);
        }
      }
    };

    rec.onerror = (event: any) => {
      if (this.disposed || this.recognition !== rec) return;
      if (event.error === "no-speech" || event.error === "aborted") return;
      this.stopListening();
    };

    rec.onend = () => {
      if (this.disposed || this.recognition !== rec) return;
      const disabled = this.options.isDisabled() || (this.options.isActive && !this.options.isActive());
      if (this.isListening && !disabled && !this.halfDuplex.isPausedForSpeaking()) {
        try {
          this.transcript.restart();
          rec.start();
        } catch {
          this.stopListening();
        }
      }
    };

    this.transcript.begin(this.options.getDraft());

    try {
      rec.start();
      this.recognition = rec;
      this.isListening = true;
      this.options.onListeningChange?.(true);
      return true;
    } catch {
      detachAndAbortRecognizer(rec);
      this.stopListening();
      return false;
    }
  }

  /** Halts active recognition and clears microphone enablement. */
  stopListening(): void {
    this.userMicEnabled = false;
    this.halfDuplex.disableMic();
    this.isListening = false;
    this.options.onListeningChange?.(false);
    this.pauseTimer.cancel();
    const rec = this.recognition;
    this.recognition = null;
    detachAndAbortRecognizer(rec);
  }

  /** Toggles voice input on and off while enforcing active panel constraints. */
  toggleListening(): void {
    if (this.userMicEnabled) {
      this.userMicEnabled = false;
      this.halfDuplex.disableMic();
      this.stopListening();
      return;
    }
    if (this.disposed) return;
    if (this.options.isDisabled() || (this.options.isActive && !this.options.isActive())) {
      return;
    }
    if (this.options.getAvailabilityStatus() !== "available") {
      return;
    }
    this.userMicEnabled = true;
    const { startRecognition } = this.halfDuplex.enableMic();
    if (startRecognition) {
      this.startListening();
    }
  }

  /** Handles the Ctrl+M shortcut, ignoring inactive or disabled states. */
  handleKeyDown(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; key: string; preventDefault?: () => void }): boolean {
    if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "m" || e.key === "M")) {
      if (this.disposed) return false;
      if (this.options.isDisabled() || (this.options.isActive && !this.options.isActive())) {
        return false;
      }
      e.preventDefault?.();
      this.toggleListening();
      return true;
    }
    return false;
  }

  /** Backgrounding a tab halts recording without auto-resuming upon return. */
  handleVisibilityChange(state?: string): void {
    const current = state ?? (typeof document !== "undefined" ? document.visibilityState : "visible");
    if (current === "hidden") {
      this.stopListening();
    }
  }

  handlePageHide(): void {
    this.stopListening();
  }

  onSpeakingStarted(): void {
    const action = this.halfDuplex.onSpeakingStarted();
    if (action.abortRecognition && this.recognition) {
      const rec = this.recognition;
      this.recognition = null;
      detachAndAbortRecognizer(rec);
    }
    if (action.cancelTimer) {
      this.pauseTimer.cancel();
    }
    if (action.dropInterim) {
      this.options.setDraft(this.transcript.dropInterim());
    }
  }

  onSpeakingEnded(): void {
    const action = this.halfDuplex.onSpeakingEnded();
    const disabled = this.options.isDisabled() || (this.options.isActive && !this.options.isActive());
    if (action.resumeRecognition && this.userMicEnabled && !disabled) {
      this.startListening();
    }
  }

  /** Tears down all recognition state and detaches event handlers on unmount. */
  dispose(): void {
    this.disposed = true;
    this.userMicEnabled = false;
    this.isListening = false;
    this.options.onListeningChange?.(false);
    this.halfDuplex.disableMic();
    this.pauseTimer.cancel();
    const rec = this.recognition;
    this.recognition = null;
    detachAndAbortRecognizer(rec);
  }
}

export interface AudioElementLike {
  src: string;
  onended: ((event?: any) => void) | null;
  onerror: ((event?: any) => void) | null;
  play: () => Promise<void>;
  pause: () => void;
  removeAttribute: (attr: string) => void;
  load: () => void;
}

export interface VoiceOutputActiveStream {
  id: string;
  spokenCount: number;
  stopped: boolean;
  fallbackToSystem: boolean;
  sentences: string[];
  playbackIndex: number;
  prefetchPromises: Map<number, Promise<Blob>>;
  abortController: AbortController | null;
  audio: AudioElementLike | null;
  currentBlobUrl: string | null;
}

export interface VoiceOutputLifecycleOptions {
  audioFactory?: () => AudioElementLike;
  synthesizeSpeech?: (params: { text: string; voice: string; speed: number }, signal?: AbortSignal) => Promise<Blob>;
  createBlobUrl?: (blob: Blob) => string;
  revokeBlobUrl?: (url: string) => void;
  getSpeechSynthesis?: () =>
    | {
        speaking: boolean;
        speak: (utterance: any) => void;
        cancel: () => void;
      }
    | undefined;
  getVoiceSettings: () => VoiceSettings;
  getVoices: () => SpeechSynthesisVoice[];
  onSpeakingChange?: (isSpeaking: boolean) => void;
  isDisabled: () => boolean;
}

/** Pure controller managing speech playback, Kokoro streaming, and unmount cancellation. */
export class VoiceOutputLifecycle {
  private disposed = false;
  private systemSpeechQueued = false;
  private activeStream: VoiceOutputActiveStream | null = null;
  private isSpeaking = false;

  constructor(private readonly options: VoiceOutputLifecycleOptions) {}

  getIsSpeaking(): boolean {
    return this.isSpeaking;
  }

  getActiveStream(): VoiceOutputActiveStream | null {
    return this.activeStream;
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  hasSystemSpeechQueued(): boolean {
    return this.systemSpeechQueued;
  }

  /** Halts speech and clears pending audio, canceling system speech only if initiated here. */
  stopSpeaking(): void {
    if (this.systemSpeechQueued) {
      this.systemSpeechQueued = false;
      const synth = this.options.getSpeechSynthesis
        ? this.options.getSpeechSynthesis()
        : typeof window !== "undefined" && "speechSynthesis" in window
          ? window.speechSynthesis
          : undefined;
      if (synth) {
        try {
          synth.cancel();
        } catch {
          // Speech synthesis cancellation error ignored.
        }
      }
    }

    const stream = this.activeStream;
    if (stream) {
      stream.stopped = true;
      stream.abortController?.abort();
      stream.prefetchPromises.clear();
      if (stream.audio) {
        stream.audio.onended = null;
        stream.audio.onerror = null;
        try {
          stream.audio.pause();
          stream.audio.removeAttribute("src");
          stream.audio.load();
        } catch {
          // Audio cleanup error ignored.
        }
        stream.audio = null;
      }
      if (stream.currentBlobUrl) {
        const revoke = this.options.revokeBlobUrl ?? (typeof URL !== "undefined" ? URL.revokeObjectURL : undefined);
        if (revoke) {
          try {
            revoke(stream.currentBlobUrl);
          } catch {
            // URL revocation error ignored.
          }
        }
        stream.currentBlobUrl = null;
      }
      this.activeStream = null;
    }

    this.isSpeaking = false;
    this.options.onSpeakingChange?.(false);
  }

  /** Plays individual sentences sequentially while prefetching subsequent chunks. */
  async playNextSentence(stream: VoiceOutputActiveStream): Promise<void> {
    if (this.disposed || stream.stopped || stream.fallbackToSystem) return;

    if (stream.playbackIndex >= stream.sentences.length) {
      if (stream.currentBlobUrl) {
        const revoke = this.options.revokeBlobUrl ?? (typeof URL !== "undefined" ? URL.revokeObjectURL : undefined);
        revoke?.(stream.currentBlobUrl);
        stream.currentBlobUrl = null;
      }
      this.isSpeaking = false;
      this.options.onSpeakingChange?.(false);
      return;
    }

    const currentIndex = stream.playbackIndex;
    const currentText = stream.sentences[currentIndex];
    if (!currentText || !currentText.trim()) {
      stream.playbackIndex++;
      void this.playNextSentence(stream);
      return;
    }

    try {
      this.isSpeaking = true;
      this.options.onSpeakingChange?.(true);

      const wavBlob = await this.fetchSentenceWav(stream, currentIndex, currentText);
      if (this.disposed || stream.stopped || stream.fallbackToSystem) return;

      const nextIndex = currentIndex + 1;
      const nextText = stream.sentences[nextIndex];
      if (nextIndex < stream.sentences.length && nextText && !stream.prefetchPromises.has(nextIndex)) {
        void this.fetchSentenceWav(stream, nextIndex, nextText).catch(() => {});
      }

      if (stream.currentBlobUrl) {
        const revoke = this.options.revokeBlobUrl ?? (typeof URL !== "undefined" ? URL.revokeObjectURL : undefined);
        revoke?.(stream.currentBlobUrl);
        stream.currentBlobUrl = null;
      }

      if (this.disposed || stream.stopped) return;

      const createUrl = this.options.createBlobUrl ?? (typeof URL !== "undefined" ? URL.createObjectURL : undefined);
      const blobUrl = createUrl ? createUrl(wavBlob) : "";
      stream.currentBlobUrl = blobUrl;

      if (!stream.audio) {
        stream.audio = this.options.audioFactory ? this.options.audioFactory() : (new Audio() as any);
      }
      const audio = stream.audio;
      if (!audio) return;
      audio.src = blobUrl;

      audio.onended = () => {
        if (this.disposed || stream.stopped) return;
        stream.playbackIndex++;
        void this.playNextSentence(stream);
      };

      audio.onerror = () => {
        if (this.disposed || stream.stopped) return;
        stream.fallbackToSystem = true;
        const remaining = stream.sentences.slice(stream.playbackIndex);
        this.speakWithSystem(remaining);
      };

      if (this.disposed || stream.stopped) return;
      await audio.play();
      if (this.disposed || stream.stopped) {
        try {
          audio.pause();
        } catch {}
      }
    } catch {
      if (this.disposed || stream.stopped || stream.abortController?.signal.aborted) return;
      stream.fallbackToSystem = true;
      const remaining = stream.sentences.slice(stream.playbackIndex);
      this.speakWithSystem(remaining);
    }
  }

  fetchSentenceWav(stream: VoiceOutputActiveStream, index: number, text: string): Promise<Blob> {
    if (this.disposed || stream.stopped) {
      return Promise.reject(new Error("Stream disposed or stopped"));
    }
    if (stream.prefetchPromises.has(index)) {
      return stream.prefetchPromises.get(index)!;
    }
    const voiceSettings = this.options.getVoiceSettings();
    if (!this.options.synthesizeSpeech) {
      return Promise.reject(new Error("synthesizeSpeech not configured"));
    }
    const promise = this.options.synthesizeSpeech(
      {
        text,
        voice: voiceSettings.kokoroVoice,
        speed: voiceSettings.kokoroSpeed,
      },
      stream.abortController?.signal,
    );
    stream.prefetchPromises.set(index, promise);
    return promise;
  }

  speakWithSystem(textList: string[]): void {
    if (this.disposed) return;
    const synth = this.options.getSpeechSynthesis
      ? this.options.getSpeechSynthesis()
      : typeof window !== "undefined" && "speechSynthesis" in window
        ? window.speechSynthesis
        : undefined;
    if (!synth) return;

    const chosenVoice = pickDefaultSystemVoice(this.options.getVoices());
    const voiceSettings = this.options.getVoiceSettings();

    const SpeechUtterance =
      (typeof SpeechSynthesisUtterance !== "undefined" ? SpeechSynthesisUtterance : (globalThis as any).SpeechSynthesisUtterance) ||
      class {
        rate = 1;
        voice: any = null;
        onstart: (() => void) | null = null;
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(public text: string) {}
      };
    if (!SpeechUtterance) return;
    for (const text of textList) {
      const utterance = new SpeechUtterance(text);
      if (chosenVoice) utterance.voice = chosenVoice;
      utterance.rate = voiceSettings.rate;

      utterance.onstart = () => {
        if (this.disposed) return;
        this.isSpeaking = true;
        this.options.onSpeakingChange?.(true);
      };

      utterance.onend = () => {
        if (this.disposed) return;
        if (!synth.speaking) {
          this.systemSpeechQueued = false;
          this.isSpeaking = false;
          this.options.onSpeakingChange?.(false);
        }
      };

      utterance.onerror = () => {
        if (this.disposed) return;
        if (!synth.speaking) {
          this.systemSpeechQueued = false;
          this.isSpeaking = false;
          this.options.onSpeakingChange?.(false);
        }
      };

      this.systemSpeechQueued = true;
      synth.speak(utterance);
      this.isSpeaking = true;
      this.options.onSpeakingChange?.(true);
    }
  }

  handleVisibilityChange(state?: string): void {
    const current = state ?? (typeof document !== "undefined" ? document.visibilityState : "visible");
    if (current === "hidden") {
      this.stopSpeaking();
    }
  }

  handlePageHide(): void {
    this.stopSpeaking();
  }

  createStream(id: string, sentences: string[], fallbackToSystem: boolean): VoiceOutputActiveStream {
    if (this.activeStream) {
      this.stopSpeaking();
    }
    const stream: VoiceOutputActiveStream = {
      id,
      spokenCount: 0,
      stopped: false,
      fallbackToSystem,
      sentences,
      playbackIndex: 0,
      prefetchPromises: new Map(),
      abortController: new AbortController(),
      audio: null,
      currentBlobUrl: null,
    };
    this.activeStream = stream;
    return stream;
  }

  dispose(): void {
    this.disposed = true;
    this.stopSpeaking();
  }
}
