import type { ReactionSummary } from "~/lib/reactions";
import { imageAnchorOf } from "~/lib/crit-comments";
import type { SlideComment } from "~/lib/slide-comments";
import type { CommentPin } from "~/components/slides/collab/comment-pins";

export interface CritThread {
  root: SlideComment;
  replies: SlideComment[];
  pin: { x: number; y: number } | null;
}

/** Top-level comments in posting order, each with its replies. */
export function buildThreads(comments: SlideComment[]): CritThread[] {
  const replies = new Map<string, SlideComment[]>();
  for (const c of comments) {
    if (c.parentId) replies.set(c.parentId, [...(replies.get(c.parentId) ?? []), c]);
  }
  return comments
    .filter((c) => c.parentId === null)
    .map((root) => {
      const anchor = imageAnchorOf(root.anchor);
      return { root, replies: replies.get(root.id) ?? [], pin: anchor ? { x: anchor.x, y: anchor.y } : null };
    });
}

/** A thread is "mine" when I started it or replied in it. */
export function threadIsMine(thread: CritThread, viewerId: string): boolean {
  return thread.root.authorId === viewerId || thread.replies.some((r) => r.authorId === viewerId);
}

export const firstLine = (body: string) => body.split("\n").find((l) => l.trim())?.trim() ?? "";

export function pinsOf(threads: CritThread[]): CommentPin[] {
  return threads.flatMap((t) =>
    t.pin
      ? [{ threadId: t.root.id, ...t.pin, author: t.root.author, authorPhotoUrl: t.root.authorPhotoUrl ?? null, replies: t.replies.length, preview: firstLine(t.root.body) }]
      : [],
  );
}

/** The pinned thread before or after `currentId`, wrapping around. */
export function stepPinned(threads: CritThread[], currentId: string, direction: 1 | -1): string | null {
  const pinned = threads.filter((t) => t.pin);
  if (pinned.length === 0) return null;
  const at = pinned.findIndex((t) => t.root.id === currentId);
  if (at === -1) return pinned[0].root.id;
  return pinned[(at + direction + pinned.length) % pinned.length].root.id;
}

export function reactionSummaries(comment: SlideComment, viewerId: string): ReactionSummary[] {
  const byEmoji = new Map<string, NonNullable<SlideComment["reactions"]>>();
  for (const r of [...(comment.reactions ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    byEmoji.set(r.emoji, [...(byEmoji.get(r.emoji) ?? []), r]);
  }
  return [...byEmoji].map(([emoji, hits]) => ({
    emoji,
    count: hits.length,
    mine: hits.some((h) => h.userId === viewerId),
    people: hits.filter((h) => h.userId !== viewerId).map((h) => h.name ?? "Unknown"),
    ...(hits[0].imageUrl !== undefined ? { imageUrl: hits[0].imageUrl } : {}),
  }));
}

export const wasEdited = (c: SlideComment) => !!c.updatedAt && new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime() > 1000;
