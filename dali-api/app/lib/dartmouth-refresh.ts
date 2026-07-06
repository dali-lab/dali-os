// Orchestrator: refresh a user's cached Dartmouth directory signals from
// api.dartmouth.edu/api/people, writing the results onto the User row.
//
// Lazy by default — callers pass `staleAfterDays` and we skip the network
// call when the cache is fresher than that. Login callbacks (CAS and Google)
// fire-and-forget this; the default staleness of 7 days keeps the
// enrolled-student override in roles.ts continuously fed for anyone active
// weekly, while costing at most one People call per user per week.
//
// Failure is non-fatal: we log and move on. Derivation in roles.ts simply
// falls through to classYear math when signals are absent or stale.

import { prisma } from "~/lib/db";
import { peopleByNetId } from "~/lib/dartmouth-people";

export type RefreshOptions = {
  // Skip the network call when the cache is this fresh. Default 7 days —
  // must stay comfortably under the trust window roles.ts applies to the
  // enrolled-student override (14 days) or the override goes dark between
  // syncs.
  staleAfterDays?: number;
  // When true, swallow errors and never throw — for fire-and-forget use
  // from login callbacks. Default true (background semantics).
  swallow?: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function refreshDartmouthSignals(
  userId: string,
  opts: RefreshOptions = {},
): Promise<void> {
  const staleAfterDays = opts.staleAfterDays ?? 7;
  const swallow = opts.swallow ?? true;
  const staleAfterMs = staleAfterDays * DAY_MS;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        netId: true,
        classYear: true,
        graduatedAt: true,
        dartmouthIsAlum: true,
        dartmouthAffiliation: true,
        dartmouthPeopleSyncedAt: true,
      },
    });

    if (!user || !user.netId) return;

    if (
      user.dartmouthPeopleSyncedAt &&
      Date.now() - user.dartmouthPeopleSyncedAt.getTime() < staleAfterMs
    ) {
      return;
    }

    const people = await peopleByNetId(user.netId);

    const now = new Date();
    const updates: Record<string, unknown> = {
      dartmouthPeopleSyncedAt: now,
    };

    // 404 (identity gone from the People API) keeps the last-known cached
    // signals — an account aging out of IDM says nothing about whether the
    // person graduated, and roles.ts already discounts stale data via the
    // synced-at timestamp.
    if (people) {
      updates.dartmouthAffiliation = people.dartmouthAffiliation;
      updates.dartmouthIsAlum = people.isAlum;
      updates.dartmouthIsStudent = people.isStudent;

      // Only populate classYear when we don't already have one — user input
      // (or the Notion import) wins. Never clobber. department_class is
      // class identity ("'25" for a +1 who walks in '26), which is exactly
      // what we display and what the derivation's Tier-4 fallback expects.
      if (people.classYear && user.classYear == null) {
        updates.classYear = people.classYear;
      }

      // First time we observe a graduation signal ("Alum" affiliation shows
      // up within weeks of conferral; the IDM ALUMNI flip trails by months)
      // and graduatedAt is unset, stamp it. Don't overwrite an existing
      // graduatedAt — off-cycle grads set theirs manually.
      const isAlumNow =
        people.isAlum || people.dartmouthAffiliation === "ALUMNI";
      const wasAlum =
        user.dartmouthIsAlum === true ||
        user.dartmouthAffiliation === "ALUMNI";
      if (isAlumNow && !wasAlum && user.graduatedAt == null) {
        updates.graduatedAt = now;
      }
    }

    await prisma.user.update({ where: { id: userId }, data: updates });
  } catch (err) {
    if (!swallow) throw err;
    console.warn(
      `dartmouth-refresh: failed for userId=${userId}: ${err}`,
    );
  }
}
