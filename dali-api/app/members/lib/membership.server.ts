import { prisma } from "~/lib/db.server";
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
  daliEmail?: string | null;
  dartmouthEmail?: string | null;
  personalEmail?: string | null;
  netId?: string | null;
  githubUsername?: string | null;
  phoneNumber?: string | null;
  birthday?: string | null;
  dietaryRestrictions?: string | null;
  classYear?: number | string | null;
} & { [K in (typeof PROFILE_TEXT_FIELDS)[number]]?: string | null };

const IDENTITY_COLUMNS = ["daliEmail", "dartmouthEmail", "personalEmail", "netId"] as const;
type IdentityColumn = (typeof IDENTITY_COLUMNS)[number];
const EMAIL_COLUMNS = ["daliEmail", "dartmouthEmail", "personalEmail"] as const;
const IDENTITY_LABELS: Record<IdentityColumn, string> = {
  daliEmail: "DALI email",
  dartmouthEmail: "Dartmouth email",
  personalEmail: "personal email",
  netId: "NetID",
};
const FREE_TEXT_COLUMNS = ["githubUsername", "phoneNumber", "dietaryRestrictions"] as const;

function parseBirthday(raw: string): Date {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00.000Z`) : null;
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
    throw new MemberInputError("Birthday must be YYYY-MM-DD.");
  }
  return date;
}

// Create a lab member, or promote the User that already owns any of the given
// identities. `email` is routed to its typed column by suffix so CAS/Google
// logins match later; explicit identity fields override that routing. An
// existing User only has blanks filled, never overwritten.
export async function createOrPromoteMember(
  input: CreateMemberInput,
  actorId: string,
  options: { allowMissingEmail?: boolean } = {},
): Promise<{ id: string; created: boolean }> {
  const firstName = input.firstName?.trim() ?? "";
  const lastName = input.lastName?.trim() ?? "";
  const lowered = (v?: string | null) => v?.trim().toLowerCase() ?? "";
  const email = lowered(input.email);
  if (!firstName || !lastName) {
    throw new MemberInputError("First and last name are required.");
  }

  const identity: Partial<Record<IdentityColumn, string>> = {};
  if (email) {
    identity[
      email.endsWith("@dali.dartmouth.edu")
        ? "daliEmail"
        : email.endsWith("@dartmouth.edu")
          ? "dartmouthEmail"
          : "personalEmail"
    ] = email;
  }
  for (const column of IDENTITY_COLUMNS) {
    const value = lowered(input[column]);
    if (value) identity[column] = value;
  }
  const hasEmail = EMAIL_COLUMNS.some((c) => identity[c]);
  if (!hasEmail && !(options.allowMissingEmail && identity.netId)) {
    throw new MemberInputError("An email is required.");
  }
  if (identity.daliEmail && !identity.daliEmail.endsWith("@dali.dartmouth.edu")) {
    throw new MemberInputError("The DALI email must be an @dali.dartmouth.edu address.");
  }
  if (identity.dartmouthEmail && !identity.dartmouthEmail.endsWith("@dartmouth.edu")) {
    throw new MemberInputError("The Dartmouth email must be an @dartmouth.edu address.");
  }

  const birthdayRaw = input.birthday?.trim() ?? "";
  const birthday = birthdayRaw ? parseBirthday(birthdayRaw) : undefined;

  const profile: Record<string, string> = {};
  for (const field of [...PROFILE_TEXT_FIELDS, ...FREE_TEXT_COLUMNS]) {
    const raw = input[field]?.trim() ?? "";
    if (raw !== "") profile[field] = raw;
  }
  const identityEntries = IDENTITY_COLUMNS.flatMap((c) =>
    identity[c] ? [[c, identity[c] as string] as const] : [],
  );
  const assertFree = async (column: IdentityColumn, value: string, selfId?: string) => {
    const taken = await prisma.user.findFirst({ where: { [column]: value }, select: { id: true } });
    if (taken && taken.id !== selfId) {
      throw new MemberInputError(`That ${IDENTITY_LABELS[column]} is already on another account.`);
    }
  };

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

  const emailValues = EMAIL_COLUMNS.flatMap((c) => (identity[c] ? [identity[c] as string] : []));
  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        ...emailValues.flatMap((value) => EMAIL_COLUMNS.map((c) => ({ [c]: value }))),
        ...(identity.netId ? [{ netId: identity.netId }] : []),
      ],
    },
    select: {
      id: true,
      daliEmail: true,
      dartmouthEmail: true,
      personalEmail: true,
      netId: true,
      classYear: true,
      githubUsername: true,
      phoneNumber: true,
      birthday: true,
      dietaryRestrictions: true,
      pronouns: true,
      major: true,
      hometown: true,
      linkedinUrl: true,
      personalSite: true,
      daliMember: { select: { id: true } },
    },
  });
  if (existing) {
    await promoteToMember({ userId: existing.id, actorId });
    const held = new Set(EMAIL_COLUMNS.map((c) => existing[c]).filter(Boolean));
    const fill: Record<string, string | number | Date> = {};
    for (const [column, value] of identityEntries) {
      if (existing[column] != null) continue;
      if (column !== "netId" && held.has(value)) continue;
      await assertFree(column, value, existing.id);
      fill[column] = value;
    }
    for (const [field, value] of Object.entries(profile)) {
      if ((existing as Record<string, unknown>)[field] == null) fill[field] = value;
    }
    if (classYear !== undefined && existing.classYear == null) fill.classYear = classYear;
    if (birthday && existing.birthday == null) fill.birthday = birthday;
    if (Object.keys(fill).length > 0) {
      await prisma.user.update({ where: { id: existing.id }, data: fill });
    }
    return { id: existing.id, created: false };
  }

  for (const [column, value] of identityEntries) await assertFree(column, value);
  const created = await prisma.user.create({
    data: {
      firstName,
      lastName,
      ...identity,
      ...profile,
      classYear,
      birthday,
      daliMember: { create: {} },
    },
    select: { id: true },
  });
  await assignHandleIfMissing(created.id);
  return { id: created.id, created: true };
}
