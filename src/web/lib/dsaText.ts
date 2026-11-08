import type { DsaFailure, DsaResponse } from "../../shared/dsa";

const FAILURE_TEXT: Record<DsaFailure, string> = {
  timeout: "LeetCode did not answer in time.",
  unreachable: "LeetCode could not be reached.",
  unexpected_reply: "LeetCode sent a reply Sparmate did not expect.",
  busy: "LeetCode was busy or refused the request.",
  not_found: "LeetCode no longer shows a public profile with this name.",
};

/** One short sentence for why the last read did not work. */
export function failureText(reason: DsaFailure | undefined): string {
  return reason ? FAILURE_TEXT[reason] : "LeetCode could not be read.";
}

/** "8 s" up to a minute, then whole minutes. */
export function waitText(seconds: number): string {
  return seconds < 60 ? `${seconds} s` : `${Math.ceil(seconds / 60)} min`;
}

/** The tip on Progress' "DSA mediums" when there is no count to show. Empty while the numbers are still loading. */
export function mediumsTip(username: string | undefined, res: DsaResponse | null): string {
  if (username === undefined) return "Add your LeetCode username in Settings to count mediums.";
  if (res === null) return "";
  if (res.status === "no_username") return "Add your LeetCode username in Settings to count mediums.";
  if (res.status === "not_found") return `No public LeetCode profile named ${res.username ?? username}.`;
  if (res.status === "error" || res.status === "stale") return "LeetCode could not be read.";
  return "";
}
