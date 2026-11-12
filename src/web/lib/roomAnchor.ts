import type { AnchorTarget } from "../../shared/blocks";

export const MISSING_BOARD_SHAPE_NOTICE = "That shape is no longer on the board.";

export interface FocusableBoardElement {
  readonly id: string;
  readonly type?: string;
  readonly isDeleted?: boolean;
  readonly groupIds?: readonly string[];
  readonly customData?: Record<string, unknown> | undefined;
}

export type BoardFocusResolution<T extends FocusableBoardElement> = { kind: "elements"; targets: T[] } | { kind: "step"; step: string } | { kind: "missing" };

/**
 * Resolves a board anchor id against current scene elements.
 * Bound labels (`containerId`) only attach when their parent shape is still live so orphan text cannot mask a deleted box.
 */
export function resolveBoardFocusTarget<T extends FocusableBoardElement>(elements: readonly T[], elementId: string): BoardFocusResolution<T> {
  const live = elements.filter((el) => el.isDeleted !== true);
  const hasPrimary = live.some((el) => el.id === elementId);
  const targets = live.filter((el) => {
    if (el.id === elementId) return true;
    if (hasPrimary && "containerId" in el && (el as { containerId?: unknown }).containerId === elementId) return true;
    return Array.isArray(el.groupIds) && el.groupIds.includes(elementId);
  });
  if (targets.length > 0) {
    return { kind: "elements", targets };
  }

  const stepFrame = live.find((el) => {
    if (el.type !== "frame" && el.type !== "magicframe") return false;
    const data = el.customData;
    return typeof data === "object" && data !== null && data.step === elementId;
  });
  if (stepFrame) {
    return { kind: "step", step: elementId };
  }

  return { kind: "missing" };
}

export type BoardFocusResult = "focused" | "missing" | "not_ready";

export interface AnchorCodeReveal {
  line: number;
  column?: number;
  endLine?: number;
  nonce: number;
}

export interface ActivateRoomAnchorContext {
  lld: boolean;
  tab: "code" | "diagram";
  phoneView: "work" | "chat";
  graphOpen: boolean;
  diagramFitted: { current: boolean };
  focusBoardElement: (elementId: string) => BoardFocusResult;
  setPhoneView: (view: "work" | "chat") => void;
  setGraphOpen: (open: boolean) => void;
  setTab: (tab: "code" | "diagram") => void;
  setReveal: (updater: (prev: AnchorCodeReveal | null) => AnchorCodeReveal) => void;
  notifyError: (message: string) => void;
  scheduleAfterLayout?: (cb: () => void) => void;
}

/**
 * Activates a chat anchor inside the live room.
 * For board anchors, verifies the shape or step frame still exists before switching tabs or marking the LLD diagram fitted.
 */
export function activateRoomAnchor(target: AnchorTarget, ctx: ActivateRoomAnchorContext): boolean {
  if (target.kind === "board") {
    const result = ctx.focusBoardElement(target.elementId);
    if (result === "not_ready") {
      return false;
    }
    if (result === "missing") {
      ctx.notifyError(MISSING_BOARD_SHAPE_NOTICE);
      return false;
    }

    const layoutChanged = ctx.phoneView !== "work" || ctx.graphOpen || (ctx.lld && ctx.tab !== "diagram");
    ctx.setPhoneView("work");
    ctx.setGraphOpen(false);
    if (ctx.lld) {
      ctx.diagramFitted.current = true;
      ctx.setTab("diagram");
    }
    if (layoutChanged) {
      const schedule =
        ctx.scheduleAfterLayout ??
        ((cb: () => void) => {
          if (typeof requestAnimationFrame === "function") requestAnimationFrame(cb);
          else cb();
        });
      schedule(() => {
        ctx.focusBoardElement(target.elementId);
      });
    }
    return true;
  }

  if (!ctx.lld) return false;
  ctx.setPhoneView("work");
  ctx.setTab("code");
  ctx.setReveal((prev) => ({
    line: target.line,
    column: 1,
    ...(target.endLine !== undefined ? { endLine: target.endLine } : {}),
    nonce: (prev?.nonce ?? 0) + 1,
  }));
  return true;
}
