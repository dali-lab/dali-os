import { cachedForTtl, clearTtlCache } from "~/lib/ttl-cache";
import { publish, subscribe } from "~/lib/realtime-bus.server";

// Per-user cache for the shell (layout) loader's reads, which ran on every
// navigation. Only the layout reads through here: actions and page loaders keep
// calling the same helpers uncached, so authorization never sees stale data.
// A write that changes one of these clears it on every machine through the
// realtime bus; the TTL bounds anything a write site doesn't clear.

export type LayoutPiece =
  | "roles"
  | "gates"
  | "hiring"
  | "mentor"
  | "favorites"
  | "releaseNotes"
  | "newMember"
  | "activities";

export const LAYOUT_CACHE_TTL_MS: Record<LayoutPiece, number> = {
  roles: 60_000,
  gates: 30_000,
  hiring: 60_000,
  mentor: 60_000,
  // Recents ride along with favorites and are never cleared by a visit, so
  // this TTL is how far behind the Recent list can run.
  favorites: 30_000,
  releaseNotes: 60_000,
  newMember: 5 * 60_000,
  activities: 30_000,
};

// The scope for a read that is the same for every user (live activity rows).
export const LAB_SCOPE = "lab";

const TOPIC = "layout-cache";

const keyPrefix = (piece: LayoutPiece, userId?: string) =>
  userId === undefined ? `layout:${piece}:` : `layout:${piece}:${userId}:`;

type Invalidation = { piece: LayoutPiece; userIds?: string[] };

function clearLocal({ piece, userIds }: Invalidation): void {
  if (!userIds) return clearTtlCache(keyPrefix(piece));
  for (const userId of userIds) clearTtlCache(keyPrefix(piece, userId));
}

const g = globalThis as unknown as { __layoutCacheListening?: boolean };
function listen(): void {
  if (g.__layoutCacheListening) return;
  g.__layoutCacheListening = true;
  subscribe(TOPIC, (event, data) => {
    // A sync means invalidations may have been lost while Redis was down.
    if (event === "sync" || !data) return clearTtlCache("layout:");
    try {
      clearLocal(JSON.parse(data) as Invalidation);
    } catch {
      clearTtlCache("layout:");
    }
  });
}

/**
 * The layout's read of `piece` for `userId`. `variant` keys inputs other than
 * the user (e.g. the live cycle ids); `shouldCache` keeps results that must
 * never be served stale (an owed signature, a non-member) out of the cache.
 */
export function cachedForLayout<T>(
  userId: string,
  piece: LayoutPiece,
  compute: () => Promise<T>,
  { variant = "", shouldCache }: { variant?: string; shouldCache?: (value: T) => boolean } = {},
): Promise<T> {
  listen();
  return cachedForTtl(
    `${keyPrefix(piece, userId)}${variant}`,
    LAYOUT_CACHE_TTL_MS[piece],
    compute,
    shouldCache,
  );
}

// Tables whose writes change a cached piece for anyone. db.ts clears these
// pieces lab-wide after every write to them, so no write site can forget to.
// UserFavorite is left out on purpose: page visits write it on every load,
// so user-pages.server.ts clears favorites for the starring user only.
export const LAYOUT_PIECES_BY_MODEL = {
  AdminMembership: ["roles"],
  CoreAssignment: ["roles"],
  InstructorAssignment: ["roles"],
  DomainLeadAssignment: ["roles", "mentor"],
  CycleInterviewer: ["roles", "hiring"],
  CycleReviewer: ["hiring"],
  ProjectAssignment: ["mentor"],
  MentorshipPair: ["gates"],
  SigningBinding: ["gates"],
  StaffingCycleFormBinding: ["gates"],
  ReleaseNote: ["releaseNotes"],
  Activity: ["activities"],
} as const satisfies Record<string, readonly LayoutPiece[]>;

export const WRITE_OPERATIONS: ReadonlySet<string> = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
]);

export function invalidateLayoutCacheForWrite(model: string | undefined, operation: string): void {
  if (!model || !WRITE_OPERATIONS.has(operation)) return;
  const pieces = (LAYOUT_PIECES_BY_MODEL as Record<string, readonly LayoutPiece[]>)[model];
  for (const piece of pieces ?? []) invalidateLayoutCache(piece);
}

/**
 * Clear `piece` for `userIds` (every user when omitted) on every machine. Call
 * after the write commits, so a concurrent read can't re-cache the old value.
 */
export function invalidateLayoutCache(piece: LayoutPiece, userIds?: string[]): void {
  listen();
  const msg: Invalidation = userIds ? { piece, userIds: [...new Set(userIds)] } : { piece };
  if (msg.userIds?.length === 0) return;
  clearLocal(msg);
  if (msg.userIds) return publish(TOPIC, JSON.stringify(msg));
  // A bulk write (a staffing finalize, say) hits these tables row by row; tell
  // the other machines once per piece per tick rather than once per row.
  if (pendingLabWide.size === 0) setImmediate(flushLabWide);
  pendingLabWide.add(piece);
}

const pendingLabWide = new Set<LayoutPiece>();
function flushLabWide(): void {
  const pieces = [...pendingLabWide];
  pendingLabWide.clear();
  for (const piece of pieces) publish(TOPIC, JSON.stringify({ piece }));
}
