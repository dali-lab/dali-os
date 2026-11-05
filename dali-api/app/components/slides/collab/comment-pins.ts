import { layoutById, STAGE_H, STAGE_W } from "~/components/slides/deck/layouts";
import { anchorElementId, anchorSlideId, type SlideAnchor, type SlideComment } from "~/lib/slide-comments";

export interface CommentPin {
  threadId: string;
  x: number;
  y: number;
  author: string;
  authorPhotoUrl: string | null;
  replies: number;
}

const SLIDE_CORNER = { x: 0.02, y: 0.03 };

/** The slot a point (0-1 fractions of the slide) falls in, topmost last. */
export function elementAtPoint(layoutId: string, x: number, y: number): string | null {
  const px = x * STAGE_W;
  const py = y * STAGE_H;
  const hit = layoutById(layoutId).slots.filter(
    (s) => px >= s.rect.x && px <= s.rect.x + s.rect.w && py >= s.rect.y && py <= s.rect.y + s.rect.h,
  );
  return hit.length ? hit[hit.length - 1].slot : null;
}

/** Where a pin sits: its own point, else the top right corner of its element, else the slide's top left. */
export function pinPosition(anchor: SlideAnchor, layoutId: string): { x: number; y: number } {
  if (anchor.x !== undefined && anchor.y !== undefined) return { x: anchor.x, y: anchor.y };
  const slot = anchor.elementId ? layoutById(layoutId).slots.find((s) => s.slot === anchor.elementId) : null;
  if (!slot) return SLIDE_CORNER;
  return { x: Math.min(0.98, (slot.rect.x + slot.rect.w) / STAGE_W), y: Math.max(0.03, slot.rect.y / STAGE_H) };
}

/** The pinned threads (slide and element comments) on one slide. Text threads live in their editor. */
export function pinsForSlide(comments: SlideComment[], slideId: string, layoutId: string): CommentPin[] {
  return comments
    .filter((c) => c.parentId === null && anchorSlideId(c.anchor) === slideId && (c.anchor as { kind?: string }).kind === "slide")
    .map((root) => {
      const anchor = root.anchor as SlideAnchor;
      return {
        threadId: root.id,
        ...pinPosition({ ...anchor, elementId: anchorElementId(anchor) ?? undefined }, layoutId),
        author: root.author,
        authorPhotoUrl: root.authorPhotoUrl ?? null,
        replies: comments.filter((c) => c.parentId === root.id).length,
      };
    });
}
