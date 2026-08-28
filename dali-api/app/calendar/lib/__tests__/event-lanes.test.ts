import { describe, it, expect } from "vitest";
import { computeEventLanes, type LaneInput } from "../event-block";

// Shorthand: a block from start→end hours (duration derived).
const ev = (start: number, end: number, buf?: { before?: number; after?: number }): LaneInput => ({
  startHour: start,
  duration: end - start,
  bufferBefore: buf?.before,
  bufferAfter: buf?.after,
});

describe("computeEventLanes", () => {
  it("returns nothing for no events", () => {
    expect(computeEventLanes([])).toEqual([]);
  });

  it("gives a lone event the full width", () => {
    expect(computeEventLanes([ev(9, 10)])).toEqual([{ left: 0, width: 1 }]);
  });

  it("keeps sequential (non-overlapping) events full width", () => {
    const lanes = computeEventLanes([ev(9, 10), ev(11, 12), ev(13, 14)]);
    expect(lanes).toEqual([
      { left: 0, width: 1 },
      { left: 0, width: 1 },
      { left: 0, width: 1 },
    ]);
  });

  it("treats back-to-back (touching edges) as non-overlapping", () => {
    const lanes = computeEventLanes([ev(9, 10), ev(10, 11)]);
    expect(lanes).toEqual([
      { left: 0, width: 1 },
      { left: 0, width: 1 },
    ]);
  });

  it("splits two overlapping events into halves", () => {
    const lanes = computeEventLanes([ev(9, 10.5), ev(10, 11)]);
    expect(lanes).toEqual([
      { left: 0, width: 0.5 },
      { left: 0.5, width: 0.5 },
    ]);
  });

  it("splits three mutually overlapping events into thirds", () => {
    const lanes = computeEventLanes([ev(9, 10), ev(9, 10), ev(9, 10)]);
    expect(lanes.map((l) => l.width)).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(lanes.map((l) => l.left)).toEqual([0, 1 / 3, 2 / 3]);
  });

  it("is index-aligned regardless of input order", () => {
    // Same two events, passed later-first: lane[0] is still the 10–11 block.
    const lanes = computeEventLanes([ev(10, 11), ev(9, 10.5)]);
    expect(lanes).toHaveLength(2);
    // Each occupies its own half; the earlier-starting one is the left column.
    const early = lanes[1]; // ev(9,10.5)
    const late = lanes[0]; // ev(10,11)
    expect(early.left).toBe(0);
    expect(late.left).toBe(0.5);
  });

  it("counts buffer frames as part of the collision extent", () => {
    // Bodies don't overlap (9–10, 10–11) but the first's after-buffer reaches
    // into the second, so they still split into columns.
    const lanes = computeEventLanes([ev(9, 10, { after: 0.5 }), ev(10, 11)]);
    expect(lanes[0].width).toBe(0.5);
    expect(lanes[1].width).toBe(0.5);
  });

  it("only widens the cluster that actually overlaps", () => {
    // Two overlapping in the morning, one lone in the afternoon.
    const lanes = computeEventLanes([ev(9, 10.5), ev(10, 11), ev(14, 15)]);
    expect(lanes[0]).toEqual({ left: 0, width: 0.5 });
    expect(lanes[1]).toEqual({ left: 0.5, width: 0.5 });
    expect(lanes[2]).toEqual({ left: 0, width: 1 }); // separate cluster → full width
  });

  it("keeps every lane within bounds for an interlocking staircase", () => {
    const lanes = computeEventLanes([ev(9, 9.5), ev(9.4, 9.9), ev(9.8, 10.3), ev(10.2, 10.7)]);
    for (const l of lanes) {
      expect(l.left).toBeGreaterThanOrEqual(0);
      expect(l.left + l.width).toBeLessThanOrEqual(1 + 1e-9);
      expect(l.width).toBeGreaterThan(0);
    }
  });
});
