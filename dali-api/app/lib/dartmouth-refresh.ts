// Refresh a user's cached Dartmouth directory signals from
// api.dartmouth.edu/api/people, writing them onto the User row. These cache
// columns are INPUTS to membership-status recompute (see
// app/lib/membership-status.ts) — this module does not derive status itself,
// and (unlike the abandoned v1) it never stamps graduatedAt.
//
// Failure is non-fatal: callers use it fire-and-forget. When DARTMOUTH_API_KEY
// is unset the People client throws on the JWT exchange; we swallow and leave
// the last-known cache in place, so status recompute falls back to
// graduatedAt + classYear math.

import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/lib/db";
import { peopleByNetId } from "~/lib/dartmouth-people";

const DAY_MS = 24 * 60 * 60 * 1000;

export type RefreshOptions = {
  // Re-fetch even if the cache was refreshed recently. Term-rollover sweeps
  // and the daily ambiguous-set re-sync pass force; login relies on the
  // default throttle.
  force?: boolean;
  // Skip the network call when the cache is fresher than this. Default 1 day.
  // This is a politeness throttle against redundant API calls, NOT a
  // correctness window — status is stored, so a slightly stale cache never
  // affects a read.
  throttleMs?: number;
  // Swallow errors (default true — background/fire-and-forget semantics).
  swallow?: boolean;
};

// Returns true when the cache columns were (re)written, false when skipped
// (throttled / no netId) or on a swallowed failure.
export async function refreshDartmouthSignals(
  userId: string,
  opts: RefreshOptions = {},
): Promise<boolean> {
  const { force = false, throttleMs = DAY_MS, swallow = true } = opts;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { netId: true, classYear: true, dartmouthPeopleSyncedAt: true },
    });
    if (!user || !user.netId) return false;

    if (
      !force &&
      user.dartmouthPeopleSyncedAt &&
      Date.now() - user.dartmouthPeopleSyncedAt.getTime() < throttleMs
    ) {
      return false;
    }

    const people = await peopleByNetId(user.netId);
    const updates: Prisma.UserUpdateInput = {
      dartmouthPeopleSyncedAt: new Date(),
    };

    // 404 (identity gone from the People API) keeps the last-known cached
    // signals — an account aging out of IDM says nothing about graduation. We
    // still advance the synced-at stamp so throttling moves forward.
    if (people) {
      updates.dartmouthAffiliation = people.dartmouthAffiliation;
      updates.dartmouthIsAlum = people.isAlum;
      updates.dartmouthIsStudent = people.isStudent;
      updates.dartmouthDepartmentClass = people.departmentClass;

      // Populate classYear only when absent — user / Notion input wins and is
      // never clobbered. department_class is class identity ("'25" for a +1),
      // which is exactly what the status fallback and display expect.
      if (people.classYear != null && user.classYear == null) {
        updates.classYear = people.classYear;
      }
    }

    await prisma.user.update({ where: { id: userId }, data: updates });
    return true;
  } catch (err) {
    if (!swallow) throw err;
    console.warn(`dartmouth-refresh: failed for userId=${userId}: ${err}`);
    return false;
  }
}
