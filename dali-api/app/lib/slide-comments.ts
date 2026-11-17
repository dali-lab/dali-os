import { z } from "zod";

const id = z.string().min(1).max(64);
const unit = z.number().min(0).max(1);

export const slideAnchorSchema = z
  .object({ kind: z.literal("slide"), slideId: id, elementId: id.optional(), x: unit.optional(), y: unit.optional() })
  .strict()
  .refine((a) => (a.x === undefined) === (a.y === undefined), { message: "x and y go together" });

export const textAnchorSchema = z
  .object({ kind: z.literal("blocknote"), slideId: id.optional(), elementId: id.optional() })
  .strict()
  .refine((a) => a.elementId === undefined || a.slideId !== undefined, { message: "elementId needs slideId" });

export const commentAnchorSchema = z.union([slideAnchorSchema, textAnchorSchema]).nullable().optional();

export type SlideAnchor = z.infer<typeof slideAnchorSchema>;
export type TextAnchor = z.infer<typeof textAnchorSchema>;
export type SlideScope = { slideId: string; elementId: string };

export function anchorSlideId(anchor: unknown): string | null {
  const a = anchor as { slideId?: unknown } | null;
  return a && typeof a === "object" && typeof a.slideId === "string" ? a.slideId : null;
}

export function anchorElementId(anchor: unknown): string | null {
  const a = anchor as { elementId?: unknown } | null;
  return a && typeof a === "object" && typeof a.elementId === "string" ? a.elementId : null;
}

export function slideThreadHref(pageId: string, target: { slideId?: string | null; threadId?: string | null }): string {
  const params = new URLSearchParams();
  if (target.slideId) params.set("slide", target.slideId);
  if (target.threadId) params.set("thread", target.threadId);
  const query = params.toString();
  return `/slides/${pageId}${query ? `?${query}` : ""}`;
}

export function parseSlideLink(search: URLSearchParams): { slideId: string | null; threadId: string | null } {
  return { slideId: search.get("slide") || null, threadId: search.get("thread") || null };
}

export interface SlideComment {
  id: string;
  parentId: string | null;
  author: string;
  authorId: string;
  authorPhotoUrl?: string | null;
  body: string;
  bodyJson?: import("~/lib/comment-body").BodySegment[] | null;
  anchor: unknown;
  createdAt: string;
}

export interface SlideThread {
  root: SlideComment;
  replies: SlideComment[];
  kind: "slide" | "element" | "text" | "deck";
}

export interface SlideThreadGroup {
  slideId: string | null;
  /** 1-based position among live slides; null for the deck group and deleted slides. */
  number: number | null;
  deleted: boolean;
  threads: SlideThread[];
}

function threadKind(anchor: unknown): SlideThread["kind"] {
  const a = anchor as { kind?: unknown; elementId?: unknown; slideId?: unknown } | null;
  if (!a || typeof a !== "object" || typeof a.slideId !== "string") return "deck";
  if (a.kind === "blocknote") return "text";
  return typeof a.elementId === "string" ? "element" : "slide";
}

/** Threads grouped by slide in deck order, then deleted slides, then deck-level threads. Nothing is dropped. */
export function groupSlideThreads(comments: SlideComment[], liveSlideIds: string[]): SlideThreadGroup[] {
  const replies = new Map<string, SlideComment[]>();
  for (const c of comments) {
    if (c.parentId) replies.set(c.parentId, [...(replies.get(c.parentId) ?? []), c]);
  }
  const bySlide = new Map<string | null, SlideThread[]>();
  for (const root of comments.filter((c) => c.parentId === null)) {
    const slideId = anchorSlideId(root.anchor);
    bySlide.set(slideId, [...(bySlide.get(slideId) ?? []), { root, replies: replies.get(root.id) ?? [], kind: threadKind(root.anchor) }]);
  }
  const groups: SlideThreadGroup[] = [];
  liveSlideIds.forEach((slideId, i) => {
    const threads = bySlide.get(slideId);
    if (threads) groups.push({ slideId, number: i + 1, deleted: false, threads });
  });
  for (const [slideId, threads] of bySlide) {
    if (slideId !== null && !liveSlideIds.includes(slideId)) groups.push({ slideId, number: null, deleted: true, threads });
  }
  const deck = bySlide.get(null);
  if (deck) groups.push({ slideId: null, number: null, deleted: false, threads: deck });
  return groups;
}

export function threadCountsBySlide(comments: SlideComment[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of comments) {
    const slideId = c.parentId === null ? anchorSlideId(c.anchor) : null;
    if (slideId) counts.set(slideId, (counts.get(slideId) ?? 0) + 1);
  }
  return counts;
}
