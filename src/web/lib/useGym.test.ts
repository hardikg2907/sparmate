import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../backend";
import { refreshGym, resetGymStore } from "./useGym";

afterEach(() => {
  resetGymStore();
  vi.restoreAllMocks();
  vi.useRealTimers();
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

  it("asks again when the day turned while a request ran", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 8, 23, 59, 59));
    let answer: (value: never) => void = () => {};
    const spy = vi
      .spyOn(api, "gym")
      .mockImplementationOnce(() => new Promise<never>((resolve) => (answer = resolve)))
      .mockResolvedValue({ dueCount: 3 } as never);
    refreshGym();
    vi.setSystemTime(new Date(2026, 10, 9, 0, 0, 1));
    refreshGym();
    expect(spy).toHaveBeenCalledTimes(1);
    answer({ dueCount: 2 } as never);
    await vi.runAllTimersAsync();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("does not ask again when the request ends on the day it began", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 8, 12, 0, 0));
    const spy = vi.spyOn(api, "gym").mockResolvedValue({ dueCount: 2 } as never);
    refreshGym();
    await vi.runAllTimersAsync();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
