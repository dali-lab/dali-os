import { prisma } from "~/lib/db";
import type { Prisma, PartnerReferralType } from "~/generated/prisma/client";

export type CreateReferralInput = {
  referrerUserId: string;
  type: PartnerReferralType;
  rawName?: string | null;
  rawEmail?: string | null;
  rawOrg?: string | null;
  rawPhone?: string | null;
  rawLinkedinUrl?: string | null;
  pitchTitle?: string | null;
  pitchSummary?: string | null;
  notes?: string | null;
};

function trimOrNull(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

function normalizeEmail(v: string | null | undefined): string | null {
  const t = trimOrNull(v);
  return t ? t.toLowerCase() : null;
}

/**
 * Shape-level validation of a referral submission:
 *   - ColdLead / WarmLead need at least a name OR an email.
 *   - FundedPitch needs a pitch title.
 * Email isn't required (members may know only a name), but email is what
 * enables auto-attribution later — the member UI calls that out.
 */
export function validateReferral(input: CreateReferralInput): string | null {
  const name = trimOrNull(input.rawName);
  const email = trimOrNull(input.rawEmail);
  const pitchTitle = trimOrNull(input.pitchTitle);
  if (input.type === "FundedPitch") {
    if (!pitchTitle) return "A pitch needs a title.";
    if (!name && !email) {
      return "Tell us which partner you pitched (name or email).";
    }
    return null;
  }
  if (!name && !email) {
    return "Add at least a name or an email so we can reach them.";
  }
  return null;
}

/**
 * Upsert a PartnerContact for an email. Email is the natural key on the
 * contact table (@unique), so upsert is race-safe. The returned contact is
 * what we attach the referral to; later, when the partner authenticates with
 * the same email, findOrLinkPartnerContact links their new User to this same
 * row and auto-attribution falls out for free.
 */
async function upsertContactByEmail(
  tx: Prisma.TransactionClient,
  email: string,
  name: string | null,
) {
  return tx.partnerContact.upsert({
    where: { email },
    create: { email, name: name ?? email },
    update: {},
    select: { id: true },
  });
}

export async function createReferral(input: CreateReferralInput) {
  const email = normalizeEmail(input.rawEmail);
  const name = trimOrNull(input.rawName);
  return prisma.$transaction(async (tx) => {
    const contact = email ? await upsertContactByEmail(tx, email, name) : null;
    const data: Prisma.PartnerReferralCreateInput = {
      referrer: { connect: { id: input.referrerUserId } },
      type: input.type,
      rawName: name,
      rawEmail: email,
      rawOrg: trimOrNull(input.rawOrg),
      rawPhone: trimOrNull(input.rawPhone),
      rawLinkedinUrl: trimOrNull(input.rawLinkedinUrl),
      pitchTitle: trimOrNull(input.pitchTitle),
      pitchSummary: trimOrNull(input.pitchSummary),
      notes: trimOrNull(input.notes),
      ...(contact ? { partnerContact: { connect: { id: contact.id } } } : {}),
    };
    return tx.partnerReferral.create({
      data,
      select: { id: true, type: true, partnerContactId: true },
    });
  });
}

/**
 * Find the oldest pending (unresolved, not already linked to an application)
 * referral attached to a given PartnerContact. Used by partner.apply to
 * auto-attribute an incoming application to the member who referred it.
 * Returns null when there's nothing to attribute.
 */
export async function findPendingReferralForContact(
  tx: Prisma.TransactionClient,
  partnerContactId: string,
) {
  return tx.partnerReferral.findFirst({
    where: {
      partnerContactId,
      resolvedAt: null,
      application: null,
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, referrerUserId: true },
  });
}
