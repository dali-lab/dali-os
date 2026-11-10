import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { currentTermMemberWhere } from "~/lib/roles";
import { FIRST_INTERVIEW_ROUND_ID } from "./cycle-timeline";

// Bulk roster helpers for the cycle page's Review tab.

/**
 * A domain's mentors: members at P3 in that domain (the "Mentor" level) who
 * are active this term. Eligibility never goes down, so the term check keeps
 * past mentors who've left or gone quiet off the list.
 */
export async function domainMentorIds(domainId: string, request?: Request): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: {
      ...(await currentTermMemberWhere(request)),
      domainEligibilities: { some: { domainId, level: "P3" } },
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/** Add every mentor of `domainId` to the cycle's reviewer roster, or to one
 *  Interviews round's interviewer roster, for that domain. Returns how many
 *  were newly added. */
export async function addDomainMentors(
  cycleId: string,
  domainId: string,
  role: "reviewer" | "interviewer",
  request?: Request,
  interviewRoundId: string = FIRST_INTERVIEW_ROUND_ID,
  actorId?: string,
): Promise<number> {
  const userIds = await domainMentorIds(domainId, request);
  if (userIds.length === 0) return 0;
  const data = userIds.map((userId) => ({ userId, applicationCycleId: cycleId, domainId }));
  const { count } =
    role === "reviewer"
      ? await prisma.cycleReviewer.createMany({ data, skipDuplicates: true })
      : await prisma.cycleInterviewer.createMany({
          data: data.map((d) => ({ ...d, interviewRoundId })),
          skipDuplicates: true,
        });
  if (count > 0) {
    await logAuditEvent({
      action: "domain.mentors.add",
      userId: actorId,
      targetId: domainId,
      metadata: { cycleId, role, added: count },
      request,
    });
  }
  return count;
}
