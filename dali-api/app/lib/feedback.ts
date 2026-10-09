// DALI OS feedback (feature requests). Client-safe: the limits and pure
// helpers shared by the shell's feedback button, the /feedback feed and its
// action.

export const FEEDBACK_EMOJI = ["👍", "❤️", "🎉", "🚀", "👀", "😂"] as const;

export const FEEDBACK_BODY_MAX = 2000;
export const FEEDBACK_COMMENT_MAX = 1000;

export function isFeedbackEmoji(value: string): boolean {
  return (FEEDBACK_EMOJI as readonly string[]).includes(value);
}

/** The key a new screenshot uploads to (the presign route scopes it under uploads/). */
export function newFeedbackScreenshotKey(): string {
  return `feedback/${crypto.randomUUID()}.png`;
}

// The action stores whatever key the client names, so it only accepts the
// shape the composer itself mints.
export function isFeedbackScreenshotKey(key: string): boolean {
  return /^uploads\/feedback\/[0-9a-f-]{36}\.png$/.test(key);
}

export type ReactionSummary = { emoji: string; count: number; mine: boolean };

/** One chip per emoji in use, in the picker's order. */
export function summarizeReactions(
  rows: { emoji: string; userId: string }[],
  viewerId: string,
): ReactionSummary[] {
  return FEEDBACK_EMOJI.flatMap((emoji) => {
    const hits = rows.filter((r) => r.emoji === emoji);
    if (hits.length === 0) return [];
    return [{ emoji, count: hits.length, mine: hits.some((r) => r.userId === viewerId) }];
  });
}
