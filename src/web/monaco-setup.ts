// Load Monaco from the local package; the React wrapper otherwise fetches it from a CDN.
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import { loader } from "@monaco-editor/react";

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

export { monaco };

type Mode = "light" | "dark";

// Values of the app tokens in styles.css, for when the page cannot supply them for the mode asked for.
const TOKEN_FALLBACK = {
  "--card": ["#ffffff", "#1b1e25"],
  "--foreground": ["#181b22", "#e8eaf0"],
  "--faint": ["#5d6575", "#959eae"],
  "--muted": ["#eceef2", "#242832"],
  "--accent": ["#e3e6ec", "#2b303b"],
  "--border": ["#dcdfe5", "#2e333e"],
  "--primary": ["#3443c0", "#8e9cff"],
  "--primary-soft": ["#e8eafb", "#262c52"],
  "--popover": ["#ffffff", "#20232b"],
  "--popover-foreground": ["#181b22", "#e8eaf0"],
  "--input": ["#838b9a", "#6f7889"],
  "--destructive-fill": ["#c0392b", "#e5655a"],
  "--warning-fill": ["#b06f06", "#d99a2b"],
} as const satisfies Record<string, readonly [string, string]>;

type TokenName = keyof typeof TOKEN_FALLBACK;

const HEX6 = /^#[0-9a-f]{6}$/i;

function token(style: CSSStyleDeclaration | null, name: TokenName, mode: Mode): string {
  const value = style?.getPropertyValue(name).trim() ?? "";
  return HEX6.test(value) ? value : TOKEN_FALLBACK[name][mode === "dark" ? 1 : 0];
}

// Monaco takes #rrggbbaa, so the alpha is appended as two hex digits.
function withAlpha(hex: string, alpha: number): string {
  return hex + Math.round(alpha * 255).toString(16).padStart(2, "0");
}

function editorTheme(mode: Mode): monaco.editor.IStandaloneThemeData {
  // The editor can mount before the saved theme reaches the page; the page's tokens then belong to the other mode.
  const pageMode: Mode = document.documentElement.classList.contains("dark") ? "dark" : "light";
  const style = pageMode === mode ? getComputedStyle(document.documentElement) : null;
  const t = (name: TokenName) => token(style, name, mode);
  const input = t("--input");
  return {
    base: mode === "dark" ? "vs-dark" : "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": t("--card"),
      "editor.foreground": t("--foreground"),
      "editorLineNumber.foreground": t("--faint"),
      "editorLineNumber.activeForeground": t("--foreground"),
      "editor.lineHighlightBackground": t("--muted"),
      "editor.lineHighlightBorder": t("--muted"),
      "editor.selectionBackground": t("--primary-soft"),
      "editor.inactiveSelectionBackground": t("--accent"),
      "editorCursor.foreground": t("--primary"),
      "editorIndentGuide.background1": t("--border"),
      "editorWhitespace.foreground": t("--border"),
      "editorWidget.background": t("--popover"),
      "editorWidget.foreground": t("--popover-foreground"),
      "editorWidget.border": t("--border"),
      "editorHoverWidget.background": t("--popover"),
      "editorHoverWidget.border": t("--border"),
      "scrollbarSlider.background": withAlpha(input, 0.3),
      "scrollbarSlider.hoverBackground": withAlpha(input, 0.5),
      "editorError.foreground": t("--destructive-fill"),
      "editorWarning.foreground": t("--warning-fill"),
      focusBorder: t("--primary"),
    },
  };
}

/**
 * Returns the theme name for the editor. The colours come from the current tokens, so the theme is rebuilt on
 * every call: a switch between light and dark then picks up the palette that is now on the page.
 */
export function monacoTheme(theme: "light" | "dark"): string {
  const mode: Mode = theme === "dark" ? "dark" : "light";
  const name = `ir-${mode}`;
  monaco.editor.defineTheme(name, editorTheme(mode));
  return name;
}

export const MONO_FONT = '"Atkinson Hyperlegible Mono Variable", "SF Mono", Menlo, Monaco, monospace';

/**
 * Monaco measures glyph widths when it starts. If the web font arrives later the cursor drifts from the text,
 * so the measurement is redone once the font is ready.
 */
export function remeasureWhenFontLoads(): void {
  void document.fonts.load('14px "Atkinson Hyperlegible Mono Variable"').then(
    () => monaco.editor.remeasureFonts(),
    () => {},
  );
}
