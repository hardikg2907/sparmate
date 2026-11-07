import type { Session } from "../../shared/types";

export type PauseReason = Session["pauseReason"];

/** The wording for a model-error pause; the agent's own message replaces it when there is one. */
export const ERROR_PAUSE_TEXT = "The interviewer could not answer.";

/** What the room says about a pause that was not caused by a model error. */
export function pauseText(reason: PauseReason): string {
  switch (reason) {
    case "away":
      return "Paused because the room was closed. Resume when you're ready.";
    case "restart":
      return "Paused because the app restarted.";
    default:
      return "Paused.";
  }
}
