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
  // The form is live and self-served, so a member can submit picks that don't
  // form a clean ranked set — the same project in two slots, more slots filled
  // than maxBids, or no eligibility yet. None of these should reject the whole
  // submission and make the member vanish from the board; we normalize what we
  // can and record what's left. (Genuine interpretation failures upstream
  // already produce no bids; this guards the validate step.)
  const maxBids = Math.min(3, cycle.maxPreferencesPerMember);

  // De-duplicate by project, keeping the highest (lowest-numbered) rank — i.e.
  // the first occurrence, since `bids` is in rank order. Picking the same
  // project twice collapses to one bid rather than rejecting the submission.
  const dedupedBids: RawBid[] = [];
  const seenProjects = new Set<string>();
  for (const b of bids) {
    if (seenProjects.has(b.projectId)) continue;
    seenProjects.add(b.projectId);
    dedupedBids.push(b);
  }
  // Then cap at maxBids, keeping the top-ranked ones.
  const effectiveBids = dedupedBids.slice(0, maxBids);

  // The member's eligibility map: domainId -> level. Each bid expands into
  // one row per eligibility (where the project works in that domain). No
  // eligibility yet → nothing to expand into, so record zero bids rather than
  // erroring (the member still appears on the board, flagged).
  const eligibilities = await prisma.domainEligibility.findMany({
    where: { userId },
    select: { domainId: true, level: true },
  });
  if (eligibilities.length === 0) {
    return { ok: true, bids: [] };
  }
  const levelByDomain = new Map(
    eligibilities.map((e) => [e.domainId, e.level]),
  );

  // Biddability is driven by the project's DECLARED DOMAINS (ProjectDomain),
  // not by per-term ProjectRoleRequest rows. A project is biddable in a domain
  // if it works in that domain at all; level comes from the member's
  // eligibility. (ProjectRoleRequest still exists for headcount display on the
  // board, but no longer gates whether a bid resolves — a project with scope
  // but no manually-entered role requests is still biddable.) Restricted to
  // the bid projects ∩ the member's eligibility domains, keyed (project,domain)
  // for O(1) cross-check.
  const projectDomains = await prisma.projectDomain.findMany({
    where: {
      projectId: { in: effectiveBids.map((b) => b.projectId) },
      domainId: { in: [...levelByDomain.keys()] },
    },
    select: { projectId: true, domainId: true },
  });
  const biddable = new Set(
    projectDomains.map((d) => `${d.projectId}:${d.domainId}`),
  );

  const validated: ValidatedBid[] = [];
  for (let i = 0; i < effectiveBids.length; i++) {
    const b = effectiveBids[i];
    const rank = i + 1;
    // Each eligibility domain the project works in becomes a row. If the
    // project doesn't work in any of the member's eligibility domains, the bid
    // contributes nothing — silently dropped so the rest of the submission
    // still records (eligibility/domain drift shouldn't reject the form).
    for (const [domainId, level] of levelByDomain) {
      if (!biddable.has(`${b.projectId}:${domainId}`)) continue;
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
