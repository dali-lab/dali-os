import { describe, it, expect } from "vitest";
import { blogListing, deriveBlogPreview } from "../blog-preview";
import type { DocBlock } from "~/collab/blocknote-server";

function block(type: string, text = "", props: Record<string, unknown> = {}, children: DocBlock[] = []): DocBlock {
  return { id: type + text, type, props, content: text ? [{ type: "text", text }] : [], children };
}

describe("deriveBlogPreview", () => {
  it("takes the excerpt from body text and skips headings", () => {
    const { excerpt } = deriveBlogPreview([
      block("heading", "A title"),
      block("paragraph", "First line."),
      block("bulletListItem", "Second line."),
    ]);
    expect(excerpt).toBe("First line. Second line.");
  });

  it("cuts a long excerpt at a word boundary", () => {
    const { excerpt } = deriveBlogPreview([block("paragraph", "word ".repeat(100))]);
    expect(excerpt.length).toBeLessThanOrEqual(241);
    expect(excerpt.endsWith("word…")).toBe(true);
  });

  it("uses the first image as the cover, including a nested one", () => {
    const { coverImageUrl } = deriveBlogPreview([
      block("paragraph", "Intro", {}, [block("image", "", { url: "/api/upload/raw?key=uploads%2Fa.png" })]),
      block("image", "", { url: "/api/upload/raw?key=uploads%2Fb.png" }),
    ]);
    expect(coverImageUrl).toBe("/api/upload/raw?key=uploads%2Fa.png");
  });

  it("has no cover when the post has no image", () => {
    expect(deriveBlogPreview([block("paragraph", "Text")]).coverImageUrl).toBeNull();
  });
});

describe("blogListing", () => {
  const derived = { excerpt: "From the body.", coverImageUrl: "/body.png" };

  it("falls back to what the body yields", () => {
    expect(blogListing({ ...derived, summary: " ", customCoverUrl: null })).toEqual(derived);
  });

  it("prefers the author's summary and cover", () => {
    expect(blogListing({ ...derived, summary: "Mine.", customCoverUrl: "/mine.png" })).toEqual({
      excerpt: "Mine.",
      coverImageUrl: "/mine.png",
    });
  });
});
