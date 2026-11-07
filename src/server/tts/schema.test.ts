import { describe, expect, it } from "vitest";
import { KOKORO_VOICES, kokoroVoiceLang, TtsRequestSchema } from "./schema";

describe("TtsRequestSchema", () => {
  it("accepts valid requests across allow-listed voices and speed bounds", () => {
    for (const voice of KOKORO_VOICES) {
      const valid = { text: "Hello from mock interview.", voice, speed: 0.95 };
      expect(TtsRequestSchema.safeParse(valid).success).toBe(true);
    }
    expect(TtsRequestSchema.safeParse({ text: "a", voice: "bm_george", speed: 0.6 }).success).toBe(true);
    expect(TtsRequestSchema.safeParse({ text: "x".repeat(600), voice: "af_heart", speed: 1.6 }).success).toBe(true);
  });

  it("rejects text outside 1..600 characters", () => {
    expect(TtsRequestSchema.safeParse({ text: "", voice: "bm_george", speed: 1.0 }).success).toBe(false);
    expect(TtsRequestSchema.safeParse({ text: "x".repeat(601), voice: "bm_george", speed: 1.0 }).success).toBe(false);
  });

  it("rejects disallowed voices", () => {
    expect(TtsRequestSchema.safeParse({ text: "Hi", voice: "en_unknown", speed: 1.0 }).success).toBe(false);
    expect(TtsRequestSchema.safeParse({ text: "Hi", voice: "bm_david", speed: 1.0 }).success).toBe(false);
  });

  it("rejects speed rates outside 0.6..1.6", () => {
    expect(TtsRequestSchema.safeParse({ text: "Hi", voice: "bm_george", speed: 0.59 }).success).toBe(false);
    expect(TtsRequestSchema.safeParse({ text: "Hi", voice: "bm_george", speed: 1.61 }).success).toBe(false);
  });

  it("rejects extra unknown properties because schema is strict", () => {
    const withExtra = { text: "Hi", voice: "bm_george", speed: 1.0, extra: "not allowed" };
    expect(TtsRequestSchema.safeParse(withExtra).success).toBe(false);
  });

  it("maps British voices to en-gb and American voices to en-us", () => {
    expect(kokoroVoiceLang("bm_george")).toBe("en-gb");
    expect(kokoroVoiceLang("bm_lewis")).toBe("en-gb");
    expect(kokoroVoiceLang("bf_emma")).toBe("en-gb");
    expect(kokoroVoiceLang("bf_isabella")).toBe("en-gb");
    expect(kokoroVoiceLang("am_michael")).toBe("en-us");
    expect(kokoroVoiceLang("am_adam")).toBe("en-us");
    expect(kokoroVoiceLang("af_heart")).toBe("en-us");
    expect(kokoroVoiceLang("af_bella")).toBe("en-us");
  });
});
