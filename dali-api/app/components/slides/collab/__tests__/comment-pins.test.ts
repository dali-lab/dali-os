import { describe, expect, it } from "vitest";
import { elementAtPoint, pinPosition, pinsForSlide } from "../comment-pins";
import type { SlideComment } from "~/lib/slide-comments";

const root = (id: string, anchor: unknown): SlideComment => ({
  id,
  parentId: null,
  author: "Ada",
  authorId: "u1",
  body: "hi",
  anchor,
  createdAt: "2026-11-05T10:00:00.000Z",
});

describe("pinPosition", () => {
  it("uses the point it was dropped at", () => {
    expect(pinPosition({ kind: "slide", slideId: "s", x: 0.3, y: 0.6 }, "content")).toEqual({ x: 0.3, y: 0.6 });
  });

  it("falls to the top right corner of its element", () => {
    const pos = pinPosition({ kind: "slide", slideId: "s", elementId: "title" }, "content");
    expect(pos.x).toBeGreaterThan(0.5);
    expect(pos.y).toBeLessThan(0.3);
  });

  it("falls to the slide's top left with no point or element", () => {
    expect(pinPosition({ kind: "slide", slideId: "s" }, "content")).toEqual({ x: 0.02, y: 0.03 });
    expect(pinPosition({ kind: "slide", slideId: "s", elementId: "removed" }, "content")).toEqual({ x: 0.02, y: 0.03 });
  });
});

describe("elementAtPoint", () => {
  it("finds the slot under a point and nothing in the margin", () => {
    expect(elementAtPoint("content", 0.5, 0.05)).toBeNull();
    expect(elementAtPoint("content", 0.5, 0.2)).toBe("title");
  });
});

describe("pinsForSlide", () => {
  const comments = [
    root("a", { kind: "slide", slideId: "s1", x: 0.1, y: 0.2 }),
    root("b", { kind: "slide", slideId: "s2" }),
    root("c", { kind: "blocknote", slideId: "s1", elementId: "body" }),
    { ...root("r", null), parentId: "a" },
  ];

  it("returns only pinned threads on the slide, with their reply counts", () => {
    const pins = pinsForSlide(comments, "s1", "content");
    expect(pins).toEqual([{ threadId: "a", x: 0.1, y: 0.2, author: "Ada", authorPhotoUrl: null, replies: 1 }]);
  });
});
