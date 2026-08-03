// Profile achievements — milestones a member has actually passed, derived from
// records the app already keeps rather than from anything anyone awards by
// hand. Nothing here is stored: recomputing is cheap next to the cost of a
// table that drifts out of sync with the truth, and it means a new achievement
// applies to everyone's history the moment it ships.
//
// The set is deliberately factual. Every one is a thing that either happened or
// didn't, so nobody has to argue about who deserves one.

import { prisma } from "~/lib/db";
import { payPeriodFor } from "~/lib/pay-period";

export type AchievementKey =
  | "onboarded"
  | "first-term"
  | "multi-domain"
  | "promoted"
  | "veteran"
  | "student"
  | "mentor"
  | "big-period"
  | "talent-scout"
  | "prolific";

export type Achievement = {
  key: AchievementKey;
  /** Shown on the medal. */
  title: string;
  /** What it took to get it — the tooltip / caption. */
  description: string;
  earned: boolean;
};

/** Hours in one pay period that count as a heavy fortnight. */
const BIG_PERIOD_HOURS = 40;
/** Personal pages beyond which you're clearly using them. */
const PROLIFIC_PAGES = 5;

const CATALOG: Array<{
  key: AchievementKey;
  title: string;
  description: string;
}> = [
  {
    key: "onboarded",
    title: "First Light",
    description: "Finished onboarding and joined the lab.",
  },
  {
    key: "first-term",
    title: "Shipped It",
    description: "Saw a full term through on a project.",
  },
  {
    key: "multi-domain",
    title: "Double Threat",
    description: "Hired into more than one domain.",
  },
  {
    key: "promoted",
    title: "Level Up",
    description: "Promoted past P1 in a domain.",
  },
  {
    key: "veteran",
    title: "DALI for Life",
    description: "On project teams for more than three terms.",
  },
  {
    key: "student",
    title: "Back to Class",
    description: "Took a DALI course or workshop.",
  },
  {
    key: "mentor",
    title: "Passing the Torch",
    description: "Mentored another member.",
  },
  {
    key: "big-period",
    title: "Burning the Candle",
    description: `Logged over ${BIG_PERIOD_HOURS} hours in a single pay period.`,
  },
  {
    key: "talent-scout",
    title: "Talent Scout",
    description: "Someone you reviewed or interviewed got in.",
  },
  {
    key: "prolific",
    title: "Paper Trail",
    description: `Wrote more than ${PROLIFIC_PAGES} personal pages.`,
  },
];

/**
 * Which milestones this member has reached. Always returns the full catalog
 * with an `earned` flag — the caller decides what to render.
 */
export async function achievementsForMember(userId: string): Promise<Achievement[]> {
  const now = new Date();

  const [
    member,
    assignments,
    eligibilities,
    eduEnrollments,
    mentorPairs,
    timeEntries,
    pageCount,
    reviewed,
    interviewed,
  ] = await Promise.all([
    prisma.dALIMember.findUnique({ where: { userId }, select: { onboardedAt: true } }),
    prisma.projectAssignment.findMany({
      where: { userId },
      select: { termId: true, term: { select: { endDate: true } } },
    }),
    // Eligibility is the record of being hired into a domain — it's independent
    // of whether you were ever staffed in it (see the schema note on
    // DomainEligibility). ProjectAssignment is staffing, which is a different
    // question and the wrong one for "how many domains am I hired into".
    prisma.domainEligibility.findMany({
      where: { userId },
      select: { domainId: true, level: true },
    }),
    prisma.educationApplication.count({ where: { applicantUserId: userId, status: "Approved" } }),
    prisma.mentorshipPair.count({ where: { mentorUserId: userId } }),
    prisma.timeEntry.findMany({ where: { userId }, select: { date: true, hours: true } }),
    prisma.page.count({
      where: { workspaceType: "Member", workspaceId: userId, archivedAt: null },
    }),
    prisma.applicationReview.findMany({
      where: { cycleReviewer: { userId } },
      select: { domainApplicationId: true },
    }),
    prisma.interviewAssignment.findMany({
      where: { cycleInterviewer: { userId } },
      select: { interview: { select: { domainApplicationId: true } } },
    }),
  ]);

  const termIds = new Set(assignments.map((a) => a.termId));
  // "Finished" a term, not merely staffed for one — the current term doesn't
  // count until it's actually over.
  const finishedATerm = assignments.some((a) => a.term.endDate < now);

  const domainIds = new Set(eligibilities.map((e) => e.domainId));
  // Eligibility is monotonic and edited in place, so a level above the P1 entry
  // point is itself the record of a promotion.
  const promoted = eligibilities.some((e) => e.level === "P2" || e.level === "P3");

  // Hours per pay period. Entries carry a calendar date, and pay periods are
  // calendar fortnights, so both are compared as UTC-midnight days.
  const hoursByPeriod = new Map<number, number>();
  for (const t of timeEntries) {
    const d = t.date;
    const dayUtc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const idx = payPeriodFor(dayUtc).index;
    hoursByPeriod.set(idx, (hoursByPeriod.get(idx) ?? 0) + t.hours);
  }
  const bigPeriod = [...hoursByPeriod.values()].some((h) => h > BIG_PERIOD_HOURS);

  // Applications this member had a hand in judging. Released is the decision
  // the applicant actually received; a Draft or Final one can still change.
  const judgedIds = [
    ...new Set([
      ...reviewed.map((r) => r.domainApplicationId),
      ...interviewed.map((i) => i.interview.domainApplicationId),
    ]),
  ];
  const scouted =
    judgedIds.length > 0 &&
    (await prisma.decision.findFirst({
      where: { domainApplicationId: { in: judgedIds }, type: "Accepted", stage: "Released" },
      select: { id: true },
    })) !== null;

  const earned: Record<AchievementKey, boolean> = {
    onboarded: member?.onboardedAt != null,
    "first-term": finishedATerm,
    "multi-domain": domainIds.size > 1,
    promoted,
    veteran: termIds.size > 3,
    student: eduEnrollments > 0,
    mentor: mentorPairs > 0,
    "big-period": bigPeriod,
    "talent-scout": scouted,
    prolific: pageCount > PROLIFIC_PAGES,
  };

  return CATALOG.map((a) => ({ ...a, earned: earned[a.key] }));
}
