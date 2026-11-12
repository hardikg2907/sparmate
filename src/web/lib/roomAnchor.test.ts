import { describe, expect, it, vi } from "vitest";
import { MISSING_BOARD_SHAPE_NOTICE, activateRoomAnchor, resolveBoardFocusTarget, type AnchorCodeReveal, type FocusableBoardElement } from "./roomAnchor";

interface TestBoardElement extends FocusableBoardElement {
  containerId?: string | null;
}

describe("resolveBoardFocusTarget", () => {
  it("matches live shapes with bound labels, groups, and step frames while rejecting deleted shapes", () => {
    const liveElements: TestBoardElement[] = [
      { id: "frame-entities", type: "frame", customData: { step: "entities" } },
      { id: "lot", type: "rectangle", isDeleted: false },
      { id: "lot-label", type: "text", containerId: "lot", isDeleted: false },
      { id: "member-a", type: "rectangle", groupIds: ["grp-cache"], isDeleted: false },
    ];

    const shapeMatch = resolveBoardFocusTarget(liveElements, "lot");
    expect(shapeMatch).toEqual({
      kind: "elements",
      targets: [liveElements[1], liveElements[2]],
    });

    const groupMatch = resolveBoardFocusTarget(liveElements, "grp-cache");
    expect(groupMatch).toEqual({
      kind: "elements",
      targets: [liveElements[3]],
    });

    const stepMatch = resolveBoardFocusTarget(liveElements, "entities");
    expect(stepMatch).toEqual({ kind: "step", step: "entities" });

    // Even if an orphan bound label survives transiently, a deleted shape must report missing.
    const deletedWithOrphanText: TestBoardElement[] = [
      { id: "lot", type: "rectangle", isDeleted: true },
      { id: "lot-label", type: "text", containerId: "lot", isDeleted: false },
      { id: "frame-entities", type: "frame", isDeleted: true, customData: { step: "entities" } },
    ];
    expect(resolveBoardFocusTarget(deletedWithOrphanText, "lot")).toEqual({ kind: "missing" });
    expect(resolveBoardFocusTarget(deletedWithOrphanText, "entities")).toEqual({ kind: "missing" });
    expect(resolveBoardFocusTarget(liveElements, "nonexistent-id")).toEqual({ kind: "missing" });
  });
});

describe("activateRoomAnchor", () => {
  it("reports an error notice and leaves diagramFitted and active views untouched when a board shape is missing", () => {
    const diagramFitted = { current: false };
    const setPhoneView = vi.fn();
    const setGraphOpen = vi.fn();
    const setTab = vi.fn();
    const setReveal = vi.fn();
    const notifyError = vi.fn();
    const scheduleAfterLayout = vi.fn();

    const activated = activateRoomAnchor(
      { kind: "board", elementId: "deleted-shape" },
      {
        lld: true,
        tab: "code",
        phoneView: "chat",
        graphOpen: true,
        diagramFitted,
        focusBoardElement: () => false,
        setPhoneView,
        setGraphOpen,
        setTab,
        setReveal,
        notifyError,
        scheduleAfterLayout,
      },
    );

    expect(activated).toBe(false);
    expect(notifyError).toHaveBeenCalledTimes(1);
    expect(notifyError).toHaveBeenCalledWith(MISSING_BOARD_SHAPE_NOTICE);
    expect(diagramFitted.current).toBe(false);
    expect(setPhoneView).not.toHaveBeenCalled();
    expect(setGraphOpen).not.toHaveBeenCalled();
    expect(setTab).not.toHaveBeenCalled();
    expect(scheduleAfterLayout).not.toHaveBeenCalled();
  });

  it("switches to the diagram view, marks diagramFitted, and re-focuses after layout shift when the shape exists", () => {
    const diagramFitted = { current: false };
    const focusCalls: string[] = [];
    const setPhoneView = vi.fn();
    const setGraphOpen = vi.fn();
    const setTab = vi.fn();
    const notifyError = vi.fn();
    let scheduled: (() => void) | null = null;

    const activated = activateRoomAnchor(
      { kind: "board", elementId: "lot" },
      {
        lld: true,
        tab: "code",
        phoneView: "chat",
        graphOpen: true,
        diagramFitted,
        focusBoardElement: (id) => {
          focusCalls.push(id);
          return true;
        },
        setPhoneView,
        setGraphOpen,
        setTab,
        setReveal: () => {},
        notifyError,
        scheduleAfterLayout: (cb) => {
          scheduled = cb;
        },
      },
    );

    expect(activated).toBe(true);
    expect(notifyError).not.toHaveBeenCalled();
    expect(diagramFitted.current).toBe(true);
    expect(setPhoneView).toHaveBeenCalledWith("work");
    expect(setGraphOpen).toHaveBeenCalledWith(false);
    expect(setTab).toHaveBeenCalledWith("diagram");
    expect(focusCalls).toEqual(["lot"]);
    expect(scheduled).not.toBeNull();
    scheduled!();
    expect(focusCalls).toEqual(["lot", "lot"]);
  });

  it("reveals code anchors in LLD rooms and ignores them in HLD rooms", () => {
    let revealState: AnchorCodeReveal | null = null;
    const setTab = vi.fn();
    const setPhoneView = vi.fn();

    const hldResult = activateRoomAnchor(
      { kind: "code", line: 30, endLine: 35 },
      {
        lld: false,
        tab: "diagram",
        phoneView: "work",
        graphOpen: false,
        diagramFitted: { current: false },
        focusBoardElement: () => false,
        setPhoneView,
        setGraphOpen: () => {},
        setTab,
        setReveal: (fn) => {
          revealState = fn(revealState);
        },
        notifyError: () => {},
      },
    );
    expect(hldResult).toBe(false);
    expect(revealState).toBeNull();

    const lldResult = activateRoomAnchor(
      { kind: "code", line: 30, endLine: 35 },
      {
        lld: true,
        tab: "diagram",
        phoneView: "chat",
        graphOpen: false,
        diagramFitted: { current: false },
        focusBoardElement: () => false,
        setPhoneView,
        setGraphOpen: () => {},
        setTab,
        setReveal: (fn) => {
          revealState = fn(revealState);
        },
        notifyError: () => {},
      },
    );
    expect(lldResult).toBe(true);
    expect(setPhoneView).toHaveBeenCalledWith("work");
    expect(setTab).toHaveBeenCalledWith("code");
    expect(revealState).toEqual({ line: 30, column: 1, endLine: 35, nonce: 1 });
  });
});
