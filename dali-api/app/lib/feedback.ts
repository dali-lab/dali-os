// DALI OS feedback (feature requests). Client-safe: the limits and pure
// helpers shared by the shell's feedback button, the /feedback feed and its
// action.

/** The picker's quick row. Any emoji can be used. */
export const FEEDBACK_EMOJI = ["👍", "❤️", "🎉", "🚀", "👀", "😂"] as const;

export const FEEDBACK_BODY_MAX = 2000;
export const FEEDBACK_COMMENT_MAX = 1000;

/** The key a new screenshot uploads to (the presign route scopes it under uploads/). */
export function newFeedbackScreenshotKey(): string {
  return `feedback/${crypto.randomUUID()}.png`;
}

// The action stores whatever key the client names, so it only accepts the
// shape the composer itself mints.
export function isFeedbackScreenshotKey(key: string): boolean {
  return /^uploads\/feedback\/[0-9a-f-]{36}\.png$/.test(key);
}

export const FEED_IDS_MAX = 50;
