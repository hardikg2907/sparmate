import "./excalidraw-env";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";
import { applyTheme, storedTheme } from "./theme";

// Apply the last-used theme before React renders, so a saved choice does not flash. A new visitor starts in dark.
applyTheme(storedTheme() ?? "dark");

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  const params = new URLSearchParams(location.search);
  const fixture = params.get("fixture");
  if (fixture) {
    // Static pages for checking the layout without a server. The module is a separate chunk that
    // only loads when the address asks for it.
    void import("./fixtures/mount").then((m) => m.mountFixture(root, fixture, params));
  } else {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  }
}
