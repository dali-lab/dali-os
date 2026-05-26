// Shared validation + level-resolution for a member's project bids, used by
// the form-driven submission path (bid-form-interpreter.ts → public-form.ts).
//
// A bid is JUST a projectId (rank = array index). Domain is not asked on the
// form — instead, each bid expands server-side into StaffingPreference rows:
// one per domain the PROJECT declares (ProjectDomain) that the member is also
// eligible in, so a bid normally lands in the member's own domain columns at
// their eligibility level. Eligibility does NOT gate the bid, though — when the
// project shares no domain with the member's eligibility, the bid falls back to
// the project's declared domains (at the default level) so it still shows on
// the board instead of vanishing. preferenceRank carries the bid's rank, shared
// across all expansions of bid N. (ProjectRoleRequest is headcount display
// only; it never gates bids.)

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

  // The member's eligibility map: domainId -> level. Used ONLY to label a bid
  // row with the member's level in that domain — it does NOT gate whether a
  // bid resolves. A member with no eligibility (or none in the project's
  // domains) still produces bid rows; they're just marked at the default
  // level. This keeps every bid visible on the board, per product intent.
  const eligibilities = await prisma.domainEligibility.findMany({
    where: { userId },
    select: { domainId: true, level: true },
  });
  const levelByDomain = new Map(
    eligibilities.map((e) => [e.domainId, e.level]),
  );

  // Biddability is driven by the project's DECLARED DOMAINS (ProjectDomain) —
  // never by per-term ProjectRoleRequest rows. A bid expands to a row per
  // domain the project declares that the member is ALSO eligible in (so a
  // member's bid normally lands in their own domain columns). Eligibility no
  // longer GATES the bid, though: when the project shares NO domain with the
  // member's eligibility, the bid falls back to the project's declared domains
  // so it still shows on the board instead of vanishing.
  const projectDomains = await prisma.projectDomain.findMany({
    where: { projectId: { in: effectiveBids.map((b) => b.projectId) } },
    select: { projectId: true, domainId: true },
  });
  const domainsByProject = new Map<string, string[]>();
  for (const d of projectDomains) {
    const list = domainsByProject.get(d.projectId) ?? [];
    list.push(d.domainId);
    domainsByProject.set(d.projectId, list);
  }

  // Level shown on a bid row: the member's eligibility level in that domain if
  // they have one, else the baseline P1 (Learner). Level never blocks a bid.
  const DEFAULT_LEVEL: BidLevel = "P1";

  const validated: ValidatedBid[] = [];
  for (let i = 0; i < effectiveBids.length; i++) {
    const b = effectiveBids[i];
    const rank = i + 1;
    const projDomains = domainsByProject.get(b.projectId) ?? [];
    // Prefer the project domains the member is eligible in; if there's no
    // overlap, fall back to all the project's domains so the bid still records.
    const eligibleOverlap = projDomains.filter((d) => levelByDomain.has(d));
    const targetDomains = eligibleOverlap.length > 0 ? eligibleOverlap : projDomains;
    for (const domainId of targetDomains) {
      validated.push({
        projectId: b.projectId,
        domainId,
        level: (levelByDomain.get(domainId) ?? DEFAULT_LEVEL) as BidLevel,
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
