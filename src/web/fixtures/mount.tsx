import { StrictMode, useState } from "react";
import type { Root } from "react-dom/client";
import { AppProviders } from "../components/AppProviders";
import { PaletteSourceContext } from "../components/CommandPalette";
import type { DsaData } from "../lib/useDsa";
import { HistorySourceContext } from "../lib/useDrillHistory";
import { DueDrillCountContext, type GymData } from "../lib/useGym";
import type { StudyData } from "../lib/useStudyData";
import type { Settings } from "../../shared/types";
import { DrillDetailPage } from "../pages/DrillHistory";
import { LibraryNewView } from "../pages/LibraryNew";
import { PracticeView } from "../pages/Practice";
import { ProgressView } from "../pages/Progress";
import { SettingsView } from "../pages/Settings";
import { TodayView } from "../pages/Today";
import { planIndex } from "../../shared/week";
import type { PageContext } from "../pages/context";
import { lockNavigation } from "../router";
import { applyTheme, type Theme } from "../theme";
import type { Mode } from "../../shared/phases";
import type { PublicSession } from "../../shared/types";
import { FakeServer } from "./fakeServer";
import { fixtureGym } from "./gym";
import { fixtureDetail, fixtureHistorySource } from "./gymHistory";
import { fixtureAllHistory, fixtureBootstrap, fixtureHistory, fixtureOpenRounds, fixtureProblems, fixtureSettings } from "./home";
import { fixtureDsa } from "./dsa";
import { useFixtureStudyData } from "./studyData";
import { fixtureProposal } from "./proposal";
import { fixtureUsage } from "./usage";
import { LLD_CODE, LLD_FINAL_CODE, withLegacyNotes } from "./sessions";
import { hldDebrief, hldRoom, lldDebrief, lldRoom } from "./rooms";

