// Shared validation + level-resolution for a member's project bids, used by
// BOTH submission paths so they can't drift:
//   - the structured JSON endpoint (api.project-bids.ts), and
//   - the form-driven path (bid-form-interpreter.ts → public-form.ts).
//
// A bid is (project, domain). `level` is NOT supplied by the caller — it is
// the member's DomainEligibility level in that domain. A bid is only valid in
// a domain the member is eligible in, and only for a project that has an open
// ProjectRoleRequest in that (term, domain). These are exactly the rules the
// original endpoint enforced; they live here now so there is one source of
// truth.

import { prisma } from "~/lib/db";

// Level is the Prisma enum; kept as a string union to avoid importing the
// generated enum into pure call sites.
export type BidLevel = "P1" | "P2" | "P3";

export type RawBid = {
  projectId: string;
  domainId: string;
  notes?: string | null;
};

export type ValidatedBid = {
  projectId: string;
  domainId: string;
  level: BidLevel;
  // 1-based; array order in = rank out (index 0 → rank 1).
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

// Validate a member's whole bid set for one cycle and resolve each bid's
// level from the member's eligibility. Order of `bids` IS the ranking.
//
// Pure of HTTP — returns a discriminated result; callers map it to a Response
// (endpoint) or to a thrown/returned error (interpreter). Mirrors the gates
// from the original api.project-bids.ts exactly, including the error strings,
// so behaviour is unchanged for the existing endpoint.
export async function validateBids(
  userId: string,
  cycle: BidCycle,
  bids: RawBid[],
): Promise<BidValidationResult> {
  const maxBids = Math.min(3, cycle.maxPreferencesPerMember);
  if (bids.length > maxBids) {
    return { ok: false, error: `You can bid on at most ${maxBids} projects.` };
  }

  // No duplicate (project, domain) pairs — that would be the same bid twice.
  const seen = new Set(bids.map((b) => `${b.projectId}:${b.domainId}`));
  if (seen.size !== bids.length) {
    return { ok: false, error: "Duplicate bid" };
  }

  // The member's eligibility map: domainId -> level. A bid is only valid in a
  // domain they're eligible in, and we record that eligibility level.
  const eligibilities = await prisma.domainEligibility.findMany({
    where: { userId },
    select: { domainId: true, level: true },
  });
  const levelByDomain = new Map(eligibilities.map((e) => [e.domainId, e.level]));

  // Projects that actually have an open role in (term, domain) the member is
  // eligible for. Keyed for O(1) validation below.
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
    const level = levelByDomain.get(b.domainId);
    if (!level) {
      return {
        ok: false,
        error: "You are not eligible in one of the chosen domains.",
      };
    }
    if (!openRoles.has(`${b.projectId}:${b.domainId}`)) {
      return {
        ok: false,
        error:
          "One of the chosen projects has no open role in that domain this term.",
      };
    }
    validated.push({
      projectId: b.projectId,
      domainId: b.domainId,
      level: level as BidLevel,
      preferenceRank: i + 1,
      notes: b.notes?.trim() || null,
    });
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
