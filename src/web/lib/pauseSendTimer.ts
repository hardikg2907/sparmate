export interface PauseSendTimerOptions {
  pauseMs?: number;
  onSend: (text: string) => void;
}

/** Schedules automatic message submission after silence following spoken input. */
export class PauseSendTimer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingText = "";
  private readonly pauseMs: number;
  private readonly onSend: (text: string) => void;

  constructor(options: PauseSendTimerOptions) {
    this.pauseMs = options.pauseMs ?? 2000;
    this.onSend = options.onSend;
  }

  /** Clears any pending countdown when live speech is detected. */
  onSpeechActivity(): void {
    this.cancel();
  }

  /** Begins the silence countdown once speech pauses with non-empty text. */
  onSpeechPause(text: string): void {
    this.cancel();
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    this.pendingText = trimmed;
    this.timer = setTimeout(() => {
      this.timer = null;
      const toSend = this.pendingText;
      this.pendingText = "";
      this.onSend(toSend);
    }, this.pauseMs);
  }

  /** Cancels any scheduled submission. */
  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pendingText = "";
  }

  /** Checks whether a message submission is currently scheduled. */
  isPending(): boolean {
    return this.timer !== null;
  }
}