export const PAGE_FIXTURES = ["home", "library", "library-new", "progress", "history", "settings", "gym", "drill-detail", "dsa"] as const;
const FIXTURE_PATH: Record<string, string> = {
  home: "/",
  library: "/practice",
  "library-new": "/practice/new",
  progress: "/progress",
  history: "/progress#history",
  settings: "/settings",
  gym: "/practice/drills",
  "drill-detail": `/practice/drills/${fixtureDetail.item.id}`,
  dsa: "/progress#dsa",
};
export const FIXTURES = ["home", "room-hld", "room-lld", "debrief-hld", "debrief-lld", "usage", "drill-dialogue"] as const;

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

  if ((PAGE_FIXTURES as readonly string[]).includes(name)) {
    // The main bar marks the page from the address, and a fixture keeps the address it was opened with.
    const [path = "/", anchor] = (FIXTURE_PATH[name] ?? "/").split("#");
    history.replaceState(null, "", `${path}${location.search}${anchor ? `#${anchor}` : ""}`);
    const day = params.get("now");
    const now = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T10:00:00`) : new Date();
    root.render(
      <StrictMode>
        <AppProviders>
          <div className="h-full min-h-0 overflow-clip">
            <FixturePage
              name={name}
              theme={theme}
              now={now}
              preparing={params.get("preparing") === "1"}
              noUnfinished={params.get("unfinished") === "0"}
              testMode={params.get("testmode") !== "0"}
              username={params.get("username")}
              plan={params.get("plan")}
              dsaState={params.get("state")}
              todayState={params.get("today")}
            />
          </div>
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

  if (name === "drill-dialogue") {
    const { DrillDialogueFixture } = await import("./drillDialogue");
    root.render(
      <StrictMode>
        <AppProviders>
          <DrillDialogueFixture />
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
        <div className="h-full min-h-0 overflow-clip">
          <SessionRoot source={server.source()} theme={theme} studyRoot={fixtureBootstrap.studyRoot} />
        </div>
      </AppProviders>
    </StrictMode>,
  );
}

function FixturePage({
  name,
  theme,
  now,
  preparing,
  noUnfinished,
  testMode,
  username,
  plan,
  dsaState,
  todayState,
}: {
  name: string;
  theme: Theme;
  now: Date;
  preparing: boolean;
  noUnfinished: boolean;
  testMode: boolean;
  username: string | null;
  plan: string | null;
  dsaState: string | null;
  todayState: string | null;
}) {
  const [settings, setSettings] = useState(() => {
    const base = fixtureSettings(theme);
    const days = plan?.split(",");
    return {
      ...base,
      ...(username ? { leetcodeUsername: username } : {}),
      ...((name === "dsa" || name === "progress" || name === "history" || (name === "home" && dsaState)) && dsaState !== "none" && !username
        ? { leetcodeUsername: "example_user" }
        : {}),
      ...(days?.length === 7 ? { weeklyPlan: days as typeof base.weeklyPlan } : {}),
    };
  });
  const firstRun = name === "home" && todayState === "first";
  const everything = firstRun ? [] : noUnfinished ? fixtureHistory : name === "home" ? [...fixtureOpenRounds, ...fixtureHistory] : fixtureAllHistory;
  const dsa = fixtureDsa(dsaState ?? "ok", now);
  const data = useFixtureStudyData(fixtureProblems, everything, preparing ? "custom:interview" : null);
  // A rest day is today's slot of the plan set to rest, so one fixture shows the calm page on any weekday.
  const weeklyPlan = name === "home" && todayState === "rest" ? settings.weeklyPlan.map((kind, i) => (i === planIndex(now) ? ("rest" as const) : kind)) : settings.weeklyPlan;
  const ctx: PageContext = { settings: { ...settings, weeklyPlan }, testMode, setup: [] };

  const gym = { gym: fixtureGym, error: null, reload: () => undefined };
  const palette = {
    load: async () => ({ now, plan: settings.weeklyPlan, problems: fixtureProblems, history: fixtureAllHistory }),
  };
  return (
    <PaletteSourceContext.Provider value={palette}>
      <DueDrillCountContext.Provider value={fixtureGym.dueCount}>
        <HistorySourceContext.Provider value={fixtureHistorySource}>
          <FixtureBody name={name} data={data} ctx={ctx} now={now} dsa={dsa} gym={gym} settings={settings} testMode={testMode} onSettings={setSettings} firstRun={firstRun} />
        </HistorySourceContext.Provider>
      </DueDrillCountContext.Provider>
    </PaletteSourceContext.Provider>
  );
}

function FixtureBody({
  name,
  data,
  ctx,
  now,
  dsa,
  gym,
  settings,
  testMode,
  onSettings,
  firstRun,
}: {
  name: string;
  data: StudyData;
  ctx: PageContext;
  now: Date;
  dsa: DsaData;
  gym: GymData;
  settings: Settings;
  testMode: boolean;
  onSettings: (next: Settings) => void;
  firstRun: boolean;
}) {
  if (name === "library") return <PracticeView tab="rounds" study={data} gym={gym} ctx={ctx} />;
  if (name === "library-new") return <LibraryNewView data={data} ctx={ctx} />;
  if (name === "progress" || name === "history" || name === "dsa") return <ProgressView data={data} ctx={ctx} now={now} dsa={dsa} gym={fixtureGym} />;
  if (name === "gym") return <PracticeView tab="drills" study={data} gym={gym} ctx={ctx} />;
  if (name === "drill-detail") return <DrillDetailPage ctx={ctx} drillId={fixtureDetail.item.id} />;
  if (name === "settings") {
    return (
      <SettingsView
        settings={settings}
        studyRoot={fixtureBootstrap.studyRoot}
        testMode={testMode}
        onSave={async (next) => {
          onSettings(next);
        }}
        onApplyTheme={applyTheme}
      />
    );
  }
  return <TodayView data={data} ctx={ctx} now={now} dsa={ctx.settings.leetcodeUsername ? dsa.response : null} gym={firstRun ? null : gym.gym} />;
}
