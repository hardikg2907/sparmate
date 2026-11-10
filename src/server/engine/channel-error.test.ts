import { describe, expect, it } from "vitest";
import { channelErrorText } from "./runtime";

describe("channelErrorText", () => {
  it.each([
    ["The model process stopped. Retry.", "The model process stopped."],
    ["The model could not answer. Retry.", "The model could not answer."],
    ["The model service is busy or failing. Retry in a moment.", "The model service is busy or failing."],
    ["The model is rate limited right now. Wait a minute, then retry.", "The model is rate limited right now. Wait a minute."],
    ["The Claude login did not work. Run claude in a terminal, log in, then retry.", "The Claude login did not work. Run claude in a terminal, log in."],
    ["The chosen model is not available. Pick another model in settings, then retry.", "The chosen model is not available. Pick another model in settings."],
    ["The model took too many steps and was stopped. Retry.", "The model took too many steps and was stopped."],
    ["The conversation was closed.", "The conversation was closed."],
    ["Retry.", "Retry."],
  ])("turns %j into %j", (input, expected) => {
    expect(channelErrorText(input)).toBe(expected);
  });
});
