import { describe, expect, it } from "vitest";
import { critThreadHref, imageAnchorOf, maskAnonymousAuthor, parseCritLink } from "../crit-comments";
import { commentAnchorSchema } from "../slide-comments";

describe("crit thread links", () => {
  it("builds a link to a post and a thread on it", () => {
    expect(critThreadHref("p1", { submissionId: "s1" })).toBe("/resource-hub/p1/crit?post=s1");
    expect(critThreadHref("p1", { submissionId: "s1", threadId: "c1" })).toBe("/resource-hub/p1/crit?post=s1&thread=c1");
  });
  it("reads the post and thread back from the query", () => {
    expect(parseCritLink(new URLSearchParams("post=s1&thread=c1"))).toEqual({ submissionId: "s1", threadId: "c1" });
    expect(parseCritLink(new URLSearchParams(""))).toEqual({ submissionId: null, threadId: null });
  });
});

describe("image anchors", () => {
  it("accepts a point as fractions of the image", () => {
    expect(commentAnchorSchema.safeParse({ kind: "image", x: 0, y: 1 }).success).toBe(true);
    expect(commentAnchorSchema.safeParse({ kind: "image", x: 0.4, y: 0.6 }).success).toBe(true);
  });
  it("rejects out-of-range, missing, or extra fields", () => {
    for (const bad of [{ kind: "image", x: 1.1, y: 0.5 }, { kind: "image", x: -0.1, y: 0.5 }, { kind: "image", x: 0.5 }, { kind: "image", x: 0.5, y: 0.5, slideId: "a" }, { kind: "image", x: "0.5", y: 0.5 }]) {
      expect(commentAnchorSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
  it("reads a stored anchor and ignores anything else", () => {
    expect(imageAnchorOf({ kind: "image", x: 0.2, y: 0.3 })).toEqual({ kind: "image", x: 0.2, y: 0.3 });
    expect(imageAnchorOf({ kind: "slide", slideId: "a" })).toBeNull();
    expect(imageAnchorOf(null)).toBeNull();
  });
});

describe("maskAnonymousAuthor", () => {
  const c = (id: string, authorId: string) => ({ id, authorId, author: authorId === "poster" ? "Ada Lovelace" : "Leo", authorPhotoUrl: "/p.png", reactions: [{ userId: "poster", name: "Ada Lovelace" }, { userId: "u2", name: "Leo" }] });
  it("renames the hidden author's comments and reactions, and leaves everyone else alone", () => {
    const out = maskAnonymousAuthor([c("a", "poster"), c("b", "u2")], "poster");
    expect(out[0]).toMatchObject({ authorId: "anonymous", author: "Anonymous", authorPhotoUrl: null });
    expect(out[0]!.reactions).toEqual([{ userId: "anonymous", name: "Anonymous" }, { userId: "u2", name: "Leo" }]);
    expect(out[1]).toMatchObject({ authorId: "u2", author: "Leo", authorPhotoUrl: "/p.png" });
    expect(JSON.stringify(out)).not.toContain("Ada");
  });
  it("masks reactions that carry no name", () => {
    const out = maskAnonymousAuthor([{ ...c("a", "u2"), reactions: [{ userId: "poster" }] }], "poster");
    expect(out[0]!.reactions).toEqual([{ userId: "anonymous" }]);
  });
  it("returns the comments untouched when no one is hidden", () => {
    const list = [c("a", "poster")];
    expect(maskAnonymousAuthor(list, null)).toBe(list);
  });
});
