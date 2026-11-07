import { describe, expect, it } from "vitest";
import { pickDefaultSystemVoice, rankSystemVoices } from "./systemVoiceRanking";

function makeVoice(name: string, lang: string, localService: boolean): SpeechSynthesisVoice {
  return {
    name,
    lang,
    localService,
    default: false,
    voiceURI: `${name}-${lang}`,
  };
}

describe("systemVoiceRanking", () => {
  it("filters out cloud voices where localService is false", () => {
    const voices = [
      makeVoice("Siri (Network)", "en-US", false),
      makeVoice("Daniel", "en-GB", true),
      makeVoice("Google US English", "en-US", false),
    ];
    const ranked = rankSystemVoices(voices);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.name).toBe("Daniel");
  });

  it("ranks (Premium) voices ahead of (Enhanced) voices and standard voices", () => {
    const voices = [
      makeVoice("Samantha (Enhanced)", "en-US", true),
      makeVoice("Samantha (Premium)", "en-US", true),
      makeVoice("Alex", "en-US", true),
      makeVoice("Thomas", "fr-FR", true),
    ];
    const ranked = rankSystemVoices(voices);
    expect(ranked.map((v) => v.name)).toEqual([
      "Samantha (Premium)",
      "Samantha (Enhanced)",
      "Alex",
      "Thomas",
    ]);
  });

  it("prefers English voices over foreign language voices within the same tier", () => {
    const voices = [
      makeVoice("Amelie (Enhanced)", "fr-FR", true),
      makeVoice("Oliver (Enhanced)", "en-GB", true),
      makeVoice("Anna", "de-DE", true),
      makeVoice("Victoria", "en-US", true),
    ];
    const ranked = rankSystemVoices(voices);
    expect(ranked.map((v) => v.name)).toEqual([
      "Oliver (Enhanced)",
      "Amelie (Enhanced)",
      "Victoria",
      "Anna",
    ]);
  });

  it("picks the best default voice: (Premium), then (Enhanced), then any English", () => {
    const withPremium = [
      makeVoice("Alex", "en-US", true),
      makeVoice("Ava (Premium)", "en-US", true),
      makeVoice("Oliver (Enhanced)", "en-GB", true),
    ];
    expect(pickDefaultSystemVoice(withPremium)?.name).toBe("Ava (Premium)");

    const withEnhanced = [
      makeVoice("Alex", "en-US", true),
      makeVoice("Oliver (Enhanced)", "en-GB", true),
    ];
    expect(pickDefaultSystemVoice(withEnhanced)?.name).toBe("Oliver (Enhanced)");

    const onlyStandard = [
      makeVoice("Thomas", "fr-FR", true),
      makeVoice("Alex", "en-US", true),
    ];
    expect(pickDefaultSystemVoice(onlyStandard)?.name).toBe("Alex");

    expect(pickDefaultSystemVoice([])).toBeUndefined();
  });
});
