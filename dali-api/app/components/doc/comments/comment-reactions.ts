import type { CommentData } from "@blocknote/core/comments";
import type { ReactionSummary } from "~/lib/reactions";

export type CommentReactionInfo = { imageUrl?: string | null; names: Record<string, string> };

export type CommentMeta = {
  author?: string;
  authorPhotoUrl?: string | null;
  reactionInfo?: Record<string, CommentReactionInfo>;
};

/** A comment's reactions in the shape ReactionBar draws, oldest emoji first. */
export function commentReactionSummaries(comment: CommentData, viewerId: string): ReactionSummary[] {
  const info = (comment.metadata as CommentMeta | undefined)?.reactionInfo ?? {};
  return [...comment.reactions]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map(({ emoji, userIds }) => {
      const { imageUrl, names = {} } = info[emoji] ?? {};
      return {
        emoji,
        count: userIds.length,
        mine: userIds.includes(viewerId),
        people: userIds.filter((id) => id !== viewerId).map((id) => names[id] ?? "Unknown"),
        ...(imageUrl !== undefined ? { imageUrl } : {}),
      };
    });
}
