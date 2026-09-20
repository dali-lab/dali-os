import { prisma } from "~/lib/db";
import type { CycleApplicants } from "~/generated/prisma/client";
import { APPLICANT_GROUP_CONFIG, DEFAULT_STAGES, defaultTimelineFor, isAdminOnlyCycle } from "./applicant-groups.server";
import { getCoreDomain } from "./core-hiring.server";

// Setting and changing who a cycle is for. Lab members cycles hang off one
// synthetic CORE domain with a seeded reviewer pool; the other groups use real
// domains, so switching into or out of Lab members swaps the domain setup.

/** Link the single CORE domain (ready: nothing per-domain to configure) and
 *  seed the reviewer pool with the group's defaults (editable afterward). */
export async function linkCoreDomain(cycleId: string, applicants: CycleApplicants): Promise<void> {
  const coreDomain = await getCoreDomain();
  if (!coreDomain) return;
  await prisma.domainApplicationCycle.upsert({
    where: { domainId_applicationCycleId: { domainId: coreDomain.id, applicationCycleId: cycleId } },
    update: { isReady: true },
    create: { domainId: coreDomain.id, applicationCycleId: cycleId, isReady: true },
  });
  const defaults = APPLICANT_GROUP_CONFIG[applicants].defaultReviewerIds;
  const reviewerIds = defaults ? await defaults() : [];
  if (reviewerIds.length > 0) {
    await prisma.cycleReviewer.createMany({
      data: reviewerIds.map((userId) => ({ userId, applicationCycleId: cycleId, domainId: coreDomain.id })),
      skipDuplicates: true,
    });
  }
}

export type ChangeApplicantsError = "not-draft" | "admin-only";

/**
 * Switch a Draft cycle to another applicant group. Stages and the timeline
 * reset to the new group's defaults (as if it had been created that way).
 * Moving into or out of Lab members replaces the domains, and the reviewers
 * and interviewers on them; a Draft cycle has no applications, so nothing
 * applicant-facing is lost.
 */
export async function changeApplicants(
  cycleId: string,
  next: CycleApplicants,
  isAdmin: boolean,
): Promise<ChangeApplicantsError | null> {
  const cycle = await prisma.applicationCycle.findUniqueOrThrow({
    where: { id: cycleId },
    select: {
      applicants: true,
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1, select: { newStatus: true } },
    },
  });
  if ((cycle.statusUpdates[0]?.newStatus ?? "Draft") !== "Draft") return "not-draft";
  if (cycle.applicants === next) return null;
  if (!isAdmin && (isAdminOnlyCycle(cycle.applicants) || isAdminOnlyCycle(next))) return "admin-only";

  const toCore = APPLICANT_GROUP_CONFIG[next].domainStrategy === "single-core-domain";
  const fromCore = APPLICANT_GROUP_CONFIG[cycle.applicants].domainStrategy === "single-core-domain";
  const coreDomain = toCore || fromCore ? await getCoreDomain() : null;

  await prisma.$transaction(async (tx) => {
    await tx.applicationCycle.update({
      where: { id: cycleId },
      data: { applicants: next, ...DEFAULT_STAGES[next], timeline: defaultTimelineFor(next) },
    });
    if (toCore !== fromCore && coreDomain) {
      // Into Lab members: drop the real domains. Out of it: drop CORE.
      const domainFilter = toCore ? { not: coreDomain.id } : coreDomain.id;
      const where = { applicationCycleId: cycleId, domainId: domainFilter };
      await tx.cycleReviewer.deleteMany({ where });
      await tx.cycleInterviewer.deleteMany({ where });
      await tx.domainApplicationCycle.deleteMany({ where });
    }
  });
  if (toCore && !fromCore) await linkCoreDomain(cycleId, next);
  return null;
}
