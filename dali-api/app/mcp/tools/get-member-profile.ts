// MCP `get_member_profile` — single-member drill-down. Returns identity,
// domain eligibility, current-term roles, and basic profile fields. Personal
// (non-Dartmouth) email is exposed ONLY when the caller is requesting their
// own profile. Requires the `mcp:read` scope.

import { prisma } from "~/lib/db";
import { currentTerm, isAdminViaEnv } from "~/lib/roles";

export const GET_MEMBER_PROFILE_TOOL = {
  name: "get_member_profile",
  description:
    "Get a single member's profile. personalEmail is included only when the caller asks for their own profile.",
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
      personalSite: true,
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

  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    daliEmail: user.daliEmail,
    netId: user.netId,
    dartmouthEmail: user.dartmouthEmail,
    // Privacy: personalEmail only returned to the user themselves.
    personalEmail: isSelf ? user.personalEmail : null,
    tier,
    domains: user.domainEligibilities.map((e) => ({
      id: e.domain.id,
      name: e.domain.displayName,
      eligibility: e.level,
    })),
    currentTermRoles,
    bioDocId: user.bioDocId,
    classYear: user.classYear,
    pronouns: user.pronouns,
    major: user.major,
    hometown: user.hometown,
    linkedinUrl: user.linkedinUrl,
    personalSite: user.personalSite,
    joinedAt: user.daliMember.createdAt.toISOString(),
  };
}
