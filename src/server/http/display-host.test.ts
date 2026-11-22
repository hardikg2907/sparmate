import { describe, expect, it } from "vitest";
import { displayHost } from "./display-host";

describe("displayHost", () => {
  it("uses the friendly name when it resolves to loopback only", async () => {
    expect(await displayHost(async () => [{ address: "127.0.0.1" }, { address: "::1" }])).toBe("sparmate.localhost");
  });

  it("falls back to the IP when the name does not resolve", async () => {
    expect(await displayHost(async () => Promise.reject(new Error("ENOTFOUND")))).toBe("127.0.0.1");
    expect(await displayHost(async () => [])).toBe("127.0.0.1");
  });

  it("falls back to the IP when any answer is not loopback", async () => {
    expect(await displayHost(async () => [{ address: "127.0.0.1" }, { address: "203.0.113.7" }])).toBe("127.0.0.1");
  });
});
