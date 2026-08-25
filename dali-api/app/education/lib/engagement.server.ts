import { prisma } from "~/lib/db";

// Education engagement for cross-app surfaces: the hiring reviewer view
// ("demonstrated interest" — what a hiring applicant attended and how it
// went) and member profiles. Keyed purely on User.id: portal applicants and
// hiring applicants share the same User row, so linkage is automatic.
//
// SENSITIVITY: `internalNote` (instructor hiring-only note) is included ONLY
// by getEducationEngagement — its callers are the hiring application views,
// which already sit behind reviewer access + confidentiality signing. The
// profile surface uses getEducationProfile, which never selects notes.

export type EngagementEntry = {
  offeringId: string;
  title: string;
  type: "Miniseries" | "Workshop";
  startsAt: Date | null;
  endsAt: Date | null;
  status: string;
  attendance: { present: number; excused: number; total: number };
  certificateIssuedAt: Date | null;
  feedback: string | null;
  internalNote: string | null;
};

export async function getEducationEngagement(userId: string): Promise<EngagementEntry[]> {
  const applications = await prisma.educationApplication.findMany({
    where: { applicantUserId: userId },
    orderBy: { submittedAt: "desc" },
    select: {
      status: true,
      offering: {
        select: {
          id: true,
          title: true,
          type: true,
          startsAt: true,
          endsAt: true,
          _count: { select: { sessions: true } },
        },
      },
      attendances: { select: { status: true } },
      certificate: { select: { issuedAt: true } },
      note: { select: { feedback: true, internalNote: true } },
    },
  });

  return applications.map((a) => ({
    offeringId: a.offering.id,
    title: a.offering.title,
    type: a.offering.type,
    startsAt: a.offering.startsAt,
    endsAt: a.offering.endsAt,
    status: a.status,
    attendance: {
      present: a.attendances.filter((x) => x.status === "Present").length,
      excused: a.attendances.filter((x) => x.status === "Excused").length,
      total: a.offering._count.sessions,
    },
    certificateIssuedAt: a.certificate?.issuedAt ?? null,
    feedback: a.note?.feedback ?? null,
    internalNote: a.note?.internalNote ?? null,
  }));
}

/** Profile-safe view: same shape minus both note lanes, plus CE credits. */
export async function getEducationProfile(userId: string) {
  const [engagement, taught, credits] = await Promise.all([
    getEducationEngagement(userId).then((entries) =>
      entries.map(({ internalNote: _internal, feedback: _feedback, ...rest }) => rest),
    ),
    prisma.instructorAssignment.findMany({
      where: { userId },
      select: {
        offering: {
          select: { id: true, title: true, type: true, startsAt: true },
        },
        term: { select: { code: true } },
      },
      orderBy: { offering: { startsAt: { sort: "desc", nulls: "last" } } },
    }),
    prisma.cECredit.findMany({
      where: { userId },
      select: { term: { select: { code: true, sortKey: true } } },
    }),
  ]);

  // CE credit counts per term, newest first.
  const ceByTerm = new Map<string, { termCode: string; sortKey: number; count: number }>();
  for (const c of credits) {
    const cur = ceByTerm.get(c.term.code) ?? {
      termCode: c.term.code,
      sortKey: c.term.sortKey,
      count: 0,
    };
    cur.count += 1;
    ceByTerm.set(c.term.code, cur);
  }

  return {
    attended: engagement,
    taught: taught.map((t) => ({
      offeringId: t.offering.id,
      title: t.offering.title,
      type: t.offering.type,
      termCode: t.term.code,
    })),
    ceCredits: [...ceByTerm.values()]
      .sort((a, b) => b.sortKey - a.sortKey)
      .map(({ termCode, count }) => ({ termCode, count })),
  };
}
