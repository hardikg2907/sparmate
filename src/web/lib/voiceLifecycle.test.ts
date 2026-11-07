import { describe, expect, it, vi } from "vitest";
import { VoiceInputLifecycle, VoiceOutputLifecycle } from "./voiceLifecycle";

class MockSpeechRecognition {
  starts = 0;
  aborts = 0;
  onend: (() => void) | null = null;
  onresult: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onspeechstart: (() => void) | null = null;
  onsoundstart: (() => void) | null = null;

  start() {
    this.starts++;
  }

  abort() {
    this.aborts++;
    if (this.onend) {
      this.onend();
    }
  }

  stop() {
    if (this.onend) {
      this.onend();
    }
  }
}

class MockAudio {
  src = "";
  paused = true;
  plays = 0;
  pauses = 0;
  loads = 0;
  removedAttributes: string[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;

  play() {
    this.plays++;
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.pauses++;
    this.paused = true;
  }

  removeAttribute(attr: string) {
    this.removedAttributes.push(attr);
  }

  load() {
    this.loads++;
  }
}

describe("VoiceInputLifecycle", () => {
  it("unmount stops and detaches the recognizer and no restart happens after unmount", () => {
    let mockRecInstance: MockSpeechRecognition | null = null;
    const session = new VoiceInputLifecycle({
      getSpeechClass: () => {
        return function () {
          mockRecInstance = new MockSpeechRecognition();
          return mockRecInstance;
        } as any;
      },
      getAvailabilityStatus: () => "available",
      isDisabled: () => false,
      isActive: () => true,
      getSendMode: () => "review",
      onSend: () => true,
      onBargeIn: () => {},
      getDraft: () => "",
      setDraft: () => {},
    });

    session.toggleListening();
    expect(session.getIsListening()).toBe(true);
    expect(mockRecInstance!.starts).toBe(1);

    // Unmount/dispose tears down recognizer and handlers.
    session.dispose();
    expect(session.getIsListening()).toBe(false);
    expect(session.getActiveRecognizer()).toBe(null);
    expect(mockRecInstance!.aborts).toBe(1);
    expect(mockRecInstance!.onend).toBe(null);

    // Any late event from browser must not restart.
    mockRecInstance!.onend?.();
    expect(session.getIsListening()).toBe(false);
    expect(mockRecInstance!.starts).toBe(1);
  });

  it("a late onend from an old recognizer does nothing", () => {
    const instances: MockSpeechRecognition[] = [];
    const session = new VoiceInputLifecycle({
      getSpeechClass: () => {
        const inst = new MockSpeechRecognition();
        instances.push(inst);
        return function () {
          return inst;
        } as any;
      },
      getAvailabilityStatus: () => "available",
      isDisabled: () => false,
      isActive: () => true,
      getSendMode: () => "review",
      onSend: () => true,
      onBargeIn: () => {},
      getDraft: () => "",
      setDraft: () => {},
    });

    session.toggleListening();
    const firstRec = instances[0]!;
    expect(firstRec.starts).toBe(1);

    // Stop recognition.
    session.stopListening();
    expect(firstRec.aborts).toBe(1);

    // Late onend arriving from first instance.
    firstRec.onend?.();
    expect(firstRec.starts).toBe(1);
    expect(session.getIsListening()).toBe(false);
  });

  it("double toggle leaves one recognizer or stops cleanly", () => {
    const instances: MockSpeechRecognition[] = [];
    const session = new VoiceInputLifecycle({
      getSpeechClass: () => {
        const inst = new MockSpeechRecognition();
        instances.push(inst);
        return function () {
          return inst;
        } as any;
      },
      getAvailabilityStatus: () => "available",
      isDisabled: () => false,
      isActive: () => true,
      getSendMode: () => "review",
      onSend: () => true,
      onBargeIn: () => {},
      getDraft: () => "",
      setDraft: () => {},
    });

    // Start listening.
    session.toggleListening();
    expect(instances.length).toBe(1);
    expect(session.getIsListening()).toBe(true);

    // Calling startListening again while already listening is idempotent.
    const secondStart = session.startListening();
    expect(secondStart).toBe(false);
    expect(instances.length).toBe(1);

    // Second toggle turns mic off cleanly.
    session.toggleListening();
    expect(session.getIsListening()).toBe(false);
    expect(session.getActiveRecognizer()).toBe(null);
  });

  it("Ctrl+M while disabled does nothing and does not arm mic", () => {
    let disabled = true;
    const instances: MockSpeechRecognition[] = [];
    const session = new VoiceInputLifecycle({
      getSpeechClass: () => {
        const inst = new MockSpeechRecognition();
        instances.push(inst);
        return function () {
          return inst;
        } as any;
      },
      getAvailabilityStatus: () => "available",
      isDisabled: () => disabled,
      isActive: () => true,
      getSendMode: () => "review",
      onSend: () => true,
      onBargeIn: () => {},
      getDraft: () => "",
      setDraft: () => {},
    });

    const preventDefault = vi.fn();
    const handled = session.handleKeyDown({
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      key: "m",
      preventDefault,
    });

    expect(handled).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(session.getIsListening()).toBe(false);
    expect(session.getUserMicEnabled()).toBe(false);
    expect(instances.length).toBe(0);

    // Unpausing must not auto-start recognition.
    disabled = false;
    session.onSpeakingEnded();
    expect(session.getIsListening()).toBe(false);
    expect(instances.length).toBe(0);
  });

  it("Ctrl+M while panel is not active/visible does nothing", () => {
    const instances: MockSpeechRecognition[] = [];
    const session = new VoiceInputLifecycle({
      getSpeechClass: () => {
        const inst = new MockSpeechRecognition();
        instances.push(inst);
        return function () {
          return inst;
        } as any;
      },
      getAvailabilityStatus: () => "available",
      isDisabled: () => false,
      isActive: () => false,
      getSendMode: () => "review",
      onSend: () => true,
      onBargeIn: () => {},
      getDraft: () => "",
      setDraft: () => {},
    });

    const preventDefault = vi.fn();
    const handled = session.handleKeyDown({
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      key: "m",
      preventDefault,
    });

    expect(handled).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(session.getIsListening()).toBe(false);
  });

  it("an edit he types wins: the deleted phrase does not come back, and a pending pause-send of the old text is dropped", () => {
    vi.useFakeTimers();
    try {
      let rec: MockSpeechRecognition | null = null;
      let draft = "";
      const sent: string[] = [];
      const session = new VoiceInputLifecycle({
        getSpeechClass: () =>
          function () {
            rec = new MockSpeechRecognition();
            return rec;
          } as any,
        getAvailabilityStatus: () => "available",
        isDisabled: () => false,
        isActive: () => true,
        getSendMode: () => "pause",
        onSend: (text) => (sent.push(text), true),
        onBargeIn: () => {},
        getDraft: () => draft,
        setDraft: (value) => {
          draft = value;
        },
      });
      const result = (resultIndex: number, ...results: [string, boolean][]) =>
        rec!.onresult?.({ resultIndex, results: results.map(([transcript, isFinal]) => ({ isFinal, 0: { transcript } })) });

      session.toggleListening();
      // A finished phrase arms the pause-send with the text as it stood.
      result(0, ["But we want to add support for", true]);
      draft = "But we want";
      session.noteTypedDraft(draft);
      vi.advanceTimersByTime(3_000);
      expect(sent).toEqual([]);

      // A phrase heard after the edit adds to it; then he deletes everything while that phrase is on screen.
      result(1, ["But we want to add support for", true], ["do we want", false]);
      expect(draft).toBe("But we want do we want");
      draft = "";
      session.noteTypedDraft(draft);
      result(1, ["But we want to add support for", true], ["do we want to add support", true]);
      expect(draft).toBe("");
      result(2, ["But we want to add support for", true], ["do we want to add support", true], ["custom aliases", true]);
      expect(draft).toBe("custom aliases");
      session.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("VoiceOutputLifecycle", () => {
  it("unmount stops audio and a late prefetch does not play", async () => {
    const audioInstances: MockAudio[] = [];
    let resolvePrefetch: (blob: Blob) => void;
    const prefetchPromise = new Promise<Blob>((resolve) => {
      resolvePrefetch = resolve;
    });

    const session = new VoiceOutputLifecycle({
      audioFactory: () => {
        const audio = new MockAudio();
        audioInstances.push(audio);
        return audio;
      },
      synthesizeSpeech: (_params, signal) => {
        if (signal?.aborted) return Promise.reject(new Error("aborted"));
        return prefetchPromise;
      },
      createBlobUrl: () => "blob:test-1",
      revokeBlobUrl: vi.fn(),
      getVoiceSettings: () => ({
        speakReplies: true,
        engine: "kokoro",
        kokoroVoice: "af_heart",
        kokoroSpeed: 1,
        systemVoice: "",
        voiceURI: null,
        rate: 1,
        useHeadphones: false,
        sendMode: "review",
      }),
      getVoices: () => [],
      isDisabled: () => false,
    });

    const stream = session.createStream("msg-1", ["First sentence.", "Second sentence."], false);
    const playPromise = session.playNextSentence(stream);

    // Unmount before prefetch completes.
    session.dispose();
    expect(session.isDisposed()).toBe(true);
    expect(session.getActiveStream()).toBe(null);

    // Resolve prefetch now.
    resolvePrefetch!(new Blob(["test"]));
    await playPromise;

    // No audio play must have occurred after disposal.
    expect(audioInstances.length).toBe(0);
    expect(session.getIsSpeaking()).toBe(false);
  });

  it("stopSpeaking only calls speechSynthesis.cancel if this session queued speech", () => {
    const cancelFn = vi.fn();
    const speakFn = vi.fn();
    const mockSynth = {
      speaking: false,
      speak: speakFn,
      cancel: cancelFn,
    };

    const session = new VoiceOutputLifecycle({
      getSpeechSynthesis: () => mockSynth,
      getVoiceSettings: () => ({
        speakReplies: true,
        engine: "system",
        kokoroVoice: "af_heart",
        kokoroSpeed: 1,
        systemVoice: "",
        voiceURI: null,
        rate: 1,
        useHeadphones: false,
        sendMode: "review",
      }),
      getVoices: () => [],
      isDisabled: () => false,
    });

    // Mount with no speech queued: stopSpeaking should NOT cancel global speech synthesis.
    session.stopSpeaking();
    expect(cancelFn).not.toHaveBeenCalled();

    // Now speak with system voice.
    session.speakWithSystem(["Hello there"]);
    expect(speakFn).toHaveBeenCalledTimes(1);
    expect(session.hasSystemSpeechQueued()).toBe(true);

    // Now stopSpeaking SHOULD cancel.
    session.stopSpeaking();
    expect(cancelFn).toHaveBeenCalledTimes(1);
    expect(session.hasSystemSpeechQueued()).toBe(false);
  });
});

describe("Tab hidden behavior", () => {
  it("tab hidden stops both mic and audio and mic does not auto-resume", () => {
    const inputSession = new VoiceInputLifecycle({
      getSpeechClass: () => MockSpeechRecognition as any,
      getAvailabilityStatus: () => "available",
      isDisabled: () => false,
      isActive: () => true,
      getSendMode: () => "review",
      onSend: () => true,
      onBargeIn: () => {},
      getDraft: () => "",
      setDraft: () => {},
    });

    const audioInstances: MockAudio[] = [];
    const outputSession = new VoiceOutputLifecycle({
      audioFactory: () => {
        const audio = new MockAudio();
        audioInstances.push(audio);
        return audio;
      },
      synthesizeSpeech: () => Promise.resolve(new Blob(["audio"])),
      createBlobUrl: () => "blob:audio-url",
      revokeBlobUrl: vi.fn(),
      getVoiceSettings: () => ({
        speakReplies: true,
        engine: "kokoro",
        kokoroVoice: "af_heart",
        kokoroSpeed: 1,
        systemVoice: "",
        voiceURI: null,
        rate: 1,
        useHeadphones: false,
        sendMode: "review",
      }),
      getVoices: () => [],
      isDisabled: () => false,
    });

    // Start mic and start audio.
    inputSession.toggleListening();
    expect(inputSession.getIsListening()).toBe(true);

    const stream = outputSession.createStream("msg-1", ["Test sentence."], false);
    void outputSession.playNextSentence(stream);

    // Tab becomes hidden.
    inputSession.handleVisibilityChange("hidden");
    outputSession.handleVisibilityChange("hidden");

    expect(inputSession.getIsListening()).toBe(false);
    expect(inputSession.getUserMicEnabled()).toBe(false);
    expect(outputSession.getIsSpeaking()).toBe(false);

    // Tab becomes visible again: mic must NOT auto-resume.
    inputSession.handleVisibilityChange("visible");
    expect(inputSession.getIsListening()).toBe(false);
    expect(inputSession.getUserMicEnabled()).toBe(false);
  });
});
