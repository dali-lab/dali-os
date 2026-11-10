import { prisma } from "~/lib/db.server";

/**
 * Short-lived cache for Google reads, keyed by who is asking and which window.
 * Switching month / week / day re-runs the loader, and the fetch underneath
 * costs one Google `events.list` per linked sub-calendar, so a switch is a
 * cache hit instead of a full set of round-trips.
 *
 * The map is per process but the "something changed" signal is not: every
 * write that can change a Google read stamps `User.calendarDataChangedAt`, and
 * the loader passes that stamp in so any machine treats older entries as a miss.
 */
const EXTERNAL_CACHE_TTL_MS = 30_000;
const EXTERNAL_CACHE_MAX = 200;
const externalCache = new Map<string, { at: number; value: unknown }>();

/**
 * An entry is only valid when its read STARTED after the last change. Using the
 * start (not the finish) means a read that raced a write is never trusted.
 */
export function isFreshCacheEntry(
  entry: { at: number } | undefined,
  now: number,
  changedAt: Date | null | undefined,
): boolean {
  if (!entry) return false;
  if (now - entry.at >= EXTERNAL_CACHE_TTL_MS) return false;
  if (changedAt && entry.at <= changedAt.getTime()) return false;
  return true;
}

export async function cachedExternalRead<T>(
  key: string,
  read: () => Promise<T>,
  changedAt?: Date | null,
): Promise<T> {
  const hit = externalCache.get(key);
  if (isFreshCacheEntry(hit, Date.now(), changedAt)) return hit!.value as T;
  const startedAt = Date.now();
  const value = await read();
  if (externalCache.size >= EXTERNAL_CACHE_MAX) {
    const oldest = externalCache.keys().next().value;
    if (oldest !== undefined) externalCache.delete(oldest);
  }
  externalCache.set(key, { at: startedAt, value });
  return value;
}

/** Drop a user's cached reads on this machine. */
export function invalidateExternalCache(userId: string): void {
  for (const key of externalCache.keys()) {
    if (key.startsWith(`${userId}:`)) externalCache.delete(key);
  }
}

/**
 * Record that these users' Google calendars just changed: drops this machine's
 * cache and stamps the durable marker so every other machine does the same on
 * its next read. Pass the acting user first; attendees whose calendars the
 * change also touches go in `alsoUserIds`.
 */
export async function markCalendarChanged(
  userId: string,
  alsoUserIds: readonly string[] = [],
): Promise<void> {
  const ids = [...new Set([userId, ...alsoUserIds])];
  for (const id of ids) invalidateExternalCache(id);
  try {
    await prisma.user.updateMany({
      where: { id: { in: ids } },
      data: { calendarDataChangedAt: new Date() },
    });
  } catch (err) {
    // The write that triggered this already succeeded; a lost stamp only means
    // other machines serve their cache until its TTL.
    console.error("[calendar] failed to stamp calendarDataChangedAt", err);
  }
}
