import { fullName } from "~/lib/display";

// Emoji reactions, shared by Feedback and Gallery. Client-safe. A reaction's
// emoji is either a standard emoji or ":name:" for a custom one.

/** Distinct emoji on one post. Adding to an existing chip is always allowed. */
export const MAX_REACTION_EMOJI = 20;

export const CUSTOM_EMOJI_NAME = /^[a-z0-9_-]{2,48}$/;

export type ReactionSummary = {
  emoji: string;
  count: number;
  mine: boolean;
  /** Everyone else who reacted. Absent where names aren't loaded. */
  people?: string[];
  /** Custom emoji only. `null` once the emoji has been deleted. */
  imageUrl?: string | null;
};

export type ReactionRow = {
  emoji: string;
  userId: string;
  createdAt: Date;
  user?: Parameters<typeof fullName>[0];
};

/** The name in a ":name:" reaction, or null for a standard emoji. */
export function customEmojiName(emoji: string): string | null {
  const name = /^:(.+):$/.exec(emoji)?.[1];
  return name && CUSTOM_EMOJI_NAME.test(name) ? name : null;
}

/** One chip per emoji in use, oldest first, so chips don't move as counts change. */
export function summarizeReactions(rows: ReactionRow[], viewerId: string): ReactionSummary[] {
  const byEmoji = new Map<string, ReactionRow[]>();
  const oldestFirst = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const row of oldestFirst) {
    byEmoji.set(row.emoji, [...(byEmoji.get(row.emoji) ?? []), row]);
  }
  return [...byEmoji].map(([emoji, hits]) => ({
    emoji,
    count: hits.length,
    mine: hits.some((r) => r.userId === viewerId),
    ...(hits[0].user
      ? { people: hits.filter((r) => r.userId !== viewerId).map((r) => fullName(r.user!)) }
      : {}),
  }));
}

const NAMES_SHOWN = 5;

/** "Ada Lovelace, Grace Hopper and you reacted with 👍", or null without names. */
export function reactionSentence({ emoji, count, mine, people }: ReactionSummary): string | null {
  if (!people) return null;
  const named = [...people.slice(0, mine ? NAMES_SHOWN - 1 : NAMES_SHOWN), ...(mine ? ["you"] : [])];
  const others = count - named.length;
  let who: string;
  if (others > 0) {
    who = `${named.join(", ")} and ${others} ${others === 1 ? "other" : "others"}`;
  } else if (named.length > 1) {
    who = `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
  } else {
    who = named[0] ?? "";
  }
  if (!who) return null;
  return `${who.charAt(0).toUpperCase()}${who.slice(1)} reacted with ${emoji}`;
}

/** The viewer's reaction toggled locally, so a tap shows before the server answers. */
export function toggleReaction(
  reactions: ReactionSummary[],
  emoji: string,
  imageUrl?: string | null,
): ReactionSummary[] {
  if (!reactions.some((r) => r.emoji === emoji)) {
    return [
      ...reactions,
      { emoji, count: 1, mine: true, people: [], ...(imageUrl ? { imageUrl } : {}) },
    ];
  }
  return reactions
    .map((r) => (r.emoji === emoji ? { ...r, count: r.count + (r.mine ? -1 : 1), mine: !r.mine } : r))
    .filter((r) => r.count > 0);
}

export function hasRoomForReaction(used: string[], emoji: string): boolean {
  return used.includes(emoji) || new Set(used).size < MAX_REACTION_EMOJI;
}
