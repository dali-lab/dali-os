import { prisma } from "~/lib/db.server";
import { addDomainMentors, domainMentorIds } from "~/hiring/lib/cycle-rosters.server";

export type AddMentorsResult =
  | { status: "not-in-cycle" }
  | { status: "ok"; added: number; outcome: "added" | "already" | "none" };

export async function addMentorsToCycleDomain({
  cycleId,
  domainId,
  role,
  request,
  interviewRoundId,
  actorId,
}: {
  cycleId: string;
  domainId: string;
  role: "reviewer" | "interviewer";
  request: Request;
  interviewRoundId?: string;
  actorId: string;
}): Promise<AddMentorsResult> {
  const linked = await prisma.domainApplicationCycle.findUnique({
    where: { domainId_applicationCycleId: { domainId, applicationCycleId: cycleId } },
    select: { domainId: true },
  });
  if (!linked) return { status: "not-in-cycle" };
  const added = await addDomainMentors(cycleId, domainId, role, request, interviewRoundId, actorId);
  if (added > 0) return { status: "ok", added, outcome: "added" };
  const outcome = (await domainMentorIds(domainId, request)).length ? "already" : "none";
  return { status: "ok", added, outcome };
}
