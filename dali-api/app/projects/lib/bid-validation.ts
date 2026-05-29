// Shared validation + level-resolution for a member's project bids, used by
// the form-driven submission path (bid-form-interpreter.ts → public-form.ts).
//
// A bid is JUST a projectId (rank = array index). Domain is not asked on the
// form — instead, each bid expands server-side into StaffingPreference rows:
// exactly ONE StaffingPreference per ranked project. Eligibility NEVER gates a
// bid — every project the member ranked produces a row, regardless of whether
// they're eligible in any of its domains. The single row's domainId is chosen
// (see pickDomain) just to give the board a column and satisfy the row's unique
// key; the domains a member is actually available for are shown separately from
// their DomainEligibility. preferenceRank carries the bid's 1-based rank.
// (ProjectRoleRequest is headcount display only; it never gates bids.)

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
  // never by per-term ProjectRoleRequest rows. Eligibility NEVER gates a bid:
  // every ranked project produces exactly ONE preference row, even when the
  // project declares several domains and even when the member is eligible in
  // none of them. The board lists which domains the member is actually
  // available for separately (DomainEligibility chips); the bid itself is one
  // entry per project. We still pick a single domainId to satisfy the row's
  // unique key + give the board a column to place it in.
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

  // Level shown on a bid row: the member's eligibility level in the chosen
  // domain if they have one, else the baseline P1 (Learner). Level never blocks
  // a bid.
  const DEFAULT_LEVEL: BidLevel = "P1";

  // The single domain a bid lands in, in priority order:
  //   1. a project domain the member is eligible in (their level there); if
  //      several, the one with the highest level — that's the strongest claim.
  //   2. else the project's first declared domain (at P1) — keeps a multi-
  //      domain project's bid in a real column even with no overlap.
  //   3. else (project declares no domains, e.g. Deserto) the member's own
  //      highest-level eligibility domain — so the bid still resolves to one
  //      row instead of vanishing.
  //   4. else null — no domain anywhere; the bid produces no row (only when the
  //      member has zero eligibility AND the project declares zero domains).
  const LEVEL_RANK: Record<BidLevel, number> = { P1: 1, P2: 2, P3: 3 };
  const memberDomainsByLevelDesc = [...levelByDomain.entries()].sort(
    (a, b) => LEVEL_RANK[b[1] as BidLevel] - LEVEL_RANK[a[1] as BidLevel],
  );
  // A bid ALWAYS resolves to a row — never dropped. The domainId is only there
  // to satisfy the row's unique key and label the card; the board places a bid
  // by its PROJECT, not its domain. So when no domain applies at all (the
  // project declares none AND the member has none — e.g. a no-eligibility
  // member bidding a no-domain project like Make101/Deserto), we fall back to
  // the empty-string domain. The card still shows under the project column.
  const NO_DOMAIN = "";
  const pickDomain = (
    projDomains: string[],
  ): { domainId: string; level: BidLevel } => {
    const eligibleProjDomains = projDomains
      .filter((d) => levelByDomain.has(d))
      .sort(
        (a, b) =>
          LEVEL_RANK[levelByDomain.get(b) as BidLevel] -
          LEVEL_RANK[levelByDomain.get(a) as BidLevel],
      );
    if (eligibleProjDomains.length > 0) {
      const domainId = eligibleProjDomains[0];
      return { domainId, level: levelByDomain.get(domainId) as BidLevel };
    }
    if (projDomains.length > 0) {
      return { domainId: projDomains[0], level: DEFAULT_LEVEL };
    }
    if (memberDomainsByLevelDesc.length > 0) {
      const [domainId, level] = memberDomainsByLevelDesc[0];
      return { domainId, level: level as BidLevel };
    }
    return { domainId: NO_DOMAIN, level: DEFAULT_LEVEL };
  };

  const validated: ValidatedBid[] = [];
  for (let i = 0; i < effectiveBids.length; i++) {
    const b = effectiveBids[i];
    const rank = i + 1;
    const projDomains = domainsByProject.get(b.projectId) ?? [];
    const picked = pickDomain(projDomains);
    validated.push({
      projectId: b.projectId,
      domainId: picked.domainId,
      level: picked.level,
      preferenceRank: rank,
      notes: null,
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
