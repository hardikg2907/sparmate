import { z } from "zod";

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

// British voices use British English phonemization; American voices use American English.
export function kokoroVoiceLang(voice: KokoroVoice): "en-gb" | "en-us" {
  return voice.startsWith("b") ? "en-gb" : "en-us";
}

export const TtsRequestSchema = z
  .object({
    text: z.string().min(1).max(600),
    voice: z.enum(KOKORO_VOICES),
    speed: z.number().min(0.6).max(1.6),
  })
  .strict();

export type TtsRequest = z.infer<typeof TtsRequestSchema>;
