import { prisma } from "~/lib/db.server";
import { notify } from "~/lib/notify.server";
import { opportunityReferralShippedKey } from "~/lib/outbound-keys.server";
import type { PartnerReferralTier } from "~/generated/prisma/enums";
import { referralStatus, type ReferralStatus } from "./referral-status";

export type MyReferral = {
  id: string;
  partnerName: string;
  partnerOrgName: string | null;
  tier: PartnerReferralTier;
  status: ReferralStatus;
  projectId: string | null;
  createdAt: string;
};

async function resultingProjects(applicationIds: string[]): Promise<Map<string, string | null>> {
  if (applicationIds.length === 0) return new Map();
  const apps = await prisma.partnerApplication.findMany({
    where: { id: { in: applicationIds } },
    select: { id: true, resultingProjectId: true },
  });
  return new Map(apps.map((a) => [a.id, a.resultingProjectId]));
}

export async function loadMyReferrals(userId: string): Promise<MyReferral[]> {
  const rows = await prisma.partnerReferral.findMany({
    where: { referredByUserId: userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      partnerName: true,
      partnerOrgName: true,
      tier: true,
      reachedOutAt: true,
      partnerApplicationId: true,
      createdAt: true,
    },
  });
  const projects = await resultingProjects(
    rows.flatMap((r) => (r.partnerApplicationId ? [r.partnerApplicationId] : [])),
  );
  return rows.map((r) => {
    const projectId = r.partnerApplicationId ? (projects.get(r.partnerApplicationId) ?? null) : null;
    return {
      id: r.id,
      partnerName: r.partnerName,
      partnerOrgName: r.partnerOrgName,
      tier: r.tier,
      status: referralStatus({
        reachedOutAt: r.reachedOutAt,
        partnerApplicationId: r.partnerApplicationId,
        resultingProjectId: projectId,
      }),
      projectId,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

async function postShipped(
  applicationId: string,
  projectId: string,
  only?: { referralId: string },
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true },
  });
  if (!project) return;
  const referrals = await prisma.partnerReferral.findMany({
    where: { partnerApplicationId: applicationId, ...(only ? { id: only.referralId } : {}) },
    select: {
      id: true,
      referredByUserId: true,
      partnerName: true,
      partnerOrgName: true,
      referredBy: { select: { firstName: true, lastName: true } },
    },
  });
  for (const r of referrals) {
    const referrer = `${r.referredBy.firstName} ${r.referredBy.lastName}`.trim();
    const partner = r.partnerOrgName || r.partnerName;
    const detail = `${partner} is now a DALI project: ${project.name}. It started with a referral from ${referrer}.`;
    try {
      await prisma.opportunityPost.create({
        data: {
          kind: "DaliUpdate",
          authorId: null,
          body: detail,
          partnerReferralId: r.id,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
    await notify({
      eventType: "opportunities.referral_shipped",
      message: {
        vars: { itemDetail: detail },
        link: "/community/opportunities",
        dedupKey: opportunityReferralShippedKey(r.id),
      },
      recipients: [{ userId: r.referredByUserId }],
    });
  }
}

export async function onApplicationBecameProject(
  applicationId: string,
  projectId: string,
): Promise<void> {
  try {
    await postShipped(applicationId, projectId);
  } catch (err) {
    console.error("[referral-status] could not post shipped referrals", applicationId, err);
  }
}

export async function linkReferralToApplication(
  referralId: string,
  partnerApplicationId: string | null,
  actorUserId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (partnerApplicationId) {
    const app = await prisma.partnerApplication.findUnique({
      where: { id: partnerApplicationId },
      select: { id: true, resultingProjectId: true },
    });
    if (!app) return { ok: false, error: "Application not found" };
    await prisma.partnerReferral.update({
      where: { id: referralId },
      data: { partnerApplicationId },
    });
    if (app.resultingProjectId) {
      try {
        await postShipped(app.id, app.resultingProjectId, { referralId });
      } catch (err) {
        console.error("[referral-status] could not post shipped referral", referralId, actorUserId, err);
      }
    }
    return { ok: true };
  }
  await prisma.partnerReferral.update({
    where: { id: referralId },
    data: { partnerApplicationId: null },
  });
  return { ok: true };
}

export type ApplicationOption = { id: string; title: string; orgName: string | null };

export async function listApplicationOptions(
  includeId: string | null,
): Promise<ApplicationOption[]> {
  const select = {
    id: true,
    title: true,
    partnerOrg: { select: { name: true } },
  } as const;
  const rows = await prisma.partnerApplication.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    select,
  });
  if (includeId && !rows.some((r) => r.id === includeId)) {
    const extra = await prisma.partnerApplication.findUnique({
      where: { id: includeId },
      select,
    });
    if (extra) rows.push(extra);
  }
  return rows.map((r) => ({ id: r.id, title: r.title, orgName: r.partnerOrg?.name ?? null }));
}
