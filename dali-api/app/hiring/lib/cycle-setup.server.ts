import { prisma } from "~/lib/db";
import type { CycleApplicants } from "~/generated/prisma/client";
import { currentTerm } from "~/lib/roles";
import type { TermOption } from "~/lib/terms.shared";
import { APPLICATION_TZ, zonedDayEndUtc, zonedDayStartUtc } from "~/lib/timezone";
import { getCoreDomain, defaultCoreReviewerIds } from "./core-hiring.server";
import { inReviewPipelineFilter } from "./application-pipeline-filter";

// Setup-page data and intents specific to Interns and Lab members cycles. Those
// cycles run a single reviewer pool across all their domains instead of the
// per-domain roster Students cycles use, so they need their own loader shape
// and pool-keeping mutations. The shared setup page calls these only for
// member groups.

/**
 * Pool members are stored as one CycleReviewer row per (user, cycle, domain)
 * so the per-domain fan-out (auto-assign, review join keys) keeps working;
 * the UI shows each member once.
 */
export async function loadMemberCycleSetup(cycleId: string) {
  const [eligibleDomains, reviewerRows, members] = await Promise.all([
    // Interns convert into a real, non-intern domain.
    prisma.domain.findMany({
      where: { active: true, isInternProgram: false, isSystem: false },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true },
    }),
    prisma.cycleReviewer.findMany({
      where: { applicationCycleId: cycleId },
      include: { user: { select: { firstName: true, lastName: true, daliEmail: true } } },
    }),
    prisma.dALIMember.findMany({
      include: { user: { select: { firstName: true, lastName: true, daliEmail: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const displayName = (
    userId: string,
    u: { firstName: string | null; lastName: string | null; daliEmail: string | null },
  ) => [u.firstName, u.lastName].filter(Boolean).join(" ") || u.daliEmail || userId;

  return {
    eligibleDomains,
    reviewerPool: Array.from(
      new Map(
        reviewerRows.map((r) => [r.userId, { userId: r.userId, displayName: displayName(r.userId, r.user) }]),
      ).values(),
    ),
    members: members.map((m) => ({ userId: m.userId, displayName: displayName(m.userId, m.user) })),
  };
}

/**
 * Handle a member-cycle setup intent. Returns null when `intent` isn't one of
 * these, so the caller falls through to the shared intents.
 */
export async function handleMemberSetupIntent(
  intent: string,
  formData: FormData,
  cycleId: string,
  applicants: CycleApplicants,
): Promise<Response | { ok: true; resetCount?: number } | null> {
  if (intent === "set-target-domains") {
    const desired = JSON.parse((formData.get("domainIds") as string) || "[]") as string[];
    const existing = await prisma.domainApplicationCycle.findMany({
      where: { applicationCycleId: cycleId },
      select: { domainId: true },
    });
    const existingIds = new Set(existing.map((e) => e.domainId));
    const desiredSet = new Set(desired);
    const toAdd = desired.filter((id) => !existingIds.has(id));
    const toRemove = [...existingIds].filter((id) => !desiredSet.has(id));
    if (toRemove.length > 0) {
      // Removing a domain applicants already picked would orphan their
      // DomainApplications.
      const hasApps = await prisma.domainApplication.findFirst({
        where: { domainId: { in: toRemove }, application: { applicationCycleId: cycleId } },
        select: { id: true },
      });
      if (hasApps) {
        return Response.json(
          { error: "Can't remove a domain applicants already picked." },
          { status: 409 },
        );
      }
    }

    // Keep the pool invariant "every member is on every domain" as the domain
    // set changes.
    const poolUserIds = Array.from(
      new Set(
        (
          await prisma.cycleReviewer.findMany({
            where: { applicationCycleId: cycleId },
            select: { userId: true },
          })
        ).map((r) => r.userId),
      ),
    );
    await prisma.$transaction(async (tx) => {
      if (toRemove.length > 0) {
        await tx.cycleReviewer.deleteMany({
          where: { applicationCycleId: cycleId, domainId: { in: toRemove } },
        });
        await tx.domainApplicationCycle.deleteMany({
          where: { applicationCycleId: cycleId, domainId: { in: toRemove } },
        });
      }
      if (toAdd.length > 0) {
        await tx.domainApplicationCycle.createMany({
          data: toAdd.map((domainId) => ({ applicationCycleId: cycleId, domainId })),
        });
        if (poolUserIds.length > 0) {
          await tx.cycleReviewer.createMany({
            data: toAdd.flatMap((domainId) =>
              poolUserIds.map((userId) => ({ userId, applicationCycleId: cycleId, domainId })),
            ),
            skipDuplicates: true,
          });
        }
      }
    });
    return { ok: true };
  }

  if (intent === "add-reviewer-pool") {
    const userId = formData.get("userId") as string;
    const domains = await prisma.domainApplicationCycle.findMany({
      where: { applicationCycleId: cycleId },
      select: { domainId: true },
    });
    if (domains.length === 0) {
      return Response.json({ error: "Pick at least one domain first." }, { status: 409 });
    }
    await prisma.cycleReviewer.createMany({
      data: domains.map((d) => ({ userId, applicationCycleId: cycleId, domainId: d.domainId })),
      skipDuplicates: true,
    });
    return { ok: true };
  }

  if (intent === "remove-reviewer-pool") {
    const userId = formData.get("userId") as string;
    await prisma.cycleReviewer.deleteMany({ where: { userId, applicationCycleId: cycleId } });
    return { ok: true };
  }

  if (intent === "reset-default-reviewers") {
    // Lab members cycles default the pool to the graduating Core seniors.
    if (applicants !== "LabMembers") {
      return Response.json({ error: "Only Lab members cycles have default reviewers." }, { status: 400 });
    }
    const coreDomain = await getCoreDomain();
    if (!coreDomain) {
      return Response.json({ error: "Core domain is not configured." }, { status: 409 });
    }
    const reviewerIds = await defaultCoreReviewerIds();
    await prisma.$transaction(async (tx) => {
      await tx.cycleReviewer.deleteMany({ where: { applicationCycleId: cycleId } });
      if (reviewerIds.length > 0) {
        await tx.cycleReviewer.createMany({
          data: reviewerIds.map((userId) => ({ userId, applicationCycleId: cycleId, domainId: coreDomain.id })),
          skipDuplicates: true,
        });
      }
    });
    return { ok: true, resetCount: reviewerIds.length };
  }

  return null;
}

// Term dates (and the phase dates derived from them) are UTC-midnight stamps
// standing for calendar days. These anchor such a day in the application
// timezone, the same convention set-close-date and set-open-date use.
export function startOfDayInAppTz(day: Date): Date {
  return zonedDayStartUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), APPLICATION_TZ);
}
export function endOfDayInAppTz(day: Date): Date {
  return zonedDayEndUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), APPLICATION_TZ);
}

/** Every term, newest first, with the current one flagged for the picker. */
export async function loadTermOptions(request: Request): Promise<TermOption[]> {
  const [terms, current] = await Promise.all([
    prisma.term.findMany({ orderBy: { sortKey: "desc" }, select: { id: true, code: true } }),
    currentTerm(request),
  ]);
  return terms.map((t) => ({ ...t, isCurrent: t.id === current?.id }));
}

export type DomainPhaseStatus = {
  reviews: { assigned: number; submitted: number };
  /** Where each delib round's board stands, by round id. */
  rounds: Record<string, "active" | "closed">;
};

/** Per domain: review progress and where each delib round stands. Callers
 *  skip this while the cycle's confidentiality agreement is unsigned. */
export async function loadPhaseStatusByDomain(cycleId: string): Promise<Record<string, DomainPhaseStatus>> {
  const [reviews, sessions] = await Promise.all([
    prisma.applicationReview.findMany({
      where: {
        domainApplication: { application: { applicationCycleId: cycleId, ...inReviewPipelineFilter } },
      },
      select: { submittedAt: true, domainApplication: { select: { domainId: true } } },
    }),
    prisma.delibsSession.findMany({
      where: { applicationCycleId: cycleId },
      select: { domainId: true, roundId: true, status: true },
    }),
  ]);
  const byDomain: Record<string, DomainPhaseStatus> = {};
  const entry = (domainId: string) =>
    (byDomain[domainId] ??= { reviews: { assigned: 0, submitted: 0 }, rounds: {} });
  for (const r of reviews) {
    const e = entry(r.domainApplication.domainId);
    e.reviews.assigned += 1;
    if (r.submittedAt) e.reviews.submitted += 1;
  }
  for (const session of sessions) {
    entry(session.domainId).rounds[session.roundId] = session.status === "Closed" ? "closed" : "active";
  }
  return byDomain;
}
