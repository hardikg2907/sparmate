import { Component, Suspense, lazy, useCallback, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import type { BootstrapResponse } from "../shared/protocol";
import type { Settings } from "../shared/types";
import { ApiError, api, getBootstrap } from "./backend";
import { AppProviders } from "./components/AppProviders";
import { Button, Spinner } from "./components/ui";
import { LibraryNewPage } from "./pages/LibraryNew";
import { DrillPage } from "./pages/DrillPage";
import { PracticePage } from "./pages/Practice";
import { ProgressPage } from "./pages/Progress";
import { SettingsPage } from "./pages/Settings";
import { TodayPage } from "./pages/Today";
import type { PageContext } from "./pages/context";
import { UsagePage } from "./pages/UsagePage";
import { Link, legacyTarget, navigate, useRoute } from "./router";
import { testHooksEnabled } from "./session/testHooks";
import { applyTheme, type Theme } from "./theme";

// The session page carries Excalidraw and Monaco; the home page should not wait for them.
const SessionPage = lazy(() => import("./pages/SessionPage"));

type Boot = { phase: "loading" } | { phase: "error"; message: string } | { phase: "ready"; bootstrap: BootstrapResponse; settings: Settings };

export function App() {
  return (
    <ErrorBoundary>
      <a
        href="#main"
        onClick={(event) => {
          // The room stays mounted but hidden during a debrief, so the target is the first <main> that is not inert.
          // A paused room makes its own <main> inert, and then the only way on is the Resume button.
          event.preventDefault();
          const main = [...document.querySelectorAll<HTMLElement>("main")].find((el) => !el.closest("[inert]"));
          (main ?? document.getElementById("pause-action"))?.focus();
        }}
        className="sr-only z-[60] rounded-md bg-primary px-3 py-2 text-ui font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to main content
      </a>
      <AppProviders>
        <div className="h-full min-h-0 overflow-clip">
          <Shell />
        </div>
      </AppProviders>
    </ErrorBoundary>
  );
}

function Shell() {
  const route = useRoute();
  const [boot, setBoot] = useState<Boot>({ phase: "loading" });

  const load = useCallback(async () => {
    setBoot({ phase: "loading" });
    try {
      const [bootstrap, settings] = await Promise.all([getBootstrap(true), api.settings()]);
      setBoot({ phase: "ready", bootstrap, settings });
    } catch (error) {
      setBoot({ phase: "error", message: error instanceof ApiError && error.message ? error.message : "Cannot reach the Sparmate server." });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const theme: Theme = boot.phase === "ready" ? boot.settings.theme : "dark";
  useEffect(() => {
    if (boot.phase === "ready") applyTheme(boot.settings.theme);
  }, [boot]);

  // An address from before the pages were merged is replaced by the page that took over, so a bookmark keeps working.
  useEffect(() => {
    const target = legacyTarget(location.pathname);
    if (target) navigate(target, { replace: true, force: true, instant: true });
  }, [route]);

  // Pages other than a session have nothing to chat with, but scripted checks still need the hook object.
  useEffect(() => {
    if (!testHooksEnabled() || route.name === "session") return;
    window.__irShell = { sendChat: () => false, state: () => ({ page: route.name, path: location.pathname }) };
    return () => {
      delete window.__irShell;
    };
  }, [route.name]);

  if (boot.phase === "loading") {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Starting…" />
      </div>
    );
  }
  if (boot.phase === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center" role="alert">
        <h1 className="text-lead font-semibold">The Sparmate server is not answering</h1>
        <p className="max-w-md text-body text-muted-foreground">{boot.message} Check that it is running, then try again.</p>
        <Button variant="default" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    );
  }

  const { bootstrap, settings } = boot;
  const ctx: PageContext = { settings, testMode: bootstrap.fakeAgent, setup: bootstrap.setup };

  const save = async (next: Settings) => {
    try {
      await api.saveSettings(next);
    } catch (error) {
      throw new Error(error instanceof ApiError && error.message ? error.message : "The settings could not be saved.", { cause: error });
    }
    setBoot({ phase: "ready", bootstrap, settings: next });
  };

  // Keyed by page, so each page mounts fresh, except Rounds and Drills, which are one page. Reading pages stagger
  // their own sections in; the room only fades, because the whiteboard measures its position when it mounts and a
  // moving page would offset every pointer event.
  const pageKey =
    route.name === "session"
      ? `session:${route.id}`
      : route.name === "drill"
        ? `drill:${route.target.drill}:${route.target.problemId}:${route.target.drillId ?? ""}`
        : route.name === "practice-drills"
          ? "practice"
          : route.name;
  const enter = route.name === "session" ? "fade-in " : "";
  return (
    <>
      <div key={pageKey} className={`${enter}h-full min-h-0`}>
        {route.name === "home" ? <TodayPage ctx={ctx} /> : null}
        {route.name === "practice" || route.name === "practice-drills" ? <PracticePage tab={route.name === "practice" ? "rounds" : "drills"} ctx={ctx} /> : null}
        {route.name === "library-new" ? <LibraryNewPage ctx={ctx} /> : null}
        {route.name === "progress" ? <ProgressPage ctx={ctx} /> : null}
        {route.name === "settings" ? <SettingsPage ctx={ctx} studyRoot={bootstrap.studyRoot} onSave={save} onApplyTheme={applyTheme} /> : null}
        {route.name === "usage" ? <UsagePage /> : null}
        {route.name === "session" ? (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <Spinner label="Opening the room…" />
              </div>
            }
          >
            <SessionPage key={route.id} id={route.id} theme={theme} studyRoot={bootstrap.studyRoot} />
          </Suspense>
        ) : null}
        {route.name === "drill" ? <DrillPage ctx={ctx} target={route.target} /> : null}
        {route.name === "not-found" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <h1 className="text-lead font-semibold">Page not found</h1>
            <Link href="/" className="rounded text-primary-text underline underline-offset-2">
              Back to Today
            </Link>
          </div>
        ) : null}
      </div>
    </>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Page crashed", error, info.componentStack);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center" role="alert">
        <h1 className="text-lead font-semibold">Something broke in this page</h1>
        <p className="max-w-md text-body text-muted-foreground">Your round is safe on the server. Reload to pick it up again.</p>
        <Button variant="default" onClick={() => location.reload()}>
          Reload
        </Button>
      </div>
    );
  }
}
