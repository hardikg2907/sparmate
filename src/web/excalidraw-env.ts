// Must run before Excalidraw loads, so fonts come from this server, never a CDN.
declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string;
  }
}
window.EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/";

// Excalidraw always appends its own CDN address after ours in every font's `src` list. The browser checks each
// listed address against the page's CSP when the font loads, so each one logs a violation even though the
// first address already works. Keeping only same-origin addresses removes the CDN from the list.
const NativeFontFace = window.FontFace;
if (typeof NativeFontFace === "function") {
  const sameOriginOnly = (source: string): string =>
    source
      .split(/,(?=\s*url\()/)
      .filter((entry) => {
        const match = /url\(\s*["']?([^"')]+)/.exec(entry);
        return !match || !/^https?:\/\//.test(match[1] ?? "") || (match[1] ?? "").startsWith(location.origin + "/");
      })
      .join(",");
  window.FontFace = class extends NativeFontFace {
    constructor(family: string, source: string | BufferSource, descriptors?: FontFaceDescriptors) {
      super(family, typeof source === "string" ? sameOriginOnly(source) : source, descriptors);
    }
  };
}
export {};
