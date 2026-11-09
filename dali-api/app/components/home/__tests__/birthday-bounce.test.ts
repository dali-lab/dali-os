import { describe, expect, it } from "vitest";
import { advanceBounce, seedBounce, type BounceState, type Box } from "../birthday-bounce";

const BOUNDS: Box = { width: 1000, height: 600 };
const SIZE: Box = { width: 100, height: 100 };

describe("seedBounce", () => {
  it("starts inside the container and moving", () => {
    for (const i of [0, 1, 2, 7]) {
      const s = seedBounce(i, BOUNDS, SIZE);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(BOUNDS.width - SIZE.width);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(BOUNDS.height - SIZE.height);
      expect(Math.hypot(s.vx, s.vy)).toBeGreaterThan(0);
    }
  });

  it("spreads multiple bouncers to different spots", () => {
    const a = seedBounce(0, BOUNDS, SIZE);
    const b = seedBounce(1, BOUNDS, SIZE);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(50);
  });

  it("pins to the origin when the bouncer is larger than the container", () => {
    const s = seedBounce(0, { width: 50, height: 50 }, SIZE);
    expect(s.x).toBe(0);
    expect(s.y).toBe(0);
  });
});

describe("advanceBounce", () => {
  it("moves by velocity over the elapsed time", () => {
    const s: BounceState = { x: 100, y: 100, vx: 200, vy: -100 };
    const next = advanceBounce(s, 100, BOUNDS, SIZE);
    expect(next.x).toBeCloseTo(120);
    expect(next.y).toBeCloseTo(90);
    expect(next.vx).toBe(200);
    expect(next.vy).toBe(-100);
  });

  it("reflects off the right and bottom edges", () => {
    const s: BounceState = { x: 895, y: 495, vx: 100, vy: 100 };
    const next = advanceBounce(s, 100, BOUNDS, SIZE);
    expect(next.x).toBeCloseTo(895); // 905 reflected back off maxX=900
    expect(next.vx).toBe(-100);
    expect(next.y).toBeCloseTo(495); // 505 reflected back off maxY=500
    expect(next.vy).toBe(-100);
  });

  it("reflects off the left and top edges", () => {
    const s: BounceState = { x: 5, y: 5, vx: -100, vy: -100 };
    const next = advanceBounce(s, 100, BOUNDS, SIZE);
    expect(next.x).toBeCloseTo(5);
    expect(next.vx).toBe(100);
    expect(next.y).toBeCloseTo(5);
    expect(next.vy).toBe(100);
  });

  it("stays put in a zero-sized container instead of escaping", () => {
    const s: BounceState = { x: 0, y: 0, vx: 100, vy: 100 };
    const next = advanceBounce(s, 100, { width: 0, height: 0 }, SIZE);
    expect(next.x).toBe(0);
    expect(next.y).toBe(0);
  });

  it("never leaves the container across many frames", () => {
    let s = seedBounce(0, BOUNDS, SIZE);
    for (let i = 0; i < 500; i++) {
      s = advanceBounce(s, 48, BOUNDS, SIZE);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(BOUNDS.width - SIZE.width);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(BOUNDS.height - SIZE.height);
    }
  });
});
