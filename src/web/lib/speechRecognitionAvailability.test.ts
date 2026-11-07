import { describe, expect, it, vi } from "vitest";
import {
  checkSpeechRecognitionAvailability,
  REASON_ON_DEVICE_UNAVAILABLE,
  type SpeechRecognitionConstructor,
} from "./speechRecognitionAvailability";

describe("checkSpeechRecognitionAvailability", () => {
  it("returns unavailable when no SpeechRecognition class exists", async () => {
    const res = await checkSpeechRecognitionAvailability(null);
    expect(res).toEqual({ status: "unavailable", reason: REASON_ON_DEVICE_UNAVAILABLE });
  });

  it("returns unavailable when available() static method is missing", async () => {
    class FakeRecognition {}
    const res = await checkSpeechRecognitionAvailability(FakeRecognition as unknown as SpeechRecognitionConstructor);
    expect(res).toEqual({ status: "unavailable", reason: REASON_ON_DEVICE_UNAVAILABLE });
  });

  it("returns available when available() resolves readily", async () => {
    class FakeRecognition {
      static available = vi.fn().mockResolvedValue("readily");
    }
    const res = await checkSpeechRecognitionAvailability(FakeRecognition as unknown as SpeechRecognitionConstructor);
    expect(res).toEqual({ status: "available" });
    expect(FakeRecognition.available).toHaveBeenCalledWith({ langs: ["en-US"], processLocally: true });
  });

  it("returns available when available() resolves available", async () => {
    class FakeRecognition {
      static available = vi.fn().mockResolvedValue("available");
    }
    const res = await checkSpeechRecognitionAvailability(FakeRecognition as unknown as SpeechRecognitionConstructor);
    expect(res).toEqual({ status: "available" });
  });

  it("returns downloadable with install function when model is downloadable", async () => {
    const install = vi.fn().mockResolvedValue(undefined);
    class FakeRecognition {
      static available = vi.fn().mockResolvedValue("downloadable");
      static install = install;
    }
    const res = await checkSpeechRecognitionAvailability(FakeRecognition as unknown as SpeechRecognitionConstructor);
    expect(res.status).toBe("downloadable");
    if (res.status === "downloadable") {
      await res.install();
      expect(install).toHaveBeenCalledWith({ langs: ["en-US"], processLocally: true });
    }
  });

  it("returns downloading when model is currently downloading", async () => {
    class FakeRecognition {
      static available = vi.fn().mockResolvedValue("downloading");
    }
    const res = await checkSpeechRecognitionAvailability(FakeRecognition as unknown as SpeechRecognitionConstructor);
    expect(res).toEqual({ status: "downloading" });
  });

  it("returns unavailable with reason when available() resolves unavailable or throws", async () => {
    class FakeRecognition {
      static available = vi.fn().mockResolvedValue("unavailable");
    }
    const res = await checkSpeechRecognitionAvailability(FakeRecognition as unknown as SpeechRecognitionConstructor);
    expect(res).toEqual({ status: "unavailable", reason: REASON_ON_DEVICE_UNAVAILABLE });

    class ThrowingRecognition {
      static available = vi.fn().mockRejectedValue(new Error("check failed"));
    }
    const res2 = await checkSpeechRecognitionAvailability(ThrowingRecognition as unknown as SpeechRecognitionConstructor);
    expect(res2).toEqual({ status: "unavailable", reason: REASON_ON_DEVICE_UNAVAILABLE });
  });
});
