import "../excalidraw-env";
import { exportToBlob } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, ExcalidrawFrameLikeElement } from "@excalidraw/excalidraw/element/types";
import { loadSceneFonts } from "./fonts";

const THUMB_MAX_SIDE = 900;

/**
 * An image of one frame of a saved board, cropped to the frame's edges, as an object URL the caller revokes.
 * Excalidraw crops a frame export with no padding, so a point's place in the frame is its place in the image.
 */
export async function frameImageUrl(elements: readonly Record<string, unknown>[], frameId: string): Promise<string> {
  const scene = elements.filter((el) => el.isDeleted !== true) as unknown as ExcalidrawElement[];
  const frame = scene.find((el) => el.id === frameId);
  if (!frame) throw new Error("That frame is not on the board.");
  await loadSceneFonts(scene);
  await document.fonts.ready;
  const blob = await exportToBlob({
    elements: scene,
    // The same white paper the judge saw, whatever the screen theme.
    appState: { exportBackground: true, exportWithDarkMode: false, viewBackgroundColor: "#ffffff" },
    files: null,
    exportingFrame: frame as ExcalidrawFrameLikeElement,
    mimeType: "image/png",
    maxWidthOrHeight: THUMB_MAX_SIDE,
  });
  return URL.createObjectURL(blob);
}
