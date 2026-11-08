import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ROOT } from "../engine/config";
import { KOKORO_ASSETS, KOKORO_PIP_PINS } from "./kokoro-assets";

const setupScript = readFileSync(join(APP_ROOT, "container", "setup.sh"), "utf8");
const containerfile = readFileSync(join(APP_ROOT, "container", "Containerfile"), "utf8");

function shellValue(name: string): string {
  const match = new RegExp(`^${name}="([^"]+)"$`, "m").exec(setupScript);
  if (!match?.[1]) throw new Error(`${name} is missing from container/setup.sh`);
  return match[1];
}

describe("Kokoro assets stay in step with the container scripts", () => {
  const variables: Record<string, { url: string; sha: string }> = {
    "kokoro-v1.0.onnx": { url: "KOKORO_MODEL_URL", sha: "KOKORO_MODEL_SHA256" },
    "voices-v1.0.bin": { url: "KOKORO_VOICES_URL", sha: "KOKORO_VOICES_SHA256" },
  };

  it("covers both model files", () => {
    expect(KOKORO_ASSETS.map((asset) => asset.fileName).sort()).toEqual(Object.keys(variables).sort());
  });

  for (const asset of KOKORO_ASSETS) {
    it(`${asset.fileName} has the same URL and checksum in container/setup.sh`, () => {
      const names = variables[asset.fileName]!;
      expect(shellValue(names.url)).toBe(asset.url);
      expect(shellValue(names.sha)).toBe(asset.sha256);
    });
  }

  for (const pin of KOKORO_PIP_PINS) {
    it(`${pin} is pinned the same way in container/Containerfile`, () => {
      expect(containerfile).toMatch(new RegExp(`^\\s+${pin.replace(/[.+]/g, "\\$&")}\\s*(\\\\)?$`, "m"));
    });
  }
});
