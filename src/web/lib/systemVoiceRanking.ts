/** Assigns higher rank to local on-device voices that provide superior synthesis quality. */
function getVoicePriority(voice: SpeechSynthesisVoice): number {
  const isEnglish = voice.lang.toLowerCase().startsWith("en");
  const hasPremium = voice.name.includes("(Premium)");
  const hasEnhanced = voice.name.includes("(Enhanced)");

  if (isEnglish && hasPremium) return 60;
  if (hasPremium) return 50;
  if (isEnglish && hasEnhanced) return 40;
  if (hasEnhanced) return 30;
  if (isEnglish) return 20;
  return 10;
}

/** Filters to local on-device voices only and ranks them by quality tier with English preferred. */
export function rankSystemVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  // Remote cloud voices send audio off the Mac and are omitted for privacy.
  const localOnly = voices.filter((v) => v.localService === true);

  return [...localOnly].sort((a, b) => {
    const scoreA = getVoicePriority(a);
    const scoreB = getVoicePriority(b);
    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }
    return a.name.localeCompare(b.name);
  });
}

/** Selects the optimal default system voice: (Premium), then (Enhanced), then any English voice. */
export function pickDefaultSystemVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const ranked = rankSystemVoices(voices);
  return ranked[0];
}
