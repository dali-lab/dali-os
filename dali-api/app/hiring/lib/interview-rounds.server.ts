import { prisma } from "~/lib/db";
import { FIRST_INTERVIEW_ROUND_ID } from "./cycle-timeline";

/**
 * The Interviews round a domain application is invited to right now: its
 * latest released decision, when that is an invite. Null when it isn't.
 */
export async function invitedRoundId(domainApplicationId: string): Promise<string | null> {
  const latest = await prisma.decision.findFirst({
    where: { domainApplicationId, stage: "Released" },
    orderBy: { createdAt: "desc" },
    select: { type: true, interviewRoundId: true },
  });
  if (latest?.type !== "InvitedToInterview") return null;
  return latest.interviewRoundId ?? FIRST_INTERVIEW_ROUND_ID;
}
