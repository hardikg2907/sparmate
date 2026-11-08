import type { SetupCheck } from "../../shared/protocol";
import type { Settings } from "../../shared/types";

/** What App hands every page: the saved settings and the facts the server reported at start. */
export interface PageContext {
  settings: Settings;
  /** The server answers with scripted replies and makes no model calls. */
  testMode: boolean;
  /** What the server found missing on this machine. */
  setup: SetupCheck[];
}
