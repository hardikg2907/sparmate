export const REASON_ON_DEVICE_UNAVAILABLE = "Voice input needs on-device speech recognition in Chrome";

export type SpeechRecognitionAvailability =
  { status: "available" } | { status: "downloadable"; install: () => Promise<void> } | { status: "downloading" } | { status: "unavailable"; reason: string };

export interface SpeechRecognitionConstructor {
  new (): unknown;
  available?: (options: { langs: string[]; processLocally: boolean }) => Promise<string>;
  install?: (options: { langs: string[]; processLocally: boolean }) => Promise<void>;
}

/** Checks for on-device speech recognition capability without network fallback. */
export async function checkSpeechRecognitionAvailability(RecognitionClass?: SpeechRecognitionConstructor | null): Promise<SpeechRecognitionAvailability> {
  if (!RecognitionClass || typeof RecognitionClass.available !== "function") {
    return { status: "unavailable", reason: REASON_ON_DEVICE_UNAVAILABLE };
  }

  try {
    const result = await RecognitionClass.available({ langs: ["en-US"], processLocally: true });
    if (result === "available" || result === "readily") {
      return { status: "available" };
    }
    if (result === "downloadable" || result === "after-download") {
      return {
        status: "downloadable",
        install: async () => {
          if (typeof RecognitionClass.install === "function") {
            await RecognitionClass.install({ langs: ["en-US"], processLocally: true });
          }
        },
      };
    }
    if (result === "downloading") {
      return { status: "downloading" };
    }
    return { status: "unavailable", reason: REASON_ON_DEVICE_UNAVAILABLE };
  } catch {
    return { status: "unavailable", reason: REASON_ON_DEVICE_UNAVAILABLE };
  }
}
