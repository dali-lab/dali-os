import { prisma } from "~/lib/db";
import { currentTerm, getActiveCoreCycleTermIds } from "~/lib/roles";
import { coreCycleTermIds } from "~/lib/core-cycle";
import { commencementDate } from "~/lib/membership-status";
import { notifyAdminsOfPromotion } from "~/lib/promotion-notify.server";
import type { AcceptContext, AcceptResult } from "./internal-cycles.server";

// The single synthetic "CORE" domain backs Core cycles: every Core
// application, reviewer, and decision hangs off it so the domain-keyed
// review/delibs/decision pipeline works unchanged. Seeded by the
// core_hiring_cycle migration.
export async function getCoreDomain() {
  return prisma.domain.findFirst({ where: { code: "CORE", isSystem: true } });
}

// Core cycles are open to any current, active lab member.
export async function isCoreCycleEligible(userId: string): Promise<boolean> {
  const member = await prisma.user.findFirst({
    where: { id: userId, daliMember: { isNot: null }, membershipStatus: "Active" },
    select: { id: true },
  });
  return member != null;
}

// The Core cycle the accepted member joins is the one anchored at the current
// term (Spring → following Winter — see lib/core-cycle.ts). Empty when there's
// no current term.
export async function currentCoreCycleTermIds(): Promise<string[]> {
  const term = await currentTerm();
  if (!term) return [];
  return coreCycleTermIds(term.id);
}

// Default reviewer pool for a Core cycle: members currently on Core who are
// graduating within the next academic year (their commencement falls in the
// next ~12 months) and are still Active. Editable afterward — this is only the
// seed. Returns [] when there's no active Core cycle.
export async function defaultCoreReviewerIds(): Promise<string[]> {
  const termIds = await getActiveCoreCycleTermIds();
  if (termIds.length === 0) return [];

  const users = await prisma.user.findMany({
    where: {
      membershipStatus: "Active",
      classYear: { not: null },
      coreAssignments: { some: { termId: { in: termIds } } },
    },
    select: { id: true, classYear: true },
  });

  const now = new Date();
  const horizon = new Date(now);
  horizon.setFullYear(now.getFullYear() + 1);

  return users
    .filter((u) => {
      const c = commencementDate(u.classYear!);
      return c > now && c <= horizon;
    })
    .map((u) => u.id);
}

// Acceptance side-effect for Core cycles: materialize CoreAssignment rows for
// the accepted member across the current Core cycle (idempotent, mirrors
// admin.members.tsx add-core-title) and notify admins of the pay-affecting
// promotion. The member-facing "you're on Core" notification is delivered by
// the release route's in-app decision channel. Title choices on the shortform
// are cosmetic (they don't gate access), so the CoreAssignment carries no
// leadTitle.
export async function coreOnAccept(ctx: AcceptContext): Promise<AcceptResult> {
  const termIds = await currentCoreCycleTermIds();
  let created = 0;
  if (termIds.length > 0) {
    const existing = await prisma.coreAssignment.findMany({
      where: { userId: ctx.userId, termId: { in: termIds }, leadTitle: null },
      select: { termId: true },
    });
    const covered = new Set(existing.map((e) => e.termId));
    const missing = termIds.filter((t) => !covered.has(t));
    if (missing.length > 0) {
      await prisma.coreAssignment.createMany({
        data: missing.map((termId) => ({ userId: ctx.userId, termId, leadTitle: null })),
      });
      created = missing.length;
    }
  }

  await notifyAdminsOfPromotion({
    userId: ctx.userId,
    actorId: ctx.actorId,
    summary: "joined Core",
  }).catch((err) => console.error("[core-accept] admin notify failed:", err));

  return { auditMeta: { coreTermsCreated: created }, provision: null };
}
