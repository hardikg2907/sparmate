/** Pure state management for half-duplex and full-duplex speech interaction. */
export class HalfDuplexController {
  private micDesired = false;
  private isSpeaking = false;
  private useHeadphones = false;

  constructor(options?: { useHeadphones?: boolean }) {
    this.useHeadphones = Boolean(options?.useHeadphones);
  }

  setUseHeadphones(use: boolean): void {
    this.useHeadphones = use;
  }

  isHeadphonesEnabled(): boolean {
    return this.useHeadphones;
  }

  isMicDesired(): boolean {
    return this.micDesired;
  }

  getIsSpeaking(): boolean {
    return this.isSpeaking;
  }

  /** Recognition runs whenever the mic is toggled on unless paused by speaker output. */
  isRecognitionActive(): boolean {
    if (!this.micDesired) return false;
    if (this.useHeadphones) return true;
    return !this.isSpeaking;
  }

  /** True when the mic toggle is on but speech input is paused to prevent transcribing speaker audio. */
  isPausedForSpeaking(): boolean {
    return this.micDesired && !this.useHeadphones && this.isSpeaking;
  }

  /** Guards automatic message submission while speaker output is in progress. */
  canPauseTimerFire(): boolean {
    return this.isRecognitionActive() && !this.isPausedForSpeaking();
  }

  enableMic(): { startRecognition: boolean } {
    this.micDesired = true;
    return { startRecognition: this.isRecognitionActive() };
  }

  disableMic(): { stopRecognition: boolean; cancelTimer: boolean } {
    this.micDesired = false;
    return { stopRecognition: true, cancelTimer: true };
  }

  /** Pauses recognition, drops unconfirmed text and cancels send timer when speaker output begins. */
  onSpeakingStarted(): { abortRecognition: boolean; dropInterim: boolean; cancelTimer: boolean } {
    this.isSpeaking = true;
    if (!this.useHeadphones && this.micDesired) {
      return { abortRecognition: true, dropInterim: true, cancelTimer: true };
    }
    return { abortRecognition: false, dropInterim: false, cancelTimer: false };
  }

  /** Resumes recognition when speaker audio finishes if the mic toggle is still active. */
  onSpeakingEnded(): { resumeRecognition: boolean } {
    this.isSpeaking = false;
    if (!this.useHeadphones && this.micDesired) {
      return { resumeRecognition: true };
    }
    return { resumeRecognition: false };
  }

  /** Pressing Escape interrupts any active spoken reply so the mic resumes immediately. */
  onEscape(): { stopSpeaking: boolean } {
    if (this.isSpeaking) {
      return { stopSpeaking: true };
    }
    return { stopSpeaking: false };
  }

  /** Voice barge-in is permitted in full-duplex headphones mode only. */
  onBargeIn(): { stopSpeaking: boolean } {
    if (this.useHeadphones && this.isSpeaking) {
      return { stopSpeaking: true };
    }
    return { stopSpeaking: false };
  }
}
