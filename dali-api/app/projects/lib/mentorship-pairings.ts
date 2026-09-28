// Structural type — accepts either the regular Prisma client or a
// $transaction(tx) callback's transaction client. Keeping it local avoids
// pulling in heavier Prisma type names that vary between client versions.
type Tx = {
  projectAssignment: {
    findMany: (args: {
      where: { projectId: string; termId: string };
      select: { userId: true; domainId: true; level: true };
    }) => Promise<
      { userId: string; domainId: string; level: "P1" | "P2" | "P3" }[]
    >;
  };
  mentorshipPair: {
    findMany: (args: {
      where: { projectId: string; termId: string; manual: true };
      select: { menteeUserId: true; mentorUserId: true; domainId: true };
    }) => Promise<
      { menteeUserId: string; mentorUserId: string; domainId: string }[]
    >;
    deleteMany: (args: {
      where: { projectId: string; termId: string; manual: false };
    }) => Promise<{ count: number }>;
    createMany: (args: {
      data: {
        menteeUserId: string;
        mentorUserId: string;
        projectId: string;
        termId: string;
        domainId: string;
      }[];
    }) => Promise<{ count: number }>;
  };
};

// Assign each mentee to exactly one mentor, balancing load across the mentors.
// Least-loaded mentor wins, seeded by `seededLoad` (existing manual pairs) so a
// hand-assigned mentee still counts toward their mentor's share. Ties break by
// mentor order, which keeps the result deterministic. Returns one row per
// mentee (none if there are no mentors).
export function assignOneToOne(
  mentees: string[],
  mentors: string[],
  seededLoad?: Map<string, number>,
): { menteeUserId: string; mentorUserId: string }[] {
  if (mentors.length === 0) return [];
  const load = new Map<string, number>();
  for (const m of mentors) load.set(m, seededLoad?.get(m) ?? 0);

  const out: { menteeUserId: string; mentorUserId: string }[] = [];
  for (const menteeUserId of mentees) {
    let best = mentors[0];
    let bestLoad = load.get(best)!;
    for (const m of mentors) {
      const l = load.get(m)!;
      if (l < bestLoad) {
        best = m;
        bestLoad = l;
      }
    }
    out.push({ menteeUserId, mentorUserId: best });
    load.set(best, bestLoad + 1);
  }
  return out;
}

