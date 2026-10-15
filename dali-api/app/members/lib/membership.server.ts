import { prisma } from "~/lib/db";
import { addOrUpdateEligibility } from "~/admin/lib/eligibility.server";
import type { Level } from "~/admin/lib/eligibility";
import { assignHandleIfMissing } from "~/lib/handle";

// Promote an existing User to a lab member (DALIMember marker row), optionally
// granting domain eligibility. Used by:
//   - the /members directory action (manual add/promote)
//   - the accepted-applicant release flow (auto-promote on Accepted)
//
// Idempotent: re-promoting an existing member is a no-op for membership, and
// the eligibility grant goes through addOrUpdateEligibility's upsert. A
// brand-new member's DALIMember starts with a null onboardedAt so the layout
// gate sends them through /onboarding; an already-onboarded member keeps theirs.
export async function promoteToMember(args: {
  userId: string;
  // When set, grant DomainEligibility at this level in this domain.
  domainId?: string;
  level?: Level;
  // Who triggered the promotion (stamped on the eligibility grant).
  actorId: string;
}): Promise<{ created: boolean }> {
  const existing = await prisma.dALIMember.findUnique({
    where: { userId: args.userId },
    select: { id: true },
  });
  if (!existing) {
    await prisma.dALIMember.create({ data: { userId: args.userId } });
  }

  if (args.domainId && args.level) {
    await addOrUpdateEligibility({
      userId: args.userId,
      domainId: args.domainId,
      level: args.level,
      actorId: args.actorId,
    });
  }

  return { created: !existing };
}

export const PROFILE_TEXT_FIELDS = [
  "pronouns",
  "major",
  "hometown",
  "linkedinUrl",
  "personalSite",
] as const;

export class MemberInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemberInputError";
  }
}

export type CreateMemberInput = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  dartmouthEmail?: string | null;
  classYear?: number | string | null;
} & { [K in (typeof PROFILE_TEXT_FIELDS)[number]]?: string | null };

// Create a lab member, or promote the User that already owns the email. The
// email is routed to its typed column by suffix so CAS/Google logins match later.
export async function createOrPromoteMember(
  input: CreateMemberInput,
  actorId: string,
): Promise<{ id: string; created: boolean }> {
  const firstName = input.firstName?.trim() ?? "";
  const lastName = input.lastName?.trim() ?? "";
  const email = input.email?.trim() ?? "";
  if (!firstName || !lastName) {
    throw new MemberInputError("First and last name are required.");
  }
  if (!email) {
    throw new MemberInputError("An email is required.");
  }

  const lower = email.toLowerCase();
  const emailField = lower.endsWith("@dali.dartmouth.edu")
    ? "daliEmail"
    : lower.endsWith("@dartmouth.edu")
      ? "dartmouthEmail"
      : "personalEmail";

  // The alias lets the member's @dartmouth address resolve to their one account
  // at login; when the primary already is the @dartmouth address there is
  // nothing extra to store.
  const dartmouthAlias = input.dartmouthEmail?.trim().toLowerCase() ?? "";
  if (dartmouthAlias && !dartmouthAlias.endsWith("@dartmouth.edu")) {
    throw new MemberInputError("The Dartmouth email must be an @dartmouth.edu address.");
  }
  const dartmouthEmailToSet =
    emailField === "dartmouthEmail" ? lower : dartmouthAlias || null;

  const profile: Record<string, string> = {};
  for (const field of PROFILE_TEXT_FIELDS) {
    const raw = input[field]?.trim() ?? "";
    if (raw !== "") profile[field] = raw;
  }
  let classYear: number | undefined;
  const classYearRaw =
    typeof input.classYear === "string" ? input.classYear.trim() : input.classYear;
  if (classYearRaw !== undefined && classYearRaw !== null && classYearRaw !== "") {
    const n = Number(classYearRaw);
    if (!Number.isInteger(n) || n < 1900 || n > 2100) {
      throw new MemberInputError("Class year must be a 4-digit year.");
    }
    classYear = n;
  }

  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ daliEmail: lower }, { dartmouthEmail: lower }, { personalEmail: lower }],
    },
    select: { id: true, dartmouthEmail: true, daliMember: { select: { id: true } } },
  });
  if (existing) {
    await promoteToMember({ userId: existing.id, actorId });
    if (dartmouthEmailToSet && !existing.dartmouthEmail) {
      const taken = await prisma.user.findFirst({
        where: { dartmouthEmail: dartmouthEmailToSet },
        select: { id: true },
      });
      if (taken && taken.id !== existing.id) {
        throw new MemberInputError("That Dartmouth email is already on another account.");
      }
      await prisma.user.update({
        where: { id: existing.id },
        data: { dartmouthEmail: dartmouthEmailToSet },
      });
    }
    return { id: existing.id, created: false };
  }

  const emailData: {
    daliEmail?: string;
    dartmouthEmail?: string;
    personalEmail?: string;
  } = { [emailField]: lower };
  if (dartmouthEmailToSet && emailField !== "dartmouthEmail") {
    const taken = await prisma.user.findFirst({
      where: { dartmouthEmail: dartmouthEmailToSet },
      select: { id: true },
    });
    if (taken) {
      throw new MemberInputError("That Dartmouth email is already on another account.");
    }
    emailData.dartmouthEmail = dartmouthEmailToSet;
  }
  const created = await prisma.user.create({
    data: {
      firstName,
      lastName,
      ...emailData,
      ...profile,
      classYear,
      daliMember: { create: {} },
    },
    select: { id: true },
  });
  await assignHandleIfMissing(created.id);
  return { id: created.id, created: true };
}
