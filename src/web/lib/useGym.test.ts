import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../backend";
import { refreshGym, resetGymStore } from "./useGym";

afterEach(() => {
  resetGymStore();
  vi.restoreAllMocks();
});

describe("refreshGym", () => {
  it("serves every caller that asks at the same time with one request", async () => {
    const spy = vi.spyOn(api, "gym").mockResolvedValue({ dueCount: 2 } as never);
    refreshGym();
    refreshGym();
    refreshGym();
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("asks again after the first request ends", async () => {
    const spy = vi.spyOn(api, "gym").mockResolvedValue({ dueCount: 2 } as never);
    refreshGym();
    await new Promise((resolve) => setTimeout(resolve, 0));
    refreshGym();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
