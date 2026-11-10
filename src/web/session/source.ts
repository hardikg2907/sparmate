import { api, createSessionSocket } from "../backend";
import type { SessionSource } from "./types";

export function liveSource(id: string): SessionSource {
  let boardImage = true;
  return {
    id,
    async load() {
      const session = await api.session(id);
      boardImage = session.boardImage !== false;
      // The room draws the scene; the debrief draws each step's frame from it.
      const [board, code] = await Promise.all([api.board(id).catch(() => null), session.track === "lld" ? api.code(id).catch(() => null) : null]);
      return { session, board, code };
    },
    fetchSession: () => api.session(id),
    fetchCode: () => api.code(id),
    createSocket: () => createSessionSocket(id),
    boardImageUrl: () => (boardImage ? api.boardPngUrl(id) : null),
  };
}
