// Authoritative lab-membership status — stored on User.membershipStatus and
// recomputed only at transitions (term rollover, login, mutation), never
// derived per request. See alumni_status_plan.md.
//
// The resolver reads NO engagement tables (ProjectAssignment, ExternalMentor,
// StaffingMentorRole, …): status is a fact about the person's enrollment /
// graduation, not their current assignments. An alumnus who mentors a project
// is still Alumni, and the algorithm is immune to churn in the staffing schema.

import type { MembershipStatus } from "~/generated/prisma/client";
import { prisma } from "~/lib/db";
import {
  refreshDartmouthSignals,
  type RefreshOptions,
} from "~/lib/dartmouth-refresh";

// Dartmouth Commencement is mid-June. June 15 is the conservative cutoff for
// treating a classYear as graduated in the no-API fallback path.
export function commencementDate(classYear: number): Date {
  return new Date(classYear, 5, 15); // month is 0-indexed; 5 = June
}

export type StatusInputs = {
  membershipStatusOverride: MembershipStatus | null;
  graduatedAt: Date | null;
  classYear: number | null;
  dartmouthIsAlum: boolean | null;
  dartmouthIsStudent: boolean | null;
  dartmouthAffiliation: string | null;
};

/**
 * Pure resolver: map a member's inputs to their status. Ordered so the
 * strongest, most authoritative signal wins.
 *
 *   override            → the manual pin (BE dual-degree, staff, corrections)
 *   Alum / IDM ALUMNI   → Alumni  (degree conferred)
 *   graduatedAt < now   → Alumni  (off-cycle / manual)
 *   Student (¬Alum)     → Active  (+1 guard: genuinely enrolled, beats classYear)
 *   classYear past      → Alumni  (no-API fallback)
 *   else                → Active
 */
export function resolveMembershipStatus(
  u: StatusInputs,
  now: Date,
): MembershipStatus {
  if (u.membershipStatusOverride != null) return u.membershipStatusOverride;

  if (u.dartmouthIsAlum === true || u.dartmouthAffiliation === "ALUMNI") {
    return "Alumni";
  }

  if (u.graduatedAt != null && u.graduatedAt < now) return "Alumni";

  // "Student" present without "Alum" is the only reliable currently-enrolled
  // signal. It beats the classYear fallback below — the +1 guard for a member
  // whose class has lapsed but who is genuinely still enrolled.
  if (u.dartmouthIsStudent === true) return "Active";

  if (u.classYear != null && commencementDate(u.classYear) <= now) {
    return "Alumni";
  }

  return "Active";
}

/**
 * Recompute and persist a member's stored membershipStatus from its current
 * inputs. Member-only: non-members keep the inert Active default. Writes only
 * when the value changes (or on the first stamp) so the daily sweep stays
 * cheap. Returns the resolved status, or null for a non-member / missing user.
 */
export async function recomputeMembershipStatus(
  userId: string,
): Promise<MembershipStatus | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      membershipStatus: true,
      membershipStatusComputedAt: true,
      membershipStatusOverride: true,
      graduatedAt: true,
      classYear: true,
      dartmouthIsAlum: true,
      dartmouthIsStudent: true,
      dartmouthAffiliation: true,
      daliMember: { select: { id: true } },
    },
  });
  if (!user || !user.daliMember) return null;

  const status = resolveMembershipStatus(user, new Date());

  if (
    status !== user.membershipStatus ||
    user.membershipStatusComputedAt == null
  ) {
    await prisma.user.update({
      where: { id: userId },
      data: { membershipStatus: status, membershipStatusComputedAt: new Date() },
    });
  }
  return status;
}

/**
 * Refresh Dartmouth signals, then recompute — the unit used by login callbacks
 * (throttled) and the term-rollover / ambiguous-set sweeps (force). Swallows
 * its own failures so it is safe to `void` fire-and-forget and so one user's
 * error never aborts a sweep batch.
 */
export async function syncAndRecomputeMembershipStatus(
  userId: string,
  opts: RefreshOptions = {},
): Promise<void> {
  try {
    await refreshDartmouthSignals(userId, opts);
    await recomputeMembershipStatus(userId);
  } catch (err) {
    console.warn(`membership-status: sync failed for userId=${userId}: ${err}`);
  }
}
