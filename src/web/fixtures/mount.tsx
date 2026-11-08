import { StrictMode, useState } from "react";
import type { Root } from "react-dom/client";
import { AppProviders } from "../components/AppProviders";
import { SettingsModal } from "../components/SettingsModal";
import { HomeView } from "../pages/Home";
import { lockNavigation } from "../router";
import { applyTheme, type Theme } from "../theme";
import type { Mode } from "../../shared/phases";
import type { PublicSession } from "../../shared/types";
import { FakeServer } from "./fakeServer";
import { fixtureBootstrap, fixtureHistory, fixtureProblems, fixtureSettings } from "./home";
import { fixtureProposal } from "./proposal";
import { fixtureUsage } from "./usage";
import { LLD_CODE, LLD_FINAL_CODE, withLegacyNotes } from "./sessions";
import { hldDebrief, hldRoom, lldDebrief, lldRoom } from "./rooms";

export const FIXTURES = ["home", "room-hld", "room-lld", "debrief-hld", "debrief-lld", "usage"] as const;

type DebriefStatus = PublicSession["status"];

function statusParam(params: URLSearchParams): DebriefStatus {
  const value = params.get("status");
  return value === "debriefing" || value === "failed" || value === "ended" ? value : "debriefed";
}

function pauseReasonParam(params: URLSearchParams): PublicSession["pauseReason"] {
  if (params.get("error") === "1") return "error";
  const value = params.get("reason");
  return value === "away" || value === "restart" || value === "error" ? value : "user";
}

/**
 * Renders one page from static data, with no network calls. Session pages talk to a scripted in-page
 * server, so streaming, the debrief hand-over and the notes flow can be tried by hand.
 */
export async function mountFixture(root: Root, name: string, params: URLSearchParams): Promise<void> {
  lockNavigation();
  const theme: Theme = params.get("theme") === "light" ? "light" : "dark";
  applyTheme(theme);
  window.__fixtureLog = [];

  if (name === "home") {
    root.render(
      <StrictMode>
        <AppProviders>
          <FixtureHome
            theme={theme}
            openSettings={params.get("settings") === "1"}
            preparing={params.get("preparing") === "1"}
            noUnfinished={params.get("unfinished") === "0"}
            fakeAgent={params.get("testmode") !== "0"}
          />
        </AppProviders>
      </StrictMode>,
    );
    return;
  }

  if (name === "usage") {
    const { UsagePage } = await import("../pages/UsagePage");
    root.render(
      <StrictMode>
        <AppProviders>
          <UsagePage initial={fixtureUsage} />
        </AppProviders>
      </StrictMode>,
    );
    return;
  }

  if (!(FIXTURES as readonly string[]).includes(name)) {
    root.render(<p style={{ padding: 24 }}>Unknown fixture. Use one of: {FIXTURES.join(", ")}.</p>);
    return;
  }

  const [{ SessionRoot }, board] = await Promise.all([import("../pages/SessionPage"), import("./board")]);
  const mode: Mode = params.get("mode") === "guided" ? "guided" : "interview";
  const staleOnApply = params.get("stale") === "1";
  const status = statusParam(params);
  const roomStatus = params.get("status") === "paused" || params.get("error") === "1" ? "paused" : "live";
  const roomReason = pauseReasonParam(params);
  const agentError = params.get("error") === "1" ? "The interviewer could not answer. The service is busy." : undefined;
  const offline = params.get("offline") === "1";
  const timeUp = params.get("timeup") === "1";
  const guidedCall = (session: PublicSession): PublicSession => {
    if (mode !== "guided" || !session.scorecard) return session;
    const ready = params.get("ready") === "1";
    const readiness = { call: ready ? ("ready" as const) : ("not_yet" as const), reasons: ready ? [] : ["Not passed: design, deep dives", "Requirements was assisted"] };
    return { ...session, mode: "guided", scorecard: { ...session.scorecard, readiness } };
  };
  const legacy = (session: PublicSession) => guidedCall(params.get("legacy") === "1" ? withLegacyNotes(session) : session);
  // The board converter measures label text when it builds the scene, so the hand-drawn font must be ready first or the
  // labels come out too narrow and get clipped.
  await document.fonts.load("28px Excalifont", "Redirect service Postgres Key generator").catch(() => undefined);
  const hldImage = board.boardImageDataUrl("hld");
  const lldImage = board.boardImageDataUrl("lld");

  let server: FakeServer;
  if (name === "room-hld") {
    server = new FakeServer({
      session: hldRoom(mode, roomStatus, roomReason),
      board: board.hldBoard(),
      code: null,
      boardImageUrl: hldImage,
      debrief: hldDebrief(),
      proposal: fixtureProposal(),
      staleOnApply,
      agentError,
      offline,
      timeUp,
    });
  } else if (name === "room-lld") {
    server = new FakeServer({
      session: lldRoom(mode, roomStatus, roomReason),
      board: board.lldBoard(),
      code: { path: "lld/parking-lot/attempt-2026-10-30.cpp", content: LLD_CODE, version: 9 },
      boardImageUrl: lldImage,
      debrief: lldDebrief(),
      proposal: fixtureProposal(),
      staleOnApply,
      agentError,
      offline,
      timeUp,
    });
  } else if (name === "debrief-hld") {
    server = new FakeServer({
      session: legacy(hldDebrief(status)),
      board: board.hldBoard(),
      code: null,
      boardImageUrl: hldImage,
      proposal: fixtureProposal(),
      staleOnApply,
      offline,
    });
  } else {
    server = new FakeServer({
      session: legacy(lldDebrief(status)),
      board: board.lldBoard(),
      code: { path: "lld/parking-lot/attempt-2026-10-30.cpp", content: LLD_FINAL_CODE, version: 14 },
      boardImageUrl: lldImage,
      proposal: fixtureProposal(),
      staleOnApply,
      offline,
    });
  }

  window.__fixtureMovePhase = (phase) => server.movePhase(phase);
  server.installHooks();

  root.render(
    <StrictMode>
      <AppProviders>
        <div className="h-full min-h-0 overflow-hidden">
          <SessionRoot source={server.source()} theme={theme} studyRoot={fixtureBootstrap.studyRoot} />
        </div>
      </AppProviders>
    </StrictMode>,
  );
}

