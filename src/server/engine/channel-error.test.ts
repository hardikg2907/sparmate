import { describe, expect, it } from "vitest";
import { plainMessage } from "./claude-driver";
import { channelErrorText } from "./runtime";

describe("channelErrorText", () => {
  it.each([
    ["The model process stopped. Retry.", "The model process stopped."],
    ["The model could not answer. Retry.", "The model could not answer."],
    ["The model service is busy or failing. Retry in a moment.", "The model service is busy or failing. Wait a moment."],
    ["The model is rate limited right now. Wait a minute, then retry.", "The model is rate limited right now. Wait a minute."],
    ["The Claude login did not work. Run claude in a terminal, log in, then retry.", "The Claude login did not work. Run claude in a terminal, log in."],
    ["The chosen model is not available. Pick another model in settings, then retry.", "The chosen model is not available. Pick another model in settings."],
    ["The model took too many steps and was stopped. Retry.", "The model took too many steps and was stopped."],
    ["The conversation was closed.", "The conversation was closed."],
    ["Retry.", "Retry."],
  ])("turns %j into %j", (input, expected) => {
    expect(channelErrorText(input)).toBe(expected);
  });

  it("leaves no Retry word and a full stop in every message the driver can produce", () => {
    const kinds = [
      "authentication_failed",
      "oauth_org_not_allowed",
      "account_on_hold",
      "verification_required",
      "billing_error",
      "cloud_credential_error",
      "rate_limit",
      "overloaded",
      "server_error",
      "model_not_found",
      "max_output_tokens",
      "unknown",
      null,
    ] as const;
    const statuses = [null, undefined, 401, 403, 429, 500, 503, 400];
    const messages = new Set<string>([
      "The model process stopped. Retry.",
      "The model process stopped early. Retry.",
      "The model took too many steps and was stopped. Retry.",
      "The model could not produce valid structured data. Retry.",
      "The model returned data in the wrong shape. Retry.",
      "The model's reply was too long and was cut off. Retry.",
    ]);
    for (const kind of kinds) for (const status of statuses) messages.add(plainMessage(kind as never, status));
    for (const message of messages) {
      const shown = channelErrorText(message);
      expect(shown, message).not.toMatch(/retry/i);
      expect(shown, message).toMatch(/\.$/);
      expect(shown, message).not.toMatch(/, then\b|\s\./);
    }
  });
});
