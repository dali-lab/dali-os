// Server-only helpers for the Partner Bounty referral program.
// Member flow lives under /refer/*; Core triage under /core/partners/referrals.
// See referral-quiz.ts for the quiz content.

import { prisma } from "~/lib/db.server";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getUserRoles } from "~/lib/roles";
import type { PartnerReferralTier } from "~/generated/prisma/enums";
import { notifyPartners } from "./partner-notify.server";
import { REFERRAL_TIER_LABEL } from "./referral-quiz";

export async function requireReferralsEnabled(userId: string, request: Request): Promise<void> {
  const roles = await getUserRoles(userId, request);
  if (!(await isFeatureEnabled("refer-a-partner", userId, roles, request))) {
    throw new Response("Not found", { status: 404 });
  }
}

export async function hasPassedReferralQuiz(userId: string): Promise<boolean> {
  const row = await prisma.partnerReferralQuizPass.findUnique({
    where: { userId },
    select: { id: true },
  });
  return !!row;
}

// Record a pass. Called after the quiz action grades every answer correct.
// `attempts` is incremented when the member had a prior failed try in this
// session (the client posts a hint); the row itself is one-per-user.
export async function recordReferralQuizPass(opts: {
  userId: string;
  attempts: number;
}): Promise<void> {
  await prisma.partnerReferralQuizPass.upsert({
    where: { userId: opts.userId },
    create: {
      userId: opts.userId,
      attempts: Math.max(1, opts.attempts),
    },
    update: {},
  });
}

export type CreateReferralInput = {
  referredByUserId: string;
  tier: PartnerReferralTier;
  partnerName: string;
  partnerEmail?: string | null;
  partnerAffiliation?: string | null;
  partnerOrgName?: string | null;
  context: string;
  pitchBody?: string | null;
};

export async function createPartnerReferral(
  input: CreateReferralInput,
): Promise<{ id: string }> {
  const referral = await prisma.partnerReferral.create({
    data: {
      referredByUserId: input.referredByUserId,
      tier: input.tier,
      partnerName: input.partnerName.trim(),
      partnerEmail: input.partnerEmail?.trim() || null,
      partnerAffiliation: input.partnerAffiliation?.trim() || null,
      partnerOrgName: input.partnerOrgName?.trim() || null,
      context: input.context.trim(),
      // Pitch body only applies on the FullPitch tier; coerce others to null
      // even if the client somehow posted one.
      pitchBody:
        input.tier === "FullPitch" ? (input.pitchBody?.trim() || null) : null,
    },
    select: { id: true },
  });

  const referrer = await prisma.user.findUnique({
    where: { id: input.referredByUserId },
    select: { firstName: true, lastName: true },
  });
  const referrerName = referrer
    ? `${referrer.firstName} ${referrer.lastName}`.trim()
    : "A member";

  await notifyPartners({
    eventType: "partner.referral_received",
    title: `${REFERRAL_TIER_LABEL[input.tier]}: ${input.partnerName.trim()}`,
    body: `From ${referrerName}`,
    link: `/core/partners/referrals/${referral.id}`,
    createdByUserId: input.referredByUserId,
  });

  return referral;
}

export type ReferralListRow = {
  id: string;
  createdAt: string;
  tier: PartnerReferralTier;
  partnerName: string;
  partnerEmail: string | null;
  partnerOrgName: string | null;
  referrerName: string;
  reachedOutAt: string | null;
};

export async function listReferralsForCore(): Promise<ReferralListRow[]> {
  const rows = await prisma.partnerReferral.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      tier: true,
      partnerName: true,
      partnerEmail: true,
      partnerOrgName: true,
      reachedOutAt: true,
      referredBy: {
        select: { firstName: true, lastName: true },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    tier: r.tier,
    partnerName: r.partnerName,
    partnerEmail: r.partnerEmail,
    partnerOrgName: r.partnerOrgName,
    referrerName: `${r.referredBy.firstName} ${r.referredBy.lastName}`.trim(),
    reachedOutAt: r.reachedOutAt?.toISOString() ?? null,
  }));
}

export type ReferralDetail = {
  id: string;
  createdAt: string;
  tier: PartnerReferralTier;
  partnerName: string;
  partnerEmail: string | null;
  partnerAffiliation: string | null;
  partnerOrgName: string | null;
  context: string;
  pitchBody: string | null;
  coreNotes: string | null;
  reachedOutAt: string | null;
  referredBy: {
    id: string;
    firstName: string;
    lastName: string;
    daliEmail: string | null;
  };
  reachedOutBy: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
};

export async function getReferralForCore(
  id: string,
): Promise<ReferralDetail | null> {
  const row = await prisma.partnerReferral.findUnique({
    where: { id },
    include: {
      referredBy: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          daliEmail: true,
        },
      },
      reachedOutBy: {
        select: { id: true, firstName: true, lastName: true },
      },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    tier: row.tier,
    partnerName: row.partnerName,
    partnerEmail: row.partnerEmail,
    partnerAffiliation: row.partnerAffiliation,
    partnerOrgName: row.partnerOrgName,
    context: row.context,
    pitchBody: row.pitchBody,
    coreNotes: row.coreNotes,
    reachedOutAt: row.reachedOutAt?.toISOString() ?? null,
    referredBy: row.referredBy,
    reachedOutBy: row.reachedOutBy,
  };
}

export async function updateReferralCoreNotes(opts: {
  id: string;
  coreNotes: string | null;
}): Promise<void> {
  await prisma.partnerReferral.update({
    where: { id: opts.id },
    data: { coreNotes: opts.coreNotes },
  });
}

// Toggle the "we've reached out" marker. Stamping clears when `reached` is
// false so Core can undo a misclick; the actor id goes along for the audit.
export async function setReferralReachedOut(opts: {
  id: string;
  reached: boolean;
  actorUserId: string;
}): Promise<void> {
  await prisma.partnerReferral.update({
    where: { id: opts.id },
    data: {
      reachedOutAt: opts.reached ? new Date() : null,
      reachedOutByUserId: opts.reached ? opts.actorUserId : null,
    },
  });
}
