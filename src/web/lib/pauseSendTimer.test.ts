import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PauseSendTimer } from "./pauseSendTimer";

describe("PauseSendTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires onSend after 2 seconds of silence", () => {
    const onSend = vi.fn();
    const timer = new PauseSendTimer({ pauseMs: 2000, onSend });

    timer.onSpeechPause("Hello from voice");
    expect(timer.isPending()).toBe(true);
    expect(onSend).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1999);
    expect(onSend).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("Hello from voice");
    expect(timer.isPending()).toBe(false);
  });

  it("resets the countdown when speech activity occurs before timeout", () => {
    const onSend = vi.fn();
    const timer = new PauseSendTimer({ pauseMs: 2000, onSend });

    timer.onSpeechPause("First phrase");
    vi.advanceTimersByTime(1500);

    // More speech detected before the 2 seconds finish.
    timer.onSpeechActivity();
    expect(timer.isPending()).toBe(false);

    vi.advanceTimersByTime(2000);
    expect(onSend).not.toHaveBeenCalled();

    // User finishes speaking new sentence.
    timer.onSpeechPause("First phrase continued");
    vi.advanceTimersByTime(2000);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("First phrase continued");
  });

  it("ignores whitespace or empty text", () => {
    const onSend = vi.fn();
    const timer = new PauseSendTimer({ pauseMs: 2000, onSend });

    timer.onSpeechPause("   ");
    expect(timer.isPending()).toBe(false);

    vi.advanceTimersByTime(3000);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("cancels pending submission when explicitly requested", () => {
    const onSend = vi.fn();
    const timer = new PauseSendTimer({ pauseMs: 2000, onSend });

    timer.onSpeechPause("Some speech");
    timer.cancel();
    expect(timer.isPending()).toBe(false);

    vi.advanceTimersByTime(3000);
    expect(onSend).not.toHaveBeenCalled();
  });
});
