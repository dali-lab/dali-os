import { describe, expect, it } from "vitest";
import { FIT, MAX_SCALE, clampScale, panBy, toggleZoom, wheelFactor, zoomBy, zoomTo } from "./zoom";

describe("zoom", () => {
  it("clamps between fit and the maximum", () => {
    expect(clampScale(0.2)).toBe(1);
    expect(clampScale(3)).toBe(3);
    expect(clampScale(100)).toBe(MAX_SCALE);
  });

  it("keeps the point under the cursor in place", () => {
    const z = zoomTo(FIT, 2, { x: 100, y: -50 });
    expect(z).toEqual({ scale: 2, x: -100, y: 50 });
    const screenX = (100 - z.x) / z.scale;
    expect(z.x + screenX * z.scale).toBe(100);
  });

  it("snaps back to center when zoomed out to fit", () => {
    expect(zoomBy({ scale: 2, x: 40, y: 30 }, 0.1)).toEqual(FIT);
  });

  it("stops at the maximum", () => {
    expect(zoomBy({ scale: 6, x: 0, y: 0 }, 10).scale).toBe(MAX_SCALE);
  });

  it("pans only when zoomed in", () => {
    expect(panBy(FIT, 10, 10)).toEqual(FIT);
    expect(panBy({ scale: 2, x: 0, y: 0 }, 10, -5)).toEqual({ scale: 2, x: 10, y: -5 });
  });

  it("zooms in on scroll up, out on scroll down, faster for a pinch", () => {
    expect(wheelFactor(-100, false)).toBeGreaterThan(1);
    expect(wheelFactor(100, false)).toBeLessThan(1);
    expect(wheelFactor(-10, true)).toBeGreaterThan(wheelFactor(-10, false));
  });

  it("toggles between fit and 2x", () => {
    const zoomed = toggleZoom(FIT);
    expect(zoomed.scale).toBe(2);
    expect(toggleZoom(zoomed)).toEqual(FIT);
  });
});
