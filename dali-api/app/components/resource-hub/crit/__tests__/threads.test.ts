import { describe, expect, it } from "vitest";
import type { SlideComment } from "~/lib/slide-comments";
import { buildThreads, firstLine, pinsOf, reactionSummaries, stepPinned, threadIsMine, wasEdited } from "../threads";

const c = (id: string, o: Partial<SlideComment> = {}): SlideComment => ({
  id, parentId: null, author: `Name ${id}`, authorId: `u-${id}`, body: `Body ${id}`, anchor: null, createdAt: "2026-11-15T10:00:00.000Z", ...o,
});
const pin = (x: number, y: number) => ({ kind: "image", x, y });

describe("buildThreads", () => {
  it("groups replies under their root and reads pins from image anchors", () => {
    const threads = buildThreads([c("a", { anchor: pin(0.1, 0.2) }), c("b"), c("r1", { parentId: "a" }), c("r2", { parentId: "a" })]);
    expect(threads.map((t) => [t.root.id, t.replies.map((r) => r.id), t.pin])).toEqual([["a", ["r1", "r2"], { x: 0.1, y: 0.2 }], ["b", [], null]]);
  });
});

describe("threadIsMine", () => {
  it("counts threads I started or replied in", () => {
    const [started, replied, other] = buildThreads([c("a", { authorId: "me" }), c("b"), c("r", { parentId: "b", authorId: "me" }), c("c")]);
    expect([threadIsMine(started, "me"), threadIsMine(replied, "me"), threadIsMine(other, "me")]).toEqual([true, true, false]);
  });
});

describe("pinsOf", () => {
  it("makes one pin per pinned thread with the starter, preview and reply count", () => {
    const pins = pinsOf(buildThreads([c("a", { anchor: pin(0.5, 0.5), body: "\nFirst line\nsecond" }), c("b"), c("r", { parentId: "a" })]));
    expect(pins).toEqual([{ threadId: "a", x: 0.5, y: 0.5, author: "Name a", authorPhotoUrl: null, replies: 1, preview: "First line" }]);
  });
  it("takes the first non-empty line as the preview", () => {
    expect(firstLine("\n  \n hello \nworld")).toBe("hello");
    expect(firstLine("")).toBe("");
  });
});

describe("stepPinned", () => {
  const threads = buildThreads([c("a", { anchor: pin(0, 0) }), c("n"), c("b", { anchor: pin(1, 1) }), c("d", { anchor: pin(1, 0) })]);
  it("steps through pinned threads only, wrapping at both ends", () => {
    expect(stepPinned(threads, "a", 1)).toBe("b");
    expect(stepPinned(threads, "d", 1)).toBe("a");
    expect(stepPinned(threads, "a", -1)).toBe("d");
  });
  it("starts at the first pin from an unpinned thread, and has nothing to step through without pins", () => {
    expect(stepPinned(threads, "n", 1)).toBe("a");
    expect(stepPinned(buildThreads([c("n")]), "n", 1)).toBeNull();
  });
});

describe("reactionSummaries", () => {
  it("groups by emoji oldest first, marks mine, and names the others", () => {
    const comment = c("a", {
      reactions: [
        { userId: "u2", emoji: "🎉", createdAt: "2026-11-15T10:02:00Z", name: "Grace" },
        { userId: "me", emoji: "👍", createdAt: "2026-11-15T10:01:00Z", name: "Ada" },
        { userId: "u3", emoji: "👍", createdAt: "2026-11-15T10:03:00Z", name: "Linus" },
      ],
    });
    expect(reactionSummaries(comment, "me")).toEqual([
      { emoji: "👍", count: 2, mine: true, people: ["Linus"] },
      { emoji: "🎉", count: 1, mine: false, people: ["Grace"] },
    ]);
  });
  it("keeps a custom emoji's image, including a deleted one", () => {
    const comment = c("a", { reactions: [{ userId: "u2", emoji: ":party:", createdAt: "2026-11-15T10:00:00Z", name: "Grace", imageUrl: null }] });
    expect(reactionSummaries(comment, "me")[0]).toMatchObject({ imageUrl: null });
  });
});

describe("wasEdited", () => {
  it("flags a comment updated after it was posted", () => {
    expect(wasEdited(c("a", { updatedAt: "2026-11-15T10:00:00.400Z" }))).toBe(false);
    expect(wasEdited(c("a", { updatedAt: "2026-11-15T10:05:00.000Z" }))).toBe(true);
    expect(wasEdited(c("a"))).toBe(false);
  });
});
