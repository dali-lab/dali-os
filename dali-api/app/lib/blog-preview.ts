// What the Resources front page shows of a blog post without opening it: a
// short excerpt and a cover image, both read off the body's blocks. Pure, so
// the collab sync-back and its test share it without a Prisma client.

import type { DocBlock, DocInline } from "~/collab/blocknote-server";

const EXCERPT_MAX = 240;

function inlineText(content: DocBlock["content"]): string {
  if (!Array.isArray(content)) return "";
  return (content as DocInline[])
    .map((i) => i.text ?? inlineText(i.content))
    .join("");
}

function walk(blocks: DocBlock[], visit: (b: DocBlock) => void): void {
  for (const b of blocks) {
    visit(b);
    if (b.children?.length) walk(b.children, visit);
  }
}

export function deriveBlogPreview(blocks: DocBlock[]): {
  excerpt: string;
  coverImageUrl: string | null;
} {
  let coverImageUrl: string | null = null;
  const text: string[] = [];
  walk(blocks, (b) => {
    if (b.type === "image" && !coverImageUrl && typeof b.props?.url === "string" && b.props.url) {
      coverImageUrl = b.props.url;
    }
    // Headings are structure, not the opening of the piece.
    if (b.type === "heading") return;
    const t = inlineText(b.content).trim();
    if (t) text.push(t);
  });
  const joined = text.join(" ");
  const excerpt =
    joined.length > EXCERPT_MAX
      ? `${joined.slice(0, EXCERPT_MAX).replace(/\s+\S*$/, "")}…`
      : joined;
  return { excerpt, coverImageUrl };
}

/** What a listing shows: the author's picks, else what the body yields. */
export function blogListing(post: {
  summary: string | null;
  excerpt: string;
  customCoverUrl: string | null;
  coverImageUrl: string | null;
}): { excerpt: string; coverImageUrl: string | null } {
  return {
    excerpt: post.summary?.trim() || post.excerpt,
    coverImageUrl: post.customCoverUrl ?? post.coverImageUrl,
  };
}
