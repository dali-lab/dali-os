// Single source of truth for "who is in a signing document's audience". Each
// SigningAudience maps to one resolver: `includes` answers the live gate (does
// this signer owe a signature?), `listMembers` enumerates the cohort for the
// admin roster, proactive notifications, and the issuance job. Adding a new
// audience type is one entry here plus (if needed) a SignerCohorts flag — no
// changes to the gate, roster, notifier, or fill flow.

import { prisma } from "~/lib/db";
import type { SigningAudience } from "~/generated/prisma/enums";
import { resolveGroupMembers, resolveDynamicQuery } from "~/lib/groups";
import { currentTerm } from "~/lib/roles";
import { partitionStaffedMembers, listStaffedMentors } from "./staffing-audience.server";
import type { SignerCohorts } from "./state.server";

export interface AudiencePerson {
  id: string;
  firstName: string;
  lastName: string;
}

// Per-document facts the gate needs beyond the signer's cohorts. Only the Group
// audience reads them (the document's target group + the groups this signer is
// in); every other resolver ignores ctx.
export interface AudienceContext {
  audienceGroupId?: string | null;
  // Fixed (non-term) group ids this signer belongs to, precomputed once by the
  // gate so includes() stays synchronous.
  userGroupIds?: Set<string>;
}

// The group + term facts listMembers needs. termId scopes term-derived
// audiences (NewMembers/Members/Mentors, and a Group audience with no fixed
// group). audienceGroupId targets a specific group.
export interface AudienceListContext {
  termId?: string;
  audienceGroupId?: string | null;
}

export interface AudienceResolver {
  includes: (cohorts: SignerCohorts, ctx?: AudienceContext) => boolean;
  listMembers: (ctx: AudienceListContext) => Promise<AudiencePerson[]>;
  // Whether listMembers is a complete roster. False for audiences we can't
  // enumerate from here (Manual, HiringParticipants) — callers then show the
  // signed list only, with no "who hasn't signed" set.
  enumerable: boolean;
}

// Hydrate a set of userIds (from group resolution) into AudiencePerson rows,
// dropping full-time staff — they're exempt from signing (see getSignerCohorts),
// so they must not appear in a group audience's roster or notifications either.
async function hydratePeople(userIds: string[]): Promise<AudiencePerson[]> {
  if (userIds.length === 0) return [];
  return prisma.user.findMany({
    where: {
      id: { in: userIds },
      NOT: { adminMembership: { is: { isStaff: true } } },
    },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

// The people in a Group audience. A fixed audienceGroupId resolves to that
// group; a null id means "the binding's term group" (resolved against termId,
// falling back to the current term) so per-term agreements auto-roll each term.
async function listGroupMembers(ctx: AudienceListContext): Promise<AudiencePerson[]> {
  if (ctx.audienceGroupId) {
    return hydratePeople(await resolveGroupMembers(ctx.audienceGroupId));
  }
  const termId = ctx.termId ?? (await currentTerm())?.id;
  if (!termId) return [];
  return hydratePeople(await resolveDynamicQuery(`term:${termId}`));
}

// Term for the enumerating call. Term-derived audiences use the binding's term,
// falling back to the current term (mirrors listGroupMembers).
async function resolveTermId(ctx: AudienceListContext): Promise<string | undefined> {
  return ctx.termId ?? (await currentTerm())?.id;
}

export const AUDIENCE_RESOLVERS: Record<SigningAudience, AudienceResolver> = {
  // First-term members: staffed this term (project ∪ core) and never staffed
  // before. Together with Members this partitions the term's staffed roster.
  NewMembers: {
    includes: (c) => c.isStaffedThisTerm && c.isNewStaffed,
    listMembers: async (ctx) => {
      const termId = await resolveTermId(ctx);
      if (!termId) return [];
      return (await partitionStaffedMembers(termId)).newMembers;
    },
    enumerable: true,
  },
  Members: {
    // Returning members: staffed this term but not new. A mentor is a staffed
    // member too, so a mentor lands here (Members) AND in Mentors, receiving
    // both agreements.
    includes: (c) => c.isStaffedThisTerm && !c.isNewStaffed,
    listMembers: async (ctx) => {
      const termId = await resolveTermId(ctx);
      if (!termId) return [];
      return (await partitionStaffedMembers(termId)).returning;
    },
    enumerable: true,
  },
  Mentors: {
    // People mentoring this term: P3 project mentors ∪ external mentors.
    includes: (c) => c.isMentor,
    listMembers: async (ctx) => {
      const termId = await resolveTermId(ctx);
      if (!termId) return [];
      return listStaffedMentors(termId);
    },
    enumerable: true,
  },
  // A user group. A fixed audienceGroupId gates on membership in that group; a
  // null id means "the binding's term group" — everyone active/staffed this term
  // (isActiveThisTerm) — so a per-term member agreement never reaches off-term
  // (off-campus) members on either the notification or the app gate.
  Group: {
    includes: (c, ctx) =>
      ctx?.audienceGroupId
        ? (ctx.userGroupIds?.has(ctx.audienceGroupId) ?? false)
        : c.isActiveThisTerm,
    listMembers: (ctx) => listGroupMembers(ctx),
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
