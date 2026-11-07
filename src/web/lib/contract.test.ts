import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS as SERVER_DEFAULTS } from "../../shared/types";
import { DEFAULT_SETTINGS } from "./contract";

describe("browser copies of shared constants", () => {
  it("keeps the default settings equal to the server's", () => {
    expect(DEFAULT_SETTINGS).toEqual(SERVER_DEFAULTS);
  });
});
