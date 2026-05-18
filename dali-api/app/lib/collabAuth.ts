import { prisma } from "~/lib/db";
import { isHiringLead, isDomainLead } from "~/lib/roles";
import { getProjectMembership } from "~/lib/projectAuth";
import { getCycleConfidentialityState } from "~/hiring/lib/confidentiality";

/** Hydrate author IDs into `{ id, name }` objects in a single IN query. */
export async function hydrateAuthors(
  authorIds: string[],
): Promise<{ id: string; name: string }[]> {
  if (authorIds.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: authorIds } },
    select: { id: true, firstName: true, lastName: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return authorIds.map((id) => {
    const u = byId.get(id);
    return {
      id,
      name: u ? [u.firstName, u.lastName].filter(Boolean).join(" ") : "Unknown",
    };
  });
}

/**
 * Whether `userSub` is allowed to read/restore the collab doc named `name`.
 * Mirrors the page-level access checks done by the routes that render the
 * editors:
 *   - review:{id}:{field}    → reviewer themself, domain lead, hiring lead
 *   - interview:{id}:{field} → assigned interviewer, hiring lead
 *   - project:{id}:overview  → any project editor (member/PM/Core/Admin)
 *   - sprint:{id}:goal       → any editor on the parent project
 *   - epic:{id}:description  → any editor on the parent project
 *   - task:{id}:description  → any editor on the parent project
 *
 * Returns false on malformed names, missing parents, presence rooms, etc.
 */
export async function authorizeCollabDoc(
  userSub: string,
  name: string,
): Promise<boolean> {
  const parts = name.split(":");
  if (parts.length !== 3) return false;
  const [entity, id] = parts;

  if (entity === "review") {
    const review = await prisma.applicationReview.findUnique({
      where: { id },
      include: { cycleReviewer: true },
    });
    if (!review) return false;
    const cycleId = review.cycleReviewer.applicationCycleId;
    const confState = await getCycleConfidentialityState(userSub, cycleId);
    if (confState.status !== "signed") return false;
    if (review.cycleReviewer.userId === userSub) return true;
    if (await isDomainLead(userSub)) return true;
    if (await isHiringLead(userSub)) return true;
    return false;
  }

  if (entity === "project" && parts[2] === "overview") {
    const m = await getProjectMembership(userSub, id);
    return m.canEdit;
  }
  if (entity === "sprint" && parts[2] === "goal") {
    const sprint = await prisma.sprint.findUnique({
      where: { id },
      select: { projectId: true },
    });
    if (!sprint) return false;
    const m = await getProjectMembership(userSub, sprint.projectId);
    return m.canEdit;
  }
  if (entity === "epic" && parts[2] === "description") {
    const epic = await prisma.epic.findUnique({
      where: { id },
      select: { projectId: true },
    });
    if (!epic) return false;
    const m = await getProjectMembership(userSub, epic.projectId);
    return m.canEdit;
  }
  if (entity === "task" && parts[2] === "description") {
    const task = await prisma.task.findUnique({
      where: { id },
      select: { projectId: true },
    });
    if (!task) return false;
    const m = await getProjectMembership(userSub, task.projectId);
    return m.canEdit;
  }

  if (entity === "interview") {
    const interview = await prisma.interview.findUnique({
      where: { id },
      select: { applicationCycleId: true },
    });
    if (!interview) return false;
    const confState = await getCycleConfidentialityState(
      userSub,
      interview.applicationCycleId,
    );
    if (confState.status !== "signed") return false;
    const assignment = await prisma.interviewAssignment.findFirst({
      where: {
        interviewId: id,
        cycleInterviewer: { userId: userSub },
      },
      select: { id: true },
    });
    if (assignment) return true;
    if (await isHiringLead(userSub)) return true;
    return false;
  }

  return false;
}
