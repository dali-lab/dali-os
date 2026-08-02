// Profile achievements — milestones a member has actually passed, derived from
// records the app already keeps (onboarding, project assignments, terms) rather
// than from anything anyone awards by hand. Nothing here is stored: recomputing
// is cheap next to the cost of a table that drifts out of sync with the truth.
//
// The set is deliberately small and factual. Every one of these is a thing that
// either happened or didn't, so nobody has to argue about who deserves one.

import { prisma } from "~/lib/db";

export type AchievementKey =
  | "onboarded"
  | "first-term"
  | "multi-domain"
  | "veteran";

export type Achievement = {
  key: AchievementKey;
  /** Shown on the medal. */
  title: string;
  /** What it took to get it — the tooltip / caption. */
  description: string;
  earned: boolean;
};

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
    description: "Hired onto projects in more than one domain.",
  },
  {
    key: "veteran",
    title: "DALI for Life",
    description: "On project teams for more than three terms.",
  },
];

/**
 * Which milestones this member has reached. Always returns the full catalog —
 * the caller decides whether to render the unearned ones (we show them on your
 * own profile so you can see what's next, and hide them on someone else's).
 */
export async function achievementsForMember(userId: string): Promise<Achievement[]> {
  const now = new Date();

  const [member, assignments] = await Promise.all([
    prisma.dALIMember.findUnique({
      where: { userId },
      select: { onboardedAt: true },
    }),
    prisma.projectAssignment.findMany({
      where: { userId },
      select: {
        domainId: true,
        termId: true,
        term: { select: { endDate: true } },
      },
    }),
  ]);

  const domainIds = new Set(assignments.map((a) => a.domainId));
  const termIds = new Set(assignments.map((a) => a.termId));
  // "Finished" a term, not merely staffed for one — the current term doesn't
  // count until it's actually over.
  const finishedATerm = assignments.some((a) => a.term.endDate < now);

  const earned: Record<AchievementKey, boolean> = {
    onboarded: member?.onboardedAt != null,
    "first-term": finishedATerm,
    "multi-domain": domainIds.size > 1,
    veteran: termIds.size > 3,
  };

  return CATALOG.map((a) => ({ ...a, earned: earned[a.key] }));
}
