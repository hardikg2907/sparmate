import { describe, expect, it } from "vitest";
import { DictationTranscript, type RecognitionResultEvent } from "./dictation";

/** A recognizer session's results so far, as `[text, isFinal]`, with the index of the first one that changed. */
const ev = (resultIndex: number, ...results: [string, boolean][]): RecognitionResultEvent => ({
  resultIndex,
  results: results.map(([transcript, isFinal]) => ({ isFinal, 0: { transcript } })),
});

describe("DictationTranscript", () => {
  it("adds finished phrases and the phrase in progress after the text the box held", () => {
    const d = new DictationTranscript();
    d.begin("Hello.");
    expect(d.result(ev(0, ["we want", false])).text).toBe("Hello. we want");
    expect(d.result(ev(0, ["we want expiry", true])).text).toBe("Hello. we want expiry");
    const next = d.result(ev(1, ["we want expiry", true], ["and custom", false]));
    expect(next).toEqual({ text: "Hello. we want expiry and custom", heardFinal: false, hearing: true });
  });

  it("keeps a phrase he deleted gone when the recognizer finishes it", () => {
    const d = new DictationTranscript();
    d.begin("");
    d.result(ev(0, ["But we want to add support for", true]));
    d.result(ev(1, ["But we want to add support for", true], ["do we want", false]));
    d.edit("");
    // The same phrase is finished after the edit, then he says something new.
    expect(d.result(ev(1, ["But we want to add support for", true], ["do we want to add support", true])).text).toBe("");
    const after = d.result(ev(2, ["But we want to add support for", true], ["do we want to add support", true], ["custom aliases", false]));
    expect(after.text).toBe("custom aliases");
  });

  it("starts from what he typed, keeping his wording", () => {
    const d = new DictationTranscript();
    d.begin("");
    d.result(ev(0, ["shorten links", true]));
    d.edit("Shorten links, with expiry");
    expect(d.result(ev(1, ["shorten links", true], ["and analytics", true])).text).toBe("Shorten links, with expiry and analytics");
  });

  it("counts results from zero again after the recognizer restarts", () => {
    const d = new DictationTranscript();
    d.begin("");
    d.result(ev(0, ["one", true], ["two", false]));
    d.edit("one");
    d.restart();
    expect(d.result(ev(0, ["three", true])).text).toBe("one three");
  });

  it("keeps every finished phrase when the phrase in progress is dropped, even with an empty start", () => {
    const d = new DictationTranscript();
    d.begin("");
    d.result(ev(0, ["read heavy", true], ["with spik", false]));
    expect(d.dropInterim()).toBe("read heavy");
    d.begin("read heavy");
    expect(d.result(ev(0, ["viral spikes", true])).text).toBe("read heavy viral spikes");
  });

  it("clears to nothing after a send, and the sent phrase does not return", () => {
    const d = new DictationTranscript();
    d.begin("");
    d.result(ev(0, ["send this", false]));
    d.edit("");
    expect(d.result(ev(0, ["send this", true])).text).toBe("");
    expect(d.result(ev(1, ["send this", true], ["next one", true])).text).toBe("next one");
  });
});
