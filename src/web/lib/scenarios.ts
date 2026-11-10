import type { Scorecard } from "../../shared/types";

type Scenario = Scorecard["lldScenarios"][number];

export interface SharedCause {
  /** The cause as the tester first wrote it. */
  cause: string;
  /** The failed scenarios that share it, in table order. */
  names: string[];
}

/**
 * Causes that two or more failed scenarios share, in table order of their first scenario. One bug can fail most of
 * the table when every scenario ends with the same check, and the pass count alone then reads as if nothing works.
 */
export function sharedCauses(scenarios: readonly Scenario[]): SharedCause[] {
  const groups = new Map<string, SharedCause>();
  for (const s of scenarios) {
    const cause = s.pass ? "" : (s.cause ?? "").trim();
    if (!cause) continue;
    const key = cause
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[.!]+$/, "");
    const group = groups.get(key);
    if (group) group.names.push(s.name);
    else groups.set(key, { cause: cause.replace(/[.!]+$/, ""), names: [s.name] });
  }
  return [...groups.values()].filter((g) => g.names.length >= 2);
}
