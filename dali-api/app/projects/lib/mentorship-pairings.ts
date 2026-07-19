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
      where: { projectId: string; termId: string };
      select: { menteeUserId: true; mentorUserId: true; domainId: true };
    }) => Promise<
      { menteeUserId: string; mentorUserId: string; domainId: string }[]
    >;
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

// Auto-derive MentorshipPair rows for one (project, term). For each domain
// staffed on the project: every mentee gets paired to every mentor in the same
// domain. A member's role defaults to their level (P3 → mentor, P1/P2 →
// mentee); `roleOverride` (from the staffing board's per-card role badge, keyed
// by userId) flips it when present. Additive only — existing pairs are never
// deleted, so Core overrides (manual adds/removals via the /mentorship/pairs
// UI) are preserved across re-finalizes. Returns the count of new pairs created.
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

  const existing = await tx.mentorshipPair.findMany({
    where: { projectId, termId },
    select: { menteeUserId: true, mentorUserId: true, domainId: true },
  });
  const seen = new Set(
    existing.map((p) => `${p.menteeUserId}|${p.mentorUserId}|${p.domainId}`),
  );

  const toCreate: {
    menteeUserId: string;
    mentorUserId: string;
    projectId: string;
    termId: string;
    domainId: string;
  }[] = [];
  for (const [domainId, { mentees, mentors }] of byDomain) {
    if (mentors.length === 0) continue;
    for (const menteeUserId of mentees) {
      for (const mentorUserId of mentors) {
        const key = `${menteeUserId}|${mentorUserId}|${domainId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        toCreate.push({ menteeUserId, mentorUserId, projectId, termId, domainId });
      }
    }
  }

  if (toCreate.length === 0) return 0;
  await tx.mentorshipPair.createMany({ data: toCreate });
  return toCreate.length;
}
