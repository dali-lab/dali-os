import { describe, expect, it } from "vitest";
import {
  commentAnchorSchema,
  groupSlideThreads,
  parseSlideLink,
  slideThreadHref,
  threadCountsBySlide,
  type SlideComment,
} from "~/lib/slide-comments";

const c = (id: string, anchor: unknown, parentId: string | null = null): SlideComment => ({
  id,
  parentId,
  author: "Ada",
  authorId: "u1",
  body: id,
  anchor,
  createdAt: `2026-11-05T10:0${id.length}:00.000Z`,
});

describe("commentAnchorSchema", () => {
  it.each([
    [{ kind: "slide", slideId: "s1" }],
    [{ kind: "slide", slideId: "s1", elementId: "title" }],
    [{ kind: "slide", slideId: "s1", x: 0.25, y: 1 }],
    [{ kind: "blocknote" }],
    [{ kind: "blocknote", slideId: "s1", elementId: "body" }],
    [{ from: "a", to: "b" }],
    [null],
    [undefined],
  ])("accepts %j", (anchor) => {
    expect(commentAnchorSchema.safeParse(anchor).success).toBe(true);
  });

  it.each([
    ["no slide id", { kind: "slide" }],
    ["empty slide id", { kind: "slide", slideId: "" }],
    ["x without y", { kind: "slide", slideId: "s1", x: 0.5 }],
    ["x out of range", { kind: "slide", slideId: "s1", x: 1.5, y: 0.5 }],
    ["negative y", { kind: "slide", slideId: "s1", x: 0.5, y: -0.1 }],
    ["string coordinate", { kind: "slide", slideId: "s1", x: "0.5", y: "0.5" }],
    ["unknown kind", { kind: "pin", slideId: "s1" }],
    ["extra keys", { kind: "slide", slideId: "s1", html: "<b>" }],
    ["element without slide", { kind: "blocknote", elementId: "body" }],
    ["oversized id", { kind: "slide", slideId: "x".repeat(65) }],
    ["a string", "slide"],
  ])("rejects %s", (_name, anchor) => {
    expect(commentAnchorSchema.safeParse(anchor).success).toBe(false);
  });
});

describe("links", () => {
  it("builds and reads the slide and thread params", () => {
    const href = slideThreadHref("p1", { slideId: "s1", threadId: "t1" });
    expect(href).toBe("/slides/p1?slide=s1&thread=t1");
    expect(parseSlideLink(new URL(href, "http://x").searchParams)).toEqual({ slideId: "s1", threadId: "t1" });
  });

  it("leaves out what is missing", () => {
    expect(slideThreadHref("p1", { threadId: "t1" })).toBe("/slides/p1?thread=t1");
    expect(slideThreadHref("p1", {})).toBe("/slides/p1");
    expect(parseSlideLink(new URLSearchParams(""))).toEqual({ slideId: null, threadId: null });
  });
});

describe("groupSlideThreads", () => {
  const comments = [
    c("a", { kind: "slide", slideId: "s2" }),
    c("bb", { kind: "slide", slideId: "s1", elementId: "title" }),
    c("ccc", { kind: "blocknote", slideId: "s1", elementId: "body" }),
    c("dddd", { kind: "slide", slideId: "gone" }),
    c("eeeee", null),
    c("r1", null, "a"),
  ];

  it("lists slides in deck order, then deleted slides, then deck threads", () => {
    const groups = groupSlideThreads(comments, ["s1", "s2", "s3"]);
    expect(groups.map((g) => [g.slideId, g.number, g.deleted])).toEqual([
      ["s1", 1, false],
      ["s2", 2, false],
      ["gone", null, true],
      [null, null, false],
    ]);
  });

  it("classifies threads and attaches replies", () => {
    const groups = groupSlideThreads(comments, ["s1", "s2"]);
    expect(groups[0].threads.map((t) => t.kind)).toEqual(["element", "text"]);
    expect(groups[1].threads[0].replies.map((r) => r.id)).toEqual(["r1"]);
  });

  it("keeps threads on a deleted slide so a restore brings them back", () => {
    const before = groupSlideThreads(comments, ["s1", "s2", "gone"]);
    const after = groupSlideThreads(comments, ["s1", "s2"]);
    expect(before.find((g) => g.slideId === "gone")?.deleted).toBe(false);
    expect(after.find((g) => g.slideId === "gone")?.threads).toHaveLength(1);
  });
});

describe("threadCountsBySlide", () => {
  it("counts threads, not replies, and skips deck threads", () => {
    const counts = threadCountsBySlide([
      c("a", { kind: "slide", slideId: "s1" }),
      c("bb", { kind: "blocknote", slideId: "s1", elementId: "title" }),
      c("r", { kind: "slide", slideId: "s1" }, "a"),
      c("cc", null),
    ]);
    expect([...counts]).toEqual([["s1", 2]]);
  });
});
