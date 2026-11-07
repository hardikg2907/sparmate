import { phasePlan } from "../../shared/phases";
import { REFERENCE_SECTIONS, type Problem } from "../../shared/problem";
import type { BoardPin, PublicSession, PublicStepCheck, PublicStepItem, Session } from "../../shared/types";

const AFTER_ROUND = new Set<Session["status"]>(["debriefing", "debriefed", "failed"]);

/**
 * The browser's view of a session. While the round runs, hidden entries and hints stay server-side, and the
 * reference answer appears only once the debrief is ready.
 */
export function toPublicSession(session: Session, problem: Problem | undefined, now: Date = new Date()): PublicSession {
  const { sdk: _sdk, checklist: _checklist, stepChecks: _stepChecks, stepCode: _stepCode, ...rest } = session;
  const after = AFTER_ROUND.has(session.status);
  return {
    ...rest,
    steps: publicSteps(session),
    pins: publicPins(session),
    transcript: after ? rest.transcript : rest.transcript.filter((e) => !e.hidden),
    hints: after ? rest.hints : [],
    clock: {
      startedAt: session.startedAt,
      pausedMs: session.pausedMs,
      pauseStartedAt: session.pauseStartedAt,
      durationMs: session.durationMs,
      serverNow: now.toISOString(),
    },
    phasePlan: phasePlan(session.track, Math.round(session.durationMs / 60_000)),
    reference:
      session.status === "debriefed" && problem
        ? {
            sections: REFERENCE_SECTIONS.filter((h) => problem.sections[h]).map((h) => ({ heading: h, markdown: problem.sections[h] ?? "" })),
            sources: problem.meta.sources ?? [],
          }
        : null,
  };
}

/**
 * The checklist as the browser may see it. An interview round shows none of it until the round ends: the list is
 * drawn from the hidden brief, and even a count of what he covered tells him whether a step is done, which a real
 * interviewer never does. A guided round keeps the labels back too, because for the requirements step they are the
 * facts he is meant to find by asking. Before a step's first check only its size leaves the server. After a check, a
 * covered item shows its label, and an open one shows the question that draws it out, or its label when the brief
 * gave none. A debrief shows every label.
 */
export function publicSteps(session: Pick<Session, "mode" | "status" | "checklist" | "stepChecks">): Record<string, PublicStepCheck> {
  const after = AFTER_ROUND.has(session.status);
  if (session.mode !== "guided" && !after) return {};
  const out: Record<string, PublicStepCheck> = {};
  for (const [phase, defs] of Object.entries(session.checklist ?? {})) {
    const check = session.stepChecks?.[phase];
    const base = { status: check?.status ?? "idle", checkedAt: check?.checkedAt ?? null, usedImage: check?.usedImage ?? false } as const;
    if (!after && base.checkedAt === null) {
      out[phase] = { ...base, items: [], covered: 0, partial: 0, total: defs.length };
      continue;
    }
    const items: PublicStepItem[] = defs.map((def) => {
      const item = check?.items[def.id];
      const state = item?.state ?? "missing";
      const asked = !after && state !== "covered" && def.ask !== undefined;
      return {
        id: def.id,
        label: asked ? (def.ask ?? def.label) : def.label,
        question: asked,
        state,
        source: item?.source ?? null,
        at: item?.at ?? null,
        detail: item?.state === "partial" && item.detail ? item.detail : null,
      };
    });
    out[phase] = {
      ...base,
      items,
      covered: items.filter((i) => i.state === "covered").length,
      partial: items.filter((i) => i.state === "partial").length,
      total: items.length,
    };
  }
  return out;
}

/** Pins appear on the board only in a guided round, and every pin, the judge's included, in the debrief. */
export function publicPins(session: Pick<Session, "mode" | "status" | "pins">): BoardPin[] {
  if (AFTER_ROUND.has(session.status)) return session.pins ?? [];
  return session.mode === "guided" ? (session.pins ?? []).filter((p) => p.by === "guide") : [];
}
