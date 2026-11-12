import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../components/ui/tooltip";
import { BoardPalette } from "./BoardPalette";

afterEach(() => {
  vi.unstubAllGlobals();
});

function render(): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <BoardPalette track="hld" theme="light" disabled={false} onInsertShape={() => {}} onInsertArrow={() => {}} />
    </TooltipProvider>,
  );
}

function stubStorage(value: string | null) {
  vi.stubGlobal("localStorage", { getItem: () => value, setItem: () => {} });
}

describe("BoardPalette collapse", () => {
  it("opens with the shapes listed and a hide toggle", () => {
    stubStorage(null);
    const html = render();
    expect(html).toContain('data-kind="client"');
    expect(html).toContain('aria-label="Hide the palette"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain("inert");
  });

  it("opens as a slim rail with its shapes out of reach when the browser saved it collapsed", () => {
    stubStorage("1");
    const html = render();
    expect(html).toContain("ir-palette--collapsed");
    expect(html).toContain("inert");
    expect(html).toContain('aria-label="Show the palette"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("opens expanded when storage cannot be read", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
    });
    expect(render()).toContain("ir-palette__item");
  });
});
