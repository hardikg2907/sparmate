import { useEffect, useRef } from "react";
import type { SessionController } from "./types";

export function testHooksEnabled(): boolean {
  return new URLSearchParams(location.search).get("testhooks") === "1";
}

/** A plain, JSON-safe picture of what the session page shows, for scripted checks. */
export function describeSession(ctl: SessionController): Record<string, unknown> {
  const { state } = ctl;
  const session = state.session;
  const line = (item: SessionController["chat"]["interview"][number]) => ({ id: item.id, role: item.role, text: item.text, kind: item.kind ?? null, state: item.state });
  return {
    page: "session",
    sessionId: session?.id ?? null,
    status: session?.status ?? null,
    pauseReason: session?.pauseReason ?? null,
    discarded: state.discarded,
    mode: session?.mode ?? null,
    track: session?.track ?? null,
    phase: session?.phase ?? null,
    connection: state.connection,
    loadError: state.loadError,
    interview: ctl.chat.interview.map(line),
    coach: ctl.chat.coach.map(line),
    streaming: [...ctl.chat.interview, ...ctl.chat.coach].some((item) => item.state === "streaming"),
    agent: state.agent,
    graph: { version: state.graph.version, text: state.graph.text, warnings: state.graph.warnings },
    code: state.code
      ? { version: state.code.version, length: state.code.content.length, running: state.code.running, diagnostics: state.code.diagnostics.length, hasRun: state.code.lastRun !== null }
      : null,
    debrief: state.debrief,
    scorecard: session?.scorecard ? { verdict: session.scorecard.verdict.sde2, dimensions: session.scorecard.dimensions.length } : null,
    proposal: state.notes.proposal
      ? { id: state.notes.proposal.id, status: state.notes.proposal.status, ops: state.notes.proposal.ops.length }
      : null,
    drafting: state.notes.drafting,
    applyResult: state.notes.result,
    error: state.error,
    notice: state.notice,
  };
}

/** Installs window.__irShell for the page's lifetime. Does nothing unless the URL asks for it. */
export function useTestHooks(ctl: SessionController): void {
  const latest = useRef(ctl);
  latest.current = ctl;
  useEffect(() => {
    if (!testHooksEnabled()) return;
    window.__irShell = {
      sendChat(text) {
        const { state, actions } = latest.current;
        const channel = state.session?.status === "debriefed" ? "coach" : "interview";
        return actions.sendChat(channel, text);
      },
      state: () => describeSession(latest.current),
    };
    return () => {
      delete window.__irShell;
    };
  }, []);
}
