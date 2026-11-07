// Must run before Excalidraw loads, so fonts come from this server, never a CDN.
declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string;
  }
}
window.EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/";
export {};
