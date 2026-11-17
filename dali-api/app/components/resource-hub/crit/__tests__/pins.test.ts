import { describe, expect, it } from "vitest";
import { isCommentShortcut, pointToFraction } from "../pins";

const rect = { left: 100, top: 50, width: 400, height: 200 };

describe("pointToFraction", () => {
  it("measures a click as a fraction of the rendered image", () => {
    expect(pointToFraction(300, 150, rect)).toEqual({ x: 0.5, y: 0.5 });
    expect(pointToFraction(100, 50, rect)).toEqual({ x: 0, y: 0 });
  });
  it("gives the same position when the image is shown at another size", () => {
    expect(pointToFraction(250, 100, { left: 0, top: 0, width: 500, height: 200 })).toEqual({ x: 0.5, y: 0.5 });
    expect(pointToFraction(125, 50, { left: 0, top: 0, width: 250, height: 100 })).toEqual({ x: 0.5, y: 0.5 });
  });
  it("clamps clicks that land just outside, and ignores an unmeasured image", () => {
    expect(pointToFraction(900, -20, rect)).toEqual({ x: 1, y: 0 });
    expect(pointToFraction(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
  });
});

describe("isCommentShortcut", () => {
  const key = (k: string, target: EventTarget | null = null, mods = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, target, ...mods });
  const el = (tag: string) => ({ tagName: tag, isContentEditable: false }) as unknown as EventTarget;
  it("fires for a plain C", () => {
    expect(isCommentShortcut(key("c", el("DIV")))).toBe(true);
    expect(isCommentShortcut(key("C", el("DIV")))).toBe(true);
  });
  it("stays quiet while typing or with a modifier", () => {
    for (const t of ["INPUT", "TEXTAREA", "SELECT"]) expect(isCommentShortcut(key("c", el(t)))).toBe(false);
    expect(isCommentShortcut(key("c", { tagName: "DIV", isContentEditable: true } as unknown as EventTarget))).toBe(false);
    expect(isCommentShortcut(key("c", el("DIV"), { metaKey: true }))).toBe(false);
    expect(isCommentShortcut(key("x", el("DIV")))).toBe(false);
  });
});
