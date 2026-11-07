import { describe, expect, it } from "vitest";
import { ERROR_PAUSE_TEXT, pauseText } from "./pause";

describe("pauseText", () => {
  it("says why the round is paused", () => {
    expect(pauseText("away")).toBe("Paused because the room was closed. Resume when you're ready.");
    expect(pauseText("user")).toBe("Paused.");
    expect(pauseText("restart")).toBe("Paused because the app restarted.");
  });

  it("falls back to a plain pause when the server named no reason", () => {
    expect(pauseText(null)).toBe("Paused.");
  });

  it("keeps the error wording separate, because that banner also offers Retry", () => {
    expect(ERROR_PAUSE_TEXT).toBe("The interviewer could not answer.");
  });
});
