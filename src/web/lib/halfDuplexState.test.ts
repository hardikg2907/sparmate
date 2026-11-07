import { describe, expect, it } from "vitest";
import { HalfDuplexController } from "./halfDuplexState";

describe("HalfDuplexController", () => {
  describe("half-duplex mode (headphones off)", () => {
    it("starts with mic off, not speaking, and recognition inactive", () => {
      const controller = new HalfDuplexController({ useHeadphones: false });
      expect(controller.isMicDesired()).toBe(false);
      expect(controller.getIsSpeaking()).toBe(false);
      expect(controller.isRecognitionActive()).toBe(false);
      expect(controller.isPausedForSpeaking()).toBe(false);
      expect(controller.canPauseTimerFire()).toBe(false);
    });

    it("activates recognition when mic is enabled and not speaking", () => {
      const controller = new HalfDuplexController({ useHeadphones: false });
      const action = controller.enableMic();
      expect(action.startRecognition).toBe(true);
      expect(controller.isRecognitionActive()).toBe(true);
      expect(controller.isPausedForSpeaking()).toBe(false);
      expect(controller.canPauseTimerFire()).toBe(true);
    });

    it("aborts recognition, drops interim text and cancels timer when speaking starts", () => {
      const controller = new HalfDuplexController({ useHeadphones: false });
      controller.enableMic();

      const speakAction = controller.onSpeakingStarted();
      expect(speakAction.abortRecognition).toBe(true);
      expect(speakAction.dropInterim).toBe(true);
      expect(speakAction.cancelTimer).toBe(true);

      expect(controller.isRecognitionActive()).toBe(false);
      expect(controller.isPausedForSpeaking()).toBe(true);
      expect(controller.canPauseTimerFire()).toBe(false);
    });

    it("resumes recognition when speaking ends if mic is still on", () => {
      const controller = new HalfDuplexController({ useHeadphones: false });
      controller.enableMic();
      controller.onSpeakingStarted();

      const endAction = controller.onSpeakingEnded();
      expect(endAction.resumeRecognition).toBe(true);
      expect(controller.isRecognitionActive()).toBe(true);
      expect(controller.isPausedForSpeaking()).toBe(false);
      expect(controller.canPauseTimerFire()).toBe(true);
    });

    it("does not resume recognition if mic was turned off during speaking", () => {
      const controller = new HalfDuplexController({ useHeadphones: false });
      controller.enableMic();
      controller.onSpeakingStarted();

      const disableAction = controller.disableMic();
      expect(disableAction.stopRecognition).toBe(true);
      expect(disableAction.cancelTimer).toBe(true);

      const endAction = controller.onSpeakingEnded();
      expect(endAction.resumeRecognition).toBe(false);
      expect(controller.isRecognitionActive()).toBe(false);
    });

    it("stops speaking and allows immediate resumption when Esc is pressed", () => {
      const controller = new HalfDuplexController({ useHeadphones: false });
      controller.enableMic();
      controller.onSpeakingStarted();

      const escAction = controller.onEscape();
      expect(escAction.stopSpeaking).toBe(true);

      const endAction = controller.onSpeakingEnded();
      expect(endAction.resumeRecognition).toBe(true);
      expect(controller.isRecognitionActive()).toBe(true);
    });

    it("does not trigger barge-in when headphones are off", () => {
      const controller = new HalfDuplexController({ useHeadphones: false });
      controller.enableMic();
      controller.onSpeakingStarted();

      const bargeInAction = controller.onBargeIn();
      expect(bargeInAction.stopSpeaking).toBe(false);
    });
  });

  describe("full-duplex mode (headphones on)", () => {
    it("keeps recognition active while speaking", () => {
      const controller = new HalfDuplexController({ useHeadphones: true });
      controller.enableMic();
      expect(controller.isRecognitionActive()).toBe(true);

      const speakAction = controller.onSpeakingStarted();
      expect(speakAction.abortRecognition).toBe(false);
      expect(speakAction.dropInterim).toBe(false);
      expect(speakAction.cancelTimer).toBe(false);

      expect(controller.isRecognitionActive()).toBe(true);
      expect(controller.isPausedForSpeaking()).toBe(false);
    });

    it("allows voice barge-in to stop speaking", () => {
      const controller = new HalfDuplexController({ useHeadphones: true });
      controller.enableMic();
      controller.onSpeakingStarted();

      const bargeInAction = controller.onBargeIn();
      expect(bargeInAction.stopSpeaking).toBe(true);
    });
  });
});
