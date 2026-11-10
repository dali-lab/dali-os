// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { clampPanelWidth, defaultPanelWidth, parsePanelShare } from "~/components/side-panel/PanelFrame";

const RAIL = 264;

describe("panel width", () => {
  it("defaults to 45% of the window", () => {
    expect(defaultPanelWidth(1440, 1440 - RAIL)).toBe(648);
    expect(defaultPanelWidth(1920, 1920 - RAIL)).toBe(864);
  });

  it("leaves the page 480px on a laptop", () => {
    expect(defaultPanelWidth(1280, 1280 - RAIL)).toBe(536);
  });

  it("takes the full 45% when the rail is hidden", () => {
    expect(defaultPanelWidth(1280, 1280)).toBe(576);
  });

  it("never drops below the minimum width, however little room is left", () => {
    expect(defaultPanelWidth(800, 800 - RAIL)).toBe(360);
  });

  it("clamps a dragged width between 360px and 60% of the window", () => {
    expect(clampPanelWidth(200, 1440)).toBe(360);
    expect(clampPanelWidth(1200, 1440)).toBe(864);
    expect(clampPanelWidth(700, 1440)).toBe(700);
  });

  it("reads only a saved share of the window", () => {
    expect(parsePanelShare("0.5")).toBe(0.5);
    expect(parsePanelShare(null)).toBeNull();
    expect(parsePanelShare("")).toBeNull();
    expect(parsePanelShare("0")).toBeNull();
    expect(parsePanelShare("648")).toBeNull();
    expect(parsePanelShare("wide")).toBeNull();
  });
});
