import { randomBytes } from "node:crypto";
import { prisma } from "~/lib/db";
import type { Prisma, PartnerReferralType } from "~/generated/prisma/client";

/** Unguessable warm-ref token embedded in /partner/apply?ref=<token>. */
function newReferralToken(): string {
  return randomBytes(24).toString("base64url");
}

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

/** Normalize whitespace-only strings to null so empty inputs don't persist as "". */
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
 * Shape-level validation of a referral submission. Returns an error message
 * when the chosen type is missing fields it semantically requires:
 *   - ColdLead / WarmLead need at least a name OR an email.
 *   - FundedPitch needs a pitch title.
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

export async function createReferral(input: CreateReferralInput) {
  const data: Prisma.PartnerReferralCreateInput = {
    referrer: { connect: { id: input.referrerUserId } },
    type: input.type,
    rawName: trimOrNull(input.rawName),
    rawEmail: normalizeEmail(input.rawEmail),
    rawOrg: trimOrNull(input.rawOrg),
    rawPhone: trimOrNull(input.rawPhone),
    rawLinkedinUrl: trimOrNull(input.rawLinkedinUrl),
    pitchTitle: trimOrNull(input.pitchTitle),
    pitchSummary: trimOrNull(input.pitchSummary),
    notes: trimOrNull(input.notes),
    token: input.type === "WarmLead" ? newReferralToken() : null,
  };
  return prisma.partnerReferral.create({
    data,
    select: { id: true, token: true, type: true },
  });
}

/**
 * Resolve a warm-ref token to the referral it points at. Returns null when
 * the token doesn't match a known referral, when the referral isn't WarmLead,
 * or when a resulting application has already been linked (one warm referral
 * attaches at most one application).
 */
export async function resolveReferralToken(token: string) {
  if (!token) return null;
  const row = await prisma.partnerReferral.findUnique({
    where: { token },
    select: {
      id: true,
      type: true,
      referrerUserId: true,
      application: { select: { id: true } },
    },
  });
  if (!row) return null;
  if (row.type !== "WarmLead") return null;
  if (row.application) return null;
  return {
    id: row.id,
    referrerUserId: row.referrerUserId,
  };
}

/** Build the member-facing URL used when sharing a warm-ref link. */
export function warmReferralLink(request: Request, token: string): string {
  const url = new URL(request.url);
  return `${url.origin}/partner/apply?ref=${token}`;
}
