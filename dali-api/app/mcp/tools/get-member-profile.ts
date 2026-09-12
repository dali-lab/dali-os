// MCP `get_member_profile` — single-member drill-down. Returns identity,
// domain eligibility, current-term roles, and profile fields. Gating:
//
//   Any authenticated member: all fields the web /members/:id shows publicly —
//     name, daliEmail, dartmouthEmail, pronouns, classYear, major, hometown,
//     linkedinUrl, githubUsername, personalSite, handle, photoUrl (resolved),
//     tier, domains, currentTermRoles, projectAssignments (current term),
//     achievements.
//
//   Self only: personalEmail, netId, phoneNumber, birthday, dietaryRestrictions,
//     timezone, bioDocId.
//
//   Self or Core/Admin: education profile (attended, taught, CE credits).
//
// Requires the `mcp:read` scope.

import { prisma } from "~/lib/db";
import { currentTerm, isAdminViaEnv, isCore } from "~/lib/roles";
import { resolvePhotoUrl } from "~/lib/photo";
import { achievementsForMember } from "~/members/lib/achievements.server";
import { getEducationProfile } from "~/education/lib/engagement.server";

export const GET_MEMBER_PROFILE_TOOL = {
  name: "get_member_profile",
  description:
    "Get a single member's profile. Publicly visible fields (name, email, domains, roles, projects, achievements) are " +
    "returned for any member. Private fields (personalEmail, netId, phone, birthday, dietary, timezone, bioDocId) are " +
    "returned only when looking up your own profile. Education profile (attended courses, taught, CE credits) is returned " +
    "for self or Core/Admin callers.",
  inputSchema: {
    type: "object" as const,
    properties: {
      memberId: {
        type: "string",
        minLength: 1,
        description: "The User.id of the member to look up.",
      },
    },
    required: ["memberId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { memberId: string };

export class MemberNotFoundError extends Error {
  constructor(memberId: string) {
    super(`No DALI member found with id ${memberId}`);
    this.name = "MemberNotFoundError";
  }
}

export async function runGetMemberProfile(callerId: string, input: Input) {
  const term = await currentTerm();
  const termId = term?.id ?? null;
  const isSelf = input.memberId === callerId;

  const user = await prisma.user.findUnique({
    where: { id: input.memberId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      daliEmail: true,
      dartmouthEmail: true,
      netId: true,
      personalEmail: true,
      classYear: true,
      bioDocId: true,
      pronouns: true,
      major: true,
      hometown: true,
      linkedinUrl: true,
      githubUsername: true,
      personalSite: true,
      handle: true,
      photoUrl: true,
      timeZone: true,
      phoneNumber: true,
      birthday: true,
      dietaryRestrictions: true,
      daliMember: { select: { id: true, createdAt: true } },
      adminMembership: { select: { id: true } },
      coreAssignments: termId
        ? { where: { termId }, select: { leadTitle: true, termId: true } }
        : { select: { leadTitle: true, termId: true } },
      domainLeadAssignmentsAsUser: termId
        ? {
            where: { termId },
            select: {
              termId: true,
              domain: { select: { id: true, displayName: true } },
            },
          }
        : {
            select: {
              termId: true,
              domain: { select: { id: true, displayName: true } },
            },
          },
      domainEligibilities: {
        select: {
          level: true,
          domain: { select: { id: true, displayName: true } },
        },
      },
      // Current-term project assignments — shown publicly on the web profile.
      projectAssignments: termId
        ? {
            where: { termId },
            select: {
              id: true,
              level: true,
              project: { select: { id: true, name: true, iconEmoji: true } },
              domain: { select: { name: true } },
            },
          }
        : {
            select: {
              id: true,
              level: true,
              project: { select: { id: true, name: true, iconEmoji: true } },
              domain: { select: { name: true } },
            },
          },
    },
  });

  if (!user || !user.daliMember) {
    throw new MemberNotFoundError(input.memberId);
  }

  const isAdminUser = user.adminMembership !== null || isAdminViaEnv(user.id);
  const isCoreUser = isAdminUser || user.coreAssignments.length > 0;
  const isDomainLeadUser = user.domainLeadAssignmentsAsUser.length > 0;
  const tier: "admin" | "core" | "domain-lead" | "member" = isAdminUser
    ? "admin"
    : isCoreUser
      ? "core"
      : isDomainLeadUser
        ? "domain-lead"
        : "member";

  const currentTermRoles: Array<{
    roleType: "Core" | "DomainLead" | "Admin";
    scopeName?: string;
    termCode?: string;
  }> = [];

  if (isAdminUser) {
    currentTermRoles.push({ roleType: "Admin" });
  }
  for (const c of user.coreAssignments) {
    currentTermRoles.push({
      roleType: "Core",
      scopeName: c.leadTitle ?? undefined,
      termCode: term?.code,
    });
  }
  for (const dl of user.domainLeadAssignmentsAsUser) {
    currentTermRoles.push({
      roleType: "DomainLead",
      scopeName: dl.domain.displayName,
      termCode: term?.code,
    });
  }

  // Education profile: self or Core/Admin caller.
  const callerIsCore = isSelf || (await isCore(callerId));
  const [photoUrlResolved, achievements, education] = await Promise.all([
    resolvePhotoUrl(user.photoUrl),
    achievementsForMember(input.memberId),
    callerIsCore ? getEducationProfile(input.memberId) : Promise.resolve(null),
  ]);

  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    daliEmail: user.daliEmail,
    dartmouthEmail: user.dartmouthEmail,
    pronouns: user.pronouns,
    classYear: user.classYear,
    major: user.major,
    hometown: user.hometown,
    linkedinUrl: user.linkedinUrl,
    githubUsername: user.githubUsername,
    personalSite: user.personalSite,
    handle: user.handle,
    photoUrl: photoUrlResolved,
    tier,
    domains: user.domainEligibilities.map((e) => ({
      id: e.domain.id,
      name: e.domain.displayName,
      eligibility: e.level,
    })),
    currentTermRoles,
    projectAssignments: user.projectAssignments.map((a) => ({
      id: a.id,
      level: a.level,
      project: a.project,
      domain: { name: a.domain.name },
    })),
    achievements: achievements.map((a) => ({
      key: a.key,
      title: a.title,
      description: a.description,
      earned: a.earned,
    })),
    joinedAt: user.daliMember.createdAt.toISOString(),
    // ── Self-only private fields ───────────────────────────────────────────
    netId: isSelf ? user.netId : null,
    personalEmail: isSelf ? user.personalEmail : null,
    phoneNumber: isSelf ? user.phoneNumber : null,
    birthday: isSelf
      ? user.birthday
        ? user.birthday instanceof Date
          ? user.birthday.toISOString()
          : user.birthday
        : null
      : null,
    dietaryRestrictions: isSelf ? user.dietaryRestrictions : null,
    timezone: isSelf ? user.timeZone : null,
    bioDocId: isSelf ? user.bioDocId : null,
    // ── Self or Core/Admin ─────────────────────────────────────────────────
    education: education
      ? {
          attended: education.attended.map((o) => ({
            offeringId: o.offeringId,
            title: o.title,
            type: o.type,
            startsAt: o.startsAt ? o.startsAt.toISOString() : null,
            endsAt: o.endsAt ? o.endsAt.toISOString() : null,
            status: o.status,
            attendance: o.attendance,
            certificateIssuedAt: o.certificateIssuedAt
              ? o.certificateIssuedAt.toISOString()
              : null,
          })),
          taught: education.taught,
          ceCredits: education.ceCredits,
        }
      : null,
  };
}
