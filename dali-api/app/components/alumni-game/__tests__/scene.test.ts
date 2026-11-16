import { describe, it, expect } from "vitest";
import { clampPanAxis } from "../scene";

describe("clampPanAxis", () => {
  const world = 2560;
  const view = 1000;

  it("keeps a pan that stays inside the world", () => {
    expect(clampPanAxis(100, 1280, view, world)).toBe(100);
    expect(clampPanAxis(-100, 1280, view, world)).toBe(-100);
  });

  it("clamps so the view edge stops at the world edge", () => {
    expect(clampPanAxis(-5000, 1280, view, world)).toBe(view / 2 - 1280);
    expect(clampPanAxis(5000, 1280, view, world)).toBe(world - view / 2 - 1280);
  });

  it("cannot pan past the edge the avatar already sits near", () => {
    expect(clampPanAxis(-300, 400, view, world)).toBe(view / 2 - 400);
    expect(clampPanAxis(300, 2400, view, world)).toBe(world - view / 2 - 2400);
  });

  it("returns 0 when the view covers the whole world", () => {
    expect(clampPanAxis(250, 1280, world, world)).toBe(0);
    expect(clampPanAxis(-250, 1280, world + 100, world)).toBe(0);
  });
});
