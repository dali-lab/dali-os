import { describe, expect, it } from "vitest";
import { snapMove, snapResize } from "../geometry";

const stage = { w: 3300, h: 2550 };
const opts = { threshold: 12, items: true, margins: true, stage };

describe("snapping on a custom stage", () => {
  it("pulls a box onto the page center", () => {
    const out = snapMove({ x: 1500, y: 100, w: 300, h: 100 }, 5, 0, [], opts);
    expect(out.dx + 1500 + 150).toBe(1650);
    expect(out.guides.some((g) => g.axis === "x" && g.pos === 1650 && g.to === 2550)).toBe(true);
  });

  it("pulls the vertical center onto half the page height", () => {
    const out = snapMove({ x: 100, y: 1200, w: 300, h: 150 }, 0, 3, [], opts);
    expect(out.dy + 1200 + 75).toBe(1275);
    expect(out.guides.some((g) => g.axis === "y" && g.pos === 1275 && g.to === 3300)).toBe(true);
  });

  it("does not snap to the slide margins", () => {
    const out = snapMove({ x: 150, y: 400, w: 200, h: 100 }, 0, 0, [], opts);
    expect(out.dx).toBe(0);
  });

  it("snaps a resized edge to the page edge", () => {
    const out = snapResize({ x: 3000, y: 100, w: 200, h: 100, rot: 0 }, "e", 95, 0, [], opts);
    expect(out.placed.x + out.placed.w).toBe(3300);
  });

  it("keeps slide margins on the default stage", () => {
    const out = snapMove({ x: 150, y: 400, w: 200, h: 100 }, 0, 0, [], { threshold: 12, items: true, margins: true });
    expect(out.dx).toBe(10);
  });
});
