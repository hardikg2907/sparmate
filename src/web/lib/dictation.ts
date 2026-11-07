/** The parts of a browser speech-recognition result event that dictation reads. */
export interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

export interface DictationUpdate {
  /** What the chat box shows now. */
  text: string;
  /** A phrase was finished in this event. */
  heardFinal: boolean;
  /** A phrase is still being heard. */
  hearing: boolean;
}

const join = (...parts: string[]) =>
  parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(" ");

/**
 * The chat box while he dictates: the text it held, then each finished phrase, then the phrase still being heard.
 * His own edits win. Once he types, his text becomes the new start, and every phrase heard before the edit is
 * dropped, the unfinished one included, because he saw it on screen and changed it; when the recognizer later
 * finishes that phrase it must not come back.
 */
export class DictationTranscript {
  private base = "";
  private confirmed = "";
  private interim = "";
  /** A result below this index was heard before his last edit. */
  private skipBelow = 0;
  private seen = 0;

  /** A recognizer session numbers its results from zero, so a new or restarted one starts the count again. */
  begin(base: string): void {
    this.base = base;
    this.confirmed = "";
    this.interim = "";
    this.restart();
  }

  restart(): void {
    this.skipBelow = 0;
    this.seen = 0;
  }

  edit(text: string): void {
    this.base = text;
    this.confirmed = "";
    this.interim = "";
    this.skipBelow = this.seen;
  }

  result(event: RecognitionResultEvent): DictationUpdate {
    let finalChunk = "";
    let interim = "";
    for (let i = Math.max(event.resultIndex, this.skipBelow); i < event.results.length; i++) {
      const res = event.results[i]!;
      if (res.isFinal) finalChunk += res[0].transcript;
      else interim += res[0].transcript;
    }
    this.seen = Math.max(this.seen, event.results.length);
    if (finalChunk.trim()) this.confirmed = join(this.confirmed, finalChunk);
    this.interim = interim.trim();
    return { text: this.text(), heardFinal: finalChunk.trim() !== "", hearing: this.interim !== "" };
  }

  /** Keeps every finished phrase and drops the one still being heard; returns the box's new text. */
  dropInterim(): string {
    this.base = join(this.base, this.confirmed);
    this.confirmed = "";
    this.interim = "";
    return this.base;
  }

  text(): string {
    return join(this.base, this.confirmed, this.interim);
  }
}
