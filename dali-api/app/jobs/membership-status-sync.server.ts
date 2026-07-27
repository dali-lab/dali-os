// Membership-status sync job. Keeps User.membershipStatus current without any
// per-request derivation. Three phases per run (see alumni_status_plan.md):
//
//   A. Term-rollover sweep — force-refresh Dartmouth signals for active members
//      whose cache predates the current term, then recompute. Rollover is
//      detected from the data (synced-at < term.startDate), so no extra state
//      is stored: at a new term everyone qualifies; once swept they drop out
//      until the next term. Logins that refreshed this term are skipped.
//   B. Ambiguous re-sync — the small set that looks still-enrolled but whose
//      class has graduated (Active + Student + ¬Alum + classYear lapsed).
//      Re-pulled every run until "Alum" posts: a grace-period grad flips to
//      Alumni the day it lands, a genuine +1 keeps showing Student and stays
//      Active. No timeout, no guess.
//   B2. Grad-program backfill — an enrolled grad/professional student cached as
//      Alumni whose department_class has never been cached (Alumni + Student +
//      null department_class). Introduced when the department_class column was
//      added: term-fresh rows are skipped by A and excluded by B (they ARE
//      Alum), so without this they never pick up the program-code signal that
//      flips them to Active. Self-limiting — once department_class caches they
//      no longer match. Also catches a future alum who returns for grad school.
//   C. DB-only recompute — recompute every member from already-cached signals,
//      applying the formula as the clock advances (classYear / graduatedAt
//      crossings) with no API cost. Also backfills status on first run.
//
// Idempotent + bounded: writes only when a status changes, the API phases are
// capped per run, per-user sync failures are swallowed, and force-sync of an
// already-fresh row is harmless.

import { prisma } from "~/lib/db";
import type { JobContext, JobResult } from "~/jobs/registry";
import { currentTerm } from "~/lib/roles";
import {
  resolveMembershipStatus,
  commencementDate,
  syncAndRecomputeMembershipStatus,
} from "~/lib/membership-status";

// The classYear whose Commencement has passed as of `now` — a member at or
// below this class has graduated (used to scope the ambiguous set).
function graduatedCohortCutoff(now: Date): number {
  const y = now.getFullYear();
  const postCommencement =
    now.getMonth() > 5 || (now.getMonth() === 5 && now.getDate() >= 15);
  return postCommencement ? y : y - 1;
}

export async function runMembershipStatusSync({
  now,
  settings,
}: JobContext): Promise<JobResult> {
  const maxApiPerRun = settings.maxApiPerRun ?? 200;

  let synced = 0;

  // ── Phases A + B: API refresh for members that need it ──────────────────
  // refreshDartmouthSignals swallows its own errors, so a transient API outage
  // (or a missing key) degrades to Phase C's recompute per user rather than
  // failing the run.
  const term = await currentTerm();
  const cutoff = graduatedCohortCutoff(now);

  const candidates = await prisma.user.findMany({
    where: {
      daliMember: { isNot: null },
      netId: { not: null },
      OR: [
        // A: never synced, or not synced since this term started.
        { dartmouthPeopleSyncedAt: null },
        ...(term ? [{ dartmouthPeopleSyncedAt: { lt: term.startDate } }] : []),
        // B: ambiguous — looks still-enrolled but class has graduated.
        {
          membershipStatus: "Active" as const,
          dartmouthIsStudent: true,
          NOT: { dartmouthIsAlum: true },
          classYear: { lte: cutoff },
        },
        // B2: enrolled grad student cached as Alumni with no department_class
        // yet — re-pull so the program-code signal lands and they flip to
        // Active. Self-limiting once department_class caches.
        {
          membershipStatus: "Alumni" as const,
          dartmouthIsStudent: true,
          dartmouthDepartmentClass: null,
        },
      ],
    },
    select: { id: true },
    take: maxApiPerRun,
  });

  for (const u of candidates) {
    await syncAndRecomputeMembershipStatus(u.id, { force: true });
    synced++;
  }

  // ── Phase C: DB-only recompute of every member (catches time crossings,
  // reconciles, and backfills on first run) ───────────────────────────────
  const members = await prisma.user.findMany({
    where: { daliMember: { isNot: null } },
    select: {
      id: true,
      membershipStatus: true,
      membershipStatusComputedAt: true,
      membershipStatusOverride: true,
      graduatedAt: true,
      classYear: true,
      dartmouthIsAlum: true,
      dartmouthIsStudent: true,
      dartmouthAffiliation: true,
      dartmouthDepartmentClass: true,
    },
  });

  let recomputed = 0;
  for (const m of members) {
    const status = resolveMembershipStatus(m, now);
    if (status !== m.membershipStatus || m.membershipStatusComputedAt == null) {
      await prisma.user.update({
        where: { id: m.id },
        data: { membershipStatus: status, membershipStatusComputedAt: now },
      });
      recomputed++;
    }
  }

  const parts: string[] = [];
  if (synced > 0) parts.push(`${synced} refreshed`);
  if (recomputed > 0) parts.push(`${recomputed} status change(s)`);

  return {
    items: recomputed,
    note: parts.length > 0 ? parts.join("; ") : undefined,
  };
}
