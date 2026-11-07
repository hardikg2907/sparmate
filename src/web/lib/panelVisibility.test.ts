import { describe, expect, it } from "vitest";
import { isPanelActiveAndVisible } from "./panelVisibility";

describe("isPanelActiveAndVisible", () => {
  it("returns false for null element", () => {
    expect(isPanelActiveAndVisible(null)).toBe(false);
  });

  it("returns false if element is inside an inert or hidden container", () => {
    const mockElement = {
      closest: (selector: string) => {
        if (selector.includes("[inert]") || selector.includes(".pane-hidden")) {
          return {};
        }
        return null;
      },
      checkVisibility: () => true,
    } as unknown as HTMLElement;

    expect(isPanelActiveAndVisible(mockElement)).toBe(false);
  });

  it("returns false if checkVisibility reports false", () => {
    const mockElement = {
      closest: () => null,
      checkVisibility: () => false,
    } as unknown as HTMLElement;

    expect(isPanelActiveAndVisible(mockElement)).toBe(false);
  });

  it("returns true if element is active and visible", () => {
    const mockElement = {
      closest: () => null,
      checkVisibility: () => true,
    } as unknown as HTMLElement;

    expect(isPanelActiveAndVisible(mockElement)).toBe(true);
  });
});
