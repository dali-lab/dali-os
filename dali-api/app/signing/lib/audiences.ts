// Single source of truth for "who is in a signing document's audience". Each
// SigningAudience maps to one resolver: `includes` answers the live gate (does
// this signer owe a signature?), `listMembers` enumerates the cohort for the
// admin roster, proactive notifications, and the issuance job. Adding a new
// audience type is one entry here plus (if needed) a SignerCohorts flag — no
// changes to the gate, roster, notifier, or fill flow.

import { prisma } from "~/lib/db";
import type { SigningAudience } from "~/generated/prisma/enums";
import { getNewMemberCohortIds } from "~/hiring/lib/new-member-cohort.server";
import type { SignerCohorts } from "./state.server";

export interface AudiencePerson {
  id: string;
  firstName: string;
  lastName: string;
}

export interface AudienceResolver {
  includes: (cohorts: SignerCohorts) => boolean;
  listMembers: (ctx: { termId?: string }) => Promise<AudiencePerson[]>;
  // Whether listMembers is a complete roster. False for audiences we can't
  // enumerate from here (Manual, HiringParticipants) — callers then show the
  // signed list only, with no "who hasn't signed" set.
  enumerable: boolean;
}

// Active lab members who are not full-time staff.
const activeMemberWhere = {
  user: {
    membershipStatus: "Active" as const,
    NOT: { adminMembership: { is: { isStaff: true } } },
  },
};

async function listActiveMembers(): Promise<AudiencePerson[]> {
  const members = await prisma.dALIMember.findMany({
    where: activeMemberWhere,
    select: { user: { select: { id: true, firstName: true, lastName: true } } },
  });
  return members.map((m) => m.user);
}

// Active members partitioned by the incoming-cohort set: "new" = accepted in the
// latest General/Fellowship cycle, "returning" = everyone else active.
async function listNewMembers(): Promise<AudiencePerson[]> {
  const [active, cohort] = await Promise.all([listActiveMembers(), getNewMemberCohortIds()]);
  return active.filter((p) => cohort.has(p.id));
}

async function listReturningMembers(): Promise<AudiencePerson[]> {
  const [active, cohort] = await Promise.all([listActiveMembers(), getNewMemberCohortIds()]);
  return active.filter((p) => !cohort.has(p.id));
}

// The set of users who mentor in the given term (P3 project OR domain lead OR
// core OR PM-eligible + any term role), excluding full-time staff. Bulk analog
// of isLabMentor.
async function listTermMentors(termId: string): Promise<AudiencePerson[]> {
  return prisma.user.findMany({
    where: {
      NOT: { adminMembership: { is: { isStaff: true } } },
      OR: [
        { projectAssignments: { some: { termId, level: "P3" } } },
        { domainLeadAssignmentsAsUser: { some: { termId } } },
        { coreAssignments: { some: { termId } } },
        {
          // PM mentor: monotonic P3 PM eligibility confirmed by any current-term role.
          AND: [
            { domainEligibilities: { some: { level: "P3", domain: { code: "PM" } } } },
            {
              OR: [
                { projectAssignments: { some: { termId } } },
                { coreAssignments: { some: { termId } } },
                { domainLeadAssignmentsAsUser: { some: { termId } } },
                { instructorAssignments: { some: { termId } } },
              ],
            },
          ],
        },
      ],
    },
    select: { id: true, firstName: true, lastName: true },
  });
}

export const AUDIENCE_RESOLVERS: Record<SigningAudience, AudienceResolver> = {
  NewMembers: {
    includes: (c) => c.isMember && c.isNewMember,
    listMembers: () => listNewMembers(),
    enumerable: true,
  },
  Members: {
    // Returning active members — everyone active who isn't in the new cohort.
    // Mentors are established members, so a mentor lands here (Members) AND in
    // Mentors, receiving both agreements.
    includes: (c) => c.isMember && !c.isNewMember,
    listMembers: () => listReturningMembers(),
    enumerable: true,
  },
  Mentors: {
    includes: (c) => c.isMentor,
    listMembers: ({ termId }) => (termId ? listTermMentors(termId) : Promise.resolve([])),
    enumerable: true,
  },
  // Manual is explicit-only; HiringParticipants is gated inside hiring, never
  // app-enforced or proactively notified from the general signing layer.
  Manual: {
    includes: () => false,
    listMembers: () => Promise.resolve([]),
    enumerable: false,
  },
  HiringParticipants: {
    includes: () => false,
    listMembers: () => Promise.resolve([]),
    enumerable: false,
  },
};
