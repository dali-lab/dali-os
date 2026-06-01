// Orchestrator: refresh a user's cached Dartmouth directory signals from
// both lookup.dartmouth.edu and api.dartmouth.edu/api/people, writing the
// results onto the User row.
//
// Lazy by default — callers pass `staleAfterDays` and we skip the network
// call when both caches are fresher than that. This is the function CAS
// callbacks fire-and-forget on login, and the annual Commencement sweep
// runs against every graduating member.
//
// Failure of either API is non-fatal: we log and move on. Tier-1 / Tier-3
// derivation in roles.ts simply falls through when a signal is absent.

import { prisma } from "~/lib/db";
import {
  lookupByNetId,
  type DartmouthLookupResult,
} from "~/lib/dartmouth-lookup";
import {
  peopleByNetId,
  type DartmouthPeopleResult,
} from "~/lib/dartmouth-people";

export type RefreshOptions = {
  // Skip the network call when both caches are this fresh. Default 30 days.
  staleAfterDays?: number;
  // When true, swallow errors and never throw — for fire-and-forget use
  // from CAS callback. Default true (background semantics).
  swallow?: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function isFresh(syncedAt: Date | null, staleAfterMs: number): boolean {
  if (!syncedAt) return false;
  return Date.now() - syncedAt.getTime() < staleAfterMs;
}

export async function refreshDartmouthSignals(
  userId: string,
  opts: RefreshOptions = {},
): Promise<void> {
  const staleAfterDays = opts.staleAfterDays ?? 30;
  const swallow = opts.swallow ?? true;
  const staleAfterMs = staleAfterDays * DAY_MS;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        netId: true,
        classYear: true,
        graduatedAt: true,
        dartmouthAffiliation: true,
        dartmouthLookupSyncedAt: true,
        dartmouthPeopleSyncedAt: true,
      },
    });

    if (!user || !user.netId) return;

    const lookupFresh = isFresh(user.dartmouthLookupSyncedAt, staleAfterMs);
    const peopleFresh = isFresh(user.dartmouthPeopleSyncedAt, staleAfterMs);
    if (lookupFresh && peopleFresh) return;

    // Fire both in parallel. Either may throw; we capture per-promise so
    // one bad API doesn't lose the other's data.
    const [lookupSettled, peopleSettled] = await Promise.allSettled([
      lookupFresh
        ? Promise.resolve(null as DartmouthLookupResult | null)
        : lookupByNetId(user.netId),
      peopleFresh
        ? Promise.resolve(null as DartmouthPeopleResult | null)
        : peopleByNetId(user.netId),
    ]);

    const now = new Date();
    const updates: Record<string, unknown> = {};

    if (lookupSettled.status === "fulfilled") {
      const lookup = lookupSettled.value;
      updates.dartmouthLookupSyncedAt = now;
      if (lookup) {
        updates.dartmouthLookupAffiliation = lookup.affiliation;
        // Only populate classYear when we don't already have one — user
        // input (or the Notion import) wins. Never clobber.
        if (lookup.classYear && user.classYear == null) {
          updates.classYear = lookup.classYear;
        }
      } else if (!lookupFresh) {
        // Absent-from-lookup: explicitly null out the cached affiliation so
        // staleness doesn't masquerade as "still a student."
        updates.dartmouthLookupAffiliation = null;
      }
    } else {
      console.warn(
        `dartmouth-refresh: lookup failed for userId=${userId}: ${lookupSettled.reason}`,
      );
    }

    if (peopleSettled.status === "fulfilled") {
      const people = peopleSettled.value;
      updates.dartmouthPeopleSyncedAt = now;
      if (people) {
        const affiliation = people.dartmouthAffiliation;
        updates.dartmouthAffiliation = affiliation;
        // First time we see ALUMNI and graduatedAt is null, stamp it. This
        // is the canonical "officially graduated" event. Don't overwrite an
        // existing graduatedAt — off-cycle grads set theirs manually.
        if (
          affiliation === "ALUMNI" &&
          user.dartmouthAffiliation !== "ALUMNI" &&
          user.graduatedAt == null
        ) {
          updates.graduatedAt = now;
        }
      }
    } else {
      console.warn(
        `dartmouth-refresh: people failed for userId=${userId}: ${peopleSettled.reason}`,
      );
    }

    if (Object.keys(updates).length > 0) {
      await prisma.user.update({ where: { id: userId }, data: updates });
    }
  } catch (err) {
    if (!swallow) throw err;
    console.warn(`dartmouth-refresh: unexpected error for userId=${userId}: ${err}`);
  }
}
