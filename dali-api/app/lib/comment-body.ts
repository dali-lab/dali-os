// Shared types and pure functions for comment rich bodies (bodyJson column).
// No React, no Prisma — safe to import from both server routes and client components.

// ── Segment types ─────────────────────────────────────────────────────────────

export type TextSegment = { type: "text"; text: string };
export type MentionSegment = { type: "mention"; userId: string; label: string };
/** A flat inline segment in a comment body. Stored in DocComment.bodyJson. */
export type BodySegment = TextSegment | MentionSegment;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse a plain-text comment body that may contain "@handle" tokens, using a
 * resolved handle→userId map, into a BodySegment array.
 *
 * Tokens not present in handleToUserId are left as plain-text "@handle"
 * (unknown handles, typos). Those will not trigger mention notifications.
 */
export function parseBodySegments(
  text: string,
  handleToUserId: Map<string, string>,
): BodySegment[] {
  const segments: BodySegment[] = [];
  const parts = text.split(/(@[a-zA-Z0-9_]+)/);
  for (const part of parts) {
    if (part.startsWith("@")) {
      const handle = part.slice(1).toLowerCase();
      const userId = handleToUserId.get(handle);
      if (userId) {
        segments.push({ type: "mention", userId, label: part.slice(1) });
        continue;
      }
    }
    if (part) {
      segments.push({ type: "text", text: part });
    }
  }
  return segments;
}

/** Flatten a BodySegment array back to plain text (for the `body` column). */
export function segmentsToPlainText(segments: BodySegment[]): string {
  return segments
    .map((s) => (s.type === "mention" ? `@${s.label}` : s.text))
    .join("");
}

/** Extract userIds of all mention segments, deduped. */
export function segmentMentionUserIds(segments: BodySegment[]): string[] {
  const ids = new Set<string>();
  for (const s of segments) {
    if (s.type === "mention") ids.add(s.userId);
  }
  return [...ids];
}

/** Handle to user id for the chips already on a comment, with anything newly picked layered on top. */
export function mentionHandleMap(chips: BodySegment[] | null | undefined, picked?: Map<string, string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of chips ?? []) if (s.type === "mention") map.set(s.label.toLowerCase(), s.userId);
  for (const [handle, userId] of picked ?? []) map.set(handle, userId);
  return map;
}

/** Rebuild an edited plain body's segments, keeping the chips of people already mentioned on the comment. */
export function keepMentionChips(text: string, prev: BodySegment[]): BodySegment[] {
  return parseBodySegments(text, mentionHandleMap(prev));
}
