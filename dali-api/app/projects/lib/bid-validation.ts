// Shared validation + level-resolution for a member's project bids, used by
// the form-driven submission path (bid-form-interpreter.ts → public-form.ts).
//
// A bid is now JUST a projectId (rank = array index). Domain is no longer
// asked on the form — instead, each bid expands server-side into one
// StaffingPreference per (project, eligibility) the member has, with that
// eligibility's level. Anything outside that eligibility set is silently
// dropped; anything inside it is recorded so the staffing board can see
// every (project, domain) combination the member is eligible to fill.
//
// Bids must still match an open ProjectRoleRequest for (term, domain) — a
// project with no open roles in any of the member's eligibility domains is
// rejected. preferenceRank carries the bid's rank, so all expansions of bid
// N share rank N.

import { prisma } from "~/lib/db";

// Level is the Prisma enum; kept as a string union to avoid importing the
// generated enum into pure call sites.
export type BidLevel = "P1" | "P2" | "P3";

export type RawBid = {
  projectId: string;
};

export type ValidatedBid = {
  projectId: string;
  domainId: string;
  level: BidLevel;
  // 1-based; matches the originating bid's rank. Multiple expanded rows
  // share a rank when one bid yields several (domain) expansions.
  preferenceRank: number;
  notes: string | null;
};

export type BidValidationResult =
  | { ok: true; bids: ValidatedBid[] }
  | { ok: false; error: string };

export type BidCycle = {
  id: string;
  termId: string;
  maxPreferencesPerMember: number;
};

// Validate a member's bid set for one cycle. Each input bid is one projectId;
// the output is one ValidatedBid per (projectId, eligible domain with an
// open role) combination. Order of `bids` IS the ranking.
export async function validateBids(
  userId: string,
  cycle: BidCycle,
  bids: RawBid[],
): Promise<BidValidationResult> {
  const maxBids = Math.min(3, cycle.maxPreferencesPerMember);
  if (bids.length > maxBids) {
    return { ok: false, error: `You can bid on at most ${maxBids} projects.` };
  }

  // No duplicate projects — a member ranks distinct projects, not the same
  // project twice.
  const seen = new Set(bids.map((b) => b.projectId));
  if (seen.size !== bids.length) {
    return { ok: false, error: "Duplicate bid" };
  }

  // The member's eligibility map: domainId -> level. Each bid expands into
  // one row per eligibility (where the project has an open role).
  const eligibilities = await prisma.domainEligibility.findMany({
    where: { userId },
    select: { domainId: true, level: true },
  });
  if (eligibilities.length === 0) {
    return {
      ok: false,
      error: "You have no domain eligibility — no bids can be recorded.",
    };
  }
  const levelByDomain = new Map(
    eligibilities.map((e) => [e.domainId, e.level]),
  );

  // Open roles for this term, restricted to the member's eligibility
  // domains. Keyed (project,domain) for O(1) cross-check.
  const roleRequests = await prisma.projectRoleRequest.findMany({
    where: {
      termId: cycle.termId,
      domainId: { in: [...levelByDomain.keys()] },
    },
    select: { projectId: true, domainId: true },
  });
  const openRoles = new Set(
    roleRequests.map((r) => `${r.projectId}:${r.domainId}`),
  );

  const validated: ValidatedBid[] = [];
  for (let i = 0; i < bids.length; i++) {
    const b = bids[i];
    const rank = i + 1;
    // Each eligibility the project has an open role in becomes a row. If
    // the project has no open role in any eligibility domain, the bid
    // contributes nothing — silently dropped so the rest of the submission
    // still records (eligibility/open-role drift shouldn't reject the form).
    for (const [domainId, level] of levelByDomain) {
      if (!openRoles.has(`${b.projectId}:${domainId}`)) continue;
      validated.push({
        projectId: b.projectId,
        domainId,
        level: level as BidLevel,
        preferenceRank: rank,
        notes: null,
      });
    }
  }

  return { ok: true, bids: validated };
}

// The replace-whole-set write: a resubmission is authoritative for that
// (user, cycle). Shared so both paths persist identically. Pass a Prisma
// transaction client so the caller can compose it with other writes.
export async function replaceBidSet(
  tx: Pick<typeof prisma, "staffingPreference">,
  userId: string,
  staffingCycleId: string,
  bids: ValidatedBid[],
): Promise<void> {
  await tx.staffingPreference.deleteMany({
    where: { userId, staffingCycleId },
  });
  if (bids.length > 0) {
    await tx.staffingPreference.createMany({
      data: bids.map((b) => ({
        userId,
        staffingCycleId,
        projectId: b.projectId,
        domainId: b.domainId,
        level: b.level,
        preferenceRank: b.preferenceRank,
        notes: b.notes,
      })),
    });
  }
}
