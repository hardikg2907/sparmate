import type { LIMITS } from "../../shared/protocol";
import type { Settings } from "../../shared/types";

// The browser does not import the shared schema modules for values. They build zod schemas at load, and zod
// probes eval while doing so, which the page's content security policy reports as an error on every load.
// The annotations tie each copy to the shared constant, so a change there is a compile error here.
type Limits = typeof LIMITS;

export const CHAT_MAX_CHARS: Limits["chatChars"] = 8000;
export const PNG_MAX_BASE64: Limits["pngBase64Bytes"] = 6_000_000;

export const KOKORO_VOICES = [
  "bm_george",
  "bm_lewis",
  "bf_emma",
  "bf_isabella",
  "am_michael",
  "am_adam",
  "af_heart",
  "af_bella",
] as const;

export type KokoroVoice = (typeof KOKORO_VOICES)[number];

export const KOKORO_VOICE_LABELS: Record<KokoroVoice, string> = {
  bm_george: "George (British Male)",
  bm_lewis: "Lewis (British Male)",
  bf_emma: "Emma (British Female)",
  bf_isabella: "Isabella (British Female)",
  am_michael: "Michael (American Male)",
  am_adam: "Adam (American Male)",
  af_heart: "Heart (American Female)",
  af_bella: "Bella (American Female)",
};

export const KOKORO_DEFAULT_VOICE: KokoroVoice = "bm_george";
export const KOKORO_DEFAULT_SPEED = 0.95;


/** Equal to the server's defaults; a test keeps the two in step. */
export const DEFAULT_SETTINGS: Settings = {
  models: { interviewer: "claude-opus-5-5", judge: "claude-opus-5-5", coach: "claude-opus-5-5", scribe: "claude-opus-5-5" },
  effort: { interviewer: "low", judge: "high", coach: "medium", scribe: "medium" },
  durations: { hld: 45, lld: 120 },
  theme: "dark",
};