// Auto-derive MentorshipPair rows for one (project, term). Each mentee is
// assigned exactly one mentor in the same domain; when a domain has several
// mentors, mentees are load-balanced across them (see assignOneToOne). A
// member's role defaults to their level (P3 → mentor, P1/P2 → mentee);
// `roleOverride` (from the staffing board's per-card role badge, keyed by
// userId) flips it when present.
//
// Hand-created pairs (manual:true) are preserved: a mentee who already has a
// manual pair in a domain keeps it (they're skipped here), and that mentor's
// existing share seeds the balance so auto assignment fills around it.
//
// Replaces all AUTO (manual:false) rows for this project+term, then writes the
// derived set — so a domain move (e.g. Fullstack → UI/UX) drops the old mentor
// link instead of leaving it behind. Returns the count of pairs created.
export async function derivePairings(
  tx: Tx,
  projectId: string,
  termId: string,
  opts?: {
    roleOverride?: Map<string, boolean>;
    // Non-roster mentors placed on this project (see ExternalMentor). Added to
    // their domain's mentor pool; they are never mentees.
    externalMentors?: { userId: string; domainId: string }[];
  },
): Promise<number> {
  const assignments = await tx.projectAssignment.findMany({
    where: { projectId, termId },
    select: { userId: true, domainId: true, level: true },
  });

  const override = opts?.roleOverride;
  const byDomain = new Map<string, { mentees: string[]; mentors: string[] }>();
  const bucketFor = (domainId: string) => {
    let bucket = byDomain.get(domainId);
    if (!bucket) {
      bucket = { mentees: [], mentors: [] };
      byDomain.set(domainId, bucket);
    }
    return bucket;
  };
  for (const a of assignments) {
    const bucket = bucketFor(a.domainId);
    const isMentor = override?.get(a.userId) ?? a.level === "P3";
    if (isMentor) bucket.mentors.push(a.userId);
    else bucket.mentees.push(a.userId);
  }
  for (const em of opts?.externalMentors ?? []) {
    bucketFor(em.domainId).mentors.push(em.userId);
  }

  // Manual pairs are one-to-one already; group them by domain so we can leave
  // their mentees be and seed the balancer with the mentor's existing share.
  const manualPairs = await tx.mentorshipPair.findMany({
    where: { projectId, termId, manual: true },
    select: { menteeUserId: true, mentorUserId: true, domainId: true },
  });
  const manualByDomain = new Map<
    string,
    { menteeUserId: string; mentorUserId: string }[]
  >();
  for (const p of manualPairs) {
    const arr = manualByDomain.get(p.domainId) ?? [];
    arr.push({ menteeUserId: p.menteeUserId, mentorUserId: p.mentorUserId });
    manualByDomain.set(p.domainId, arr);
  }

  const toCreate: {
    menteeUserId: string;
    mentorUserId: string;
    projectId: string;
    termId: string;
    domainId: string;
  }[] = [];
  for (const [domainId, { mentees, mentors }] of byDomain) {
    if (mentors.length === 0) continue;
    const mentorSet = new Set(mentors);
    const manual = manualByDomain.get(domainId) ?? [];
    const manualMentees = new Set(manual.map((p) => p.menteeUserId));
    const seededLoad = new Map<string, number>();
    for (const p of manual) {
      if (mentorSet.has(p.mentorUserId)) {
        seededLoad.set(p.mentorUserId, (seededLoad.get(p.mentorUserId) ?? 0) + 1);
      }
    }
    const unassigned = mentees.filter((m) => !manualMentees.has(m));
    for (const { menteeUserId, mentorUserId } of assignOneToOne(
      unassigned,
      mentors,
      seededLoad,
    )) {
      toCreate.push({ menteeUserId, mentorUserId, projectId, termId, domainId });
    }
  }

  // Clear prior AUTO pairs for this project+term so re-finalize reflects the
  // current roster (domain chips / mentor badges), not leftover links from
  // earlier runs — but leave manual pairs untouched.
  await tx.mentorshipPair.deleteMany({ where: { projectId, termId, manual: false } });

  if (toCreate.length === 0) return 0;
  await tx.mentorshipPair.createMany({ data: toCreate });
  return toCreate.length;
}

export type DomainMissingMentor = {
  domainId: string;
  menteeUserIds: string[];
};

// Domains where mentorship pairing cannot run: zero mentors and more than one
// mentee. Solo mentee domains are fine (nothing to pair with). External mentors
// and role overrides count. Used by finalize to surface a level/role gap.
export function findDomainsMissingMentors(
  assignments: { userId: string; domainId: string; level: "P1" | "P2" | "P3" }[],
  opts?: {
    roleOverride?: Map<string, boolean>;
    externalMentors?: { userId: string; domainId: string }[];
  },
): DomainMissingMentor[] {
  const override = opts?.roleOverride;
  const byDomain = new Map<string, { mentees: string[]; mentors: string[] }>();
  const bucketFor = (domainId: string) => {
    let bucket = byDomain.get(domainId);
    if (!bucket) {
      bucket = { mentees: [], mentors: [] };
      byDomain.set(domainId, bucket);
    }
    return bucket;
  };
  for (const a of assignments) {
    const bucket = bucketFor(a.domainId);
    const isMentor = override?.get(a.userId) ?? a.level === "P3";
    if (isMentor) bucket.mentors.push(a.userId);
    else bucket.mentees.push(a.userId);
  }
  for (const em of opts?.externalMentors ?? []) {
    bucketFor(em.domainId).mentors.push(em.userId);
  }

  const gaps: DomainMissingMentor[] = [];
  for (const [domainId, { mentees, mentors }] of byDomain) {
    if (mentors.length > 0) continue;
    if (mentees.length <= 1) continue;
    gaps.push({ domainId, menteeUserIds: mentees });
  }
  return gaps;
}
