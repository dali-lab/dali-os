// Stitching the Email tab's message list together as older pages load.
// Client-safe.

import type { FeedCursor, FeedThread } from "~/email/lib/email.server";

export const threadRef = (t: FeedThread) => `${t.accountId}~${t.id}`;

// The loader's first page plus the older pages loaded since, newest first. The
// first page is the fresher copy, so it wins when a thread is in both.
export function mergeFeed(first: FeedThread[], older: FeedThread[]): FeedThread[] {
  const seen = new Set(first.map(threadRef));
  const rest = older.filter((t) => {
    const ref = threadRef(t);
    if (seen.has(ref)) return false;
    seen.add(ref);
    return true;
  });
  return [...first, ...rest].sort((x, y) => y.date.localeCompare(x.date));
}

// Threads new mail pushed off the first page when it reloaded. Older pages were
// fetched from the old page boundary, so without these the list would have a
// hole. A thread that left for another reason (archived, trashed) is newer than
// its inbox's oldest first-page thread and is not returned.
export function pushedOff(prev: FeedThread[], next: FeedThread[]): FeedThread[] {
  const kept = new Set(next.map(threadRef));
  const oldest = new Map<string, string>();
  for (const t of next) {
    const date = oldest.get(t.accountId);
    if (!date || t.date < date) oldest.set(t.accountId, t.date);
  }
  return prev.filter((t) => {
    const date = oldest.get(t.accountId);
    return !kept.has(threadRef(t)) && date !== undefined && t.date < date;
  });
}

// The `cursor` param of GET /api/email/threads. Null when it names no page.
export function parseFeedCursor(raw: string | null): FeedCursor | null {
  try {
    const parsed: unknown = JSON.parse(raw ?? "");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const tokens = Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "",
    );
    return tokens.length > 0 ? Object.fromEntries(tokens) : null;
  } catch {
    return null;
  }
}