function FixtureHome({
  theme,
  openSettings,
  preparing,
  noUnfinished,
  fakeAgent,
}: {
  theme: Theme;
  openSettings: boolean;
  preparing: boolean;
  noUnfinished?: boolean;
  fakeAgent: boolean;
}) {
  const [open, setOpen] = useState(openSettings);
  const [settings, setSettings] = useState(fixtureSettings(theme));
  const [starting, setStarting] = useState<string | null>(preparing ? "custom:interview" : null);
  const [history, setHistory] = useState(() => (noUnfinished ? fixtureHistory.filter((item) => item.status === "debriefed" || item.status === "failed") : fixtureHistory));

  const pretendToStart = (key: string) => {
    setStarting(key);
    setTimeout(() => setStarting(null), 1500);
  };

  return (
    <>
      <div className="h-full min-h-0 overflow-hidden">
        <HomeView
          problems={fixtureProblems}
          history={history}
          error={null}
          onRetry={() => {}}
          starting={starting}
          startError={null}
          fakeAgent={fakeAgent}
          onOpenSettings={() => setOpen(true)}
          onStart={(id, mode) => pretendToStart(`${id}:${mode}`)}
          onStartCustom={(_prompt, _track, mode) => pretendToStart(`custom:${mode}`)}
          discarding={null}
          discardError={null}
          onDiscard={(id) => setHistory((items) => items.filter((item) => item.id !== id))}
          durations={settings.durations}
        />
      </div>
      {open ? (
        <SettingsModal
          settings={settings}
          studyRoot={fixtureBootstrap.studyRoot}
          onClose={() => setOpen(false)}
          onSave={async (next) => {
            setSettings(next);
            applyTheme(next.theme);
          }}
          onApplyTheme={applyTheme}
        />
      ) : null}
    </>
  );
}
