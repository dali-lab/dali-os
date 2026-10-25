import { describe, expect, it } from "vitest";
import {
  IDENTITY,
  MAX_ZOOM,
  MIN_ZOOM,
  NODE_HEIGHT,
  NODE_WIDTH,
  boxesKey,
  clampZoom,
  connectionPath,
  contentBounds,
  edgePath,
  fitTransform,
  nodeAt,
  nodeBox,
  roundedPath,
  sourceHandle,
  stepPoints,
  targetHandle,
  toGraphPoint,
  zoomAround,
} from "../graph-geometry";

describe("nodeBox and handles", () => {
  it("defaults to the standard node size", () => {
    expect(nodeBox("a", { x: 10, y: 20 })).toEqual({ id: "a", x: 10, y: 20, width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  it("uses a measured height when given", () => {
    expect(nodeBox("a", { x: 0, y: 0 }, 120).height).toBe(120);
  });

  it("puts the source handle mid-right and the target handle mid-left", () => {
    const box = nodeBox("a", { x: 100, y: 50 }, 80);
    expect(sourceHandle(box)).toEqual({ x: 100 + NODE_WIDTH, y: 90 });
    expect(targetHandle(box)).toEqual({ x: 100, y: 90 });
  });
});

describe("clampZoom", () => {
  it("keeps values inside the range", () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(10)).toBe(MAX_ZOOM);
  });

  it("honours a custom range", () => {
    expect(clampZoom(5, 1, 2)).toBe(2);
    expect(clampZoom(0.5, 1, 2)).toBe(1);
  });
});

describe("contentBounds", () => {
  it("is null for no boxes", () => {
    expect(contentBounds([])).toBeNull();
  });

  it("spans every box including width and height", () => {
    const bounds = contentBounds([nodeBox("a", { x: 0, y: 100 }, 50), nodeBox("b", { x: 400, y: -20 }, 60)]);
    expect(bounds).toEqual({ minX: 0, minY: -20, maxX: 400 + NODE_WIDTH, maxY: 150 });
  });
});

describe("fitTransform", () => {
  it("returns identity without content or a sized viewport", () => {
    expect(fitTransform(null, { width: 800, height: 600 })).toEqual(IDENTITY);
    expect(fitTransform({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { width: 0, height: 600 })).toEqual(IDENTITY);
  });

  it("centres the content", () => {
    const t = fitTransform({ minX: 0, minY: 0, maxX: 1000, maxY: 500 }, { width: 1200, height: 600 }, 0.2);
    expect(t.k).toBeCloseTo(1);
    // The content's centre (500, 250) lands on the viewport's centre.
    expect(500 * t.k + t.x).toBeCloseTo(600);
    expect(250 * t.k + t.y).toBeCloseTo(300);
  });

  it("picks the tighter of the two axes, leaving the padding", () => {
    const t = fitTransform({ minX: 0, minY: 0, maxX: 2000, maxY: 100 }, { width: 1200, height: 600 }, 0.2);
    expect(t.k).toBeCloseTo(1200 / (2000 * 1.2));
  });

  it("clamps zoom so tiny graphs are not blown up and huge ones stay readable", () => {
    expect(fitTransform({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { width: 1200, height: 600 }).k).toBe(MAX_ZOOM);
    expect(fitTransform({ minX: 0, minY: 0, maxX: 100_000, maxY: 10 }, { width: 1200, height: 600 }).k).toBe(MIN_ZOOM);
  });

  it("treats zero-size content as one unit wide", () => {
    const t = fitTransform({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, { width: 100, height: 100 });
    expect(Number.isFinite(t.k)).toBe(true);
  });
});

describe("zoomAround and toGraphPoint", () => {
  it("keeps the anchored graph point under the cursor", () => {
    const t = { x: 30, y: -40, k: 0.8 };
    const anchor = { x: 200, y: 150 };
    const before = toGraphPoint(t, anchor);
    const next = zoomAround(t, anchor, 1.25);
    expect(next.k).toBeCloseTo(1);
    const after = toGraphPoint(next, anchor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("clamps the zoom and leaves the transform still at a limit", () => {
    const t = { x: 10, y: 10, k: MAX_ZOOM };
    expect(zoomAround(t, { x: 50, y: 50 }, 2)).toEqual(t);
    expect(zoomAround({ x: 0, y: 0, k: 1 }, { x: 0, y: 0 }, 0.01).k).toBe(MIN_ZOOM);
  });

  it("converts viewport coords with translation and scale", () => {
    expect(toGraphPoint({ x: 100, y: 50, k: 2 }, { x: 300, y: 250 })).toEqual({ x: 100, y: 100 });
    expect(toGraphPoint(IDENTITY, { x: 7, y: 9 })).toEqual({ x: 7, y: 9 });
  });
});

describe("nodeAt", () => {
  const boxes = [nodeBox("a", { x: 0, y: 0 }, 100), nodeBox("b", { x: 100, y: 50 }, 100)];

  it("finds the box under a point, edges included", () => {
    expect(nodeAt({ x: 10, y: 10 }, boxes)?.id).toBe("a");
    expect(nodeAt({ x: 0, y: 0 }, boxes)?.id).toBe("a");
    expect(nodeAt({ x: 300, y: 140 }, boxes)?.id).toBe("b");
  });

  it("prefers the later box where they overlap", () => {
    expect(nodeAt({ x: 150, y: 75 }, boxes)?.id).toBe("b");
  });

  it("is null on empty space", () => {
    expect(nodeAt({ x: -5, y: 0 }, boxes)).toBeNull();
    expect(nodeAt({ x: 50, y: 500 }, boxes)).toBeNull();
    expect(nodeAt({ x: 1, y: 1 }, [])).toBeNull();
  });
});

describe("stepPoints", () => {
  it("is a straight line when the handles line up", () => {
    expect(stepPoints({ x: 0, y: 10 }, { x: 100, y: 10 })).toEqual([
      { x: 0, y: 10 },
      { x: 100, y: 10 },
    ]);
  });

  it("turns at the horizontal midpoint when the target is ahead", () => {
    expect(stepPoints({ x: 0, y: 0 }, { x: 100, y: 60 })).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 60 },
      { x: 100, y: 60 },
    ]);
  });

  it("loops around between the rows when the target is behind the source", () => {
    expect(stepPoints({ x: 100, y: 0 }, { x: 0, y: 100 }, 20)).toEqual([
      { x: 100, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 50 },
      { x: -20, y: 50 },
      { x: -20, y: 100 },
      { x: 0, y: 100 },
    ]);
  });

  it("loops when the target is level but behind", () => {
    expect(stepPoints({ x: 100, y: 0 }, { x: 0, y: 0 }, 20)).toHaveLength(6);
  });

  it("loops when the target is too close ahead to turn twice", () => {
    expect(stepPoints({ x: 0, y: 0 }, { x: 30, y: 40 }, 20)).toHaveLength(6);
  });
});

describe("roundedPath", () => {
  it("is empty for no points", () => {
    expect(roundedPath([])).toBe("");
  });

  it("is a bare move for one point", () => {
    expect(roundedPath([{ x: 1, y: 2 }])).toBe("M 1 2");
  });

  it("draws straight segments without curves", () => {
    expect(roundedPath([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe("M 0 0 L 10 0");
  });

  it("rounds each corner with a quadratic curve through the corner", () => {
    expect(roundedPath([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 60 }], 8)).toBe("M 0 0 L 42 0 Q 50 0 50 8 L 50 60");
  });

  it("shrinks the radius to half the shorter neighbouring segment", () => {
    expect(roundedPath([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 100 }], 8)).toBe("M 0 0 L 2 0 Q 4 0 4 2 L 4 100");
  });

  it("falls back to a sharp corner when a segment has no length", () => {
    expect(roundedPath([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }])).toBe("M 0 0 L 0 0 L 10 0");
  });
});

describe("edgePath and connectionPath", () => {
  it("runs from the source's right handle to the target's left handle", () => {
    const from = nodeBox("a", { x: 0, y: 0 }, 80);
    const to = nodeBox("b", { x: 400, y: 0 }, 80);
    expect(edgePath(from, to)).toBe(`M ${NODE_WIDTH} 40 L 400 40`);
  });

  it("ends a connection line at the free point", () => {
    const from = nodeBox("a", { x: 0, y: 0 }, 80);
    const d = connectionPath(from, { x: 500, y: 200 });
    expect(d.startsWith(`M ${NODE_WIDTH} 40`)).toBe(true);
    expect(d.endsWith("L 500 200")).toBe(true);
  });
});

describe("boxesKey", () => {
  it("ignores order and position", () => {
    const a = [nodeBox("x", { x: 0, y: 0 }), nodeBox("y", { x: 5, y: 5 })];
    const b = [nodeBox("y", { x: 99, y: 0 }), nodeBox("x", { x: 1, y: 1 })];
    expect(boxesKey(a)).toBe(boxesKey(b));
  });

  it("changes when the node set changes", () => {
    expect(boxesKey([nodeBox("x", { x: 0, y: 0 })])).not.toBe(boxesKey([nodeBox("z", { x: 0, y: 0 })]));
    expect(boxesKey([])).toBe("");
  });
});
