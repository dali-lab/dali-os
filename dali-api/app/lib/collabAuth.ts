import { prisma } from "~/lib/db";
import { isHiringLead, isDomainLead, isCore, isInstructorFor } from "~/lib/roles";
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

  if (entity === "education-offering") {
    const offering = await prisma.educationOffering.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!offering) return false;
    // Description is editor-side content. Instructors of the offering or
    // any Core member can write; everyone else falls through.
    if (await isInstructorFor(userSub, id)) return true;
    if (await isCore(userSub)) return true;
    return false;
  }

  if (entity === "education-session") {
    const session = await prisma.educationSession.findUnique({
      where: { id },
      select: { offeringId: true },
    });
    if (!session) return false;
    if (await isInstructorFor(userSub, session.offeringId)) return true;
    if (await isCore(userSub)) return true;
    return false;
  }

  if (entity === "education-assignment") {
    const assignment = await prisma.educationAssignment.findUnique({
      where: { id },
      select: { offeringId: true, sessionId: true },
    });
    if (!assignment) return false;
    let offeringId = assignment.offeringId;
    if (!offeringId && assignment.sessionId) {
      const session = await prisma.educationSession.findUnique({
        where: { id: assignment.sessionId },
        select: { offeringId: true },
      });
      offeringId = session?.offeringId ?? null;
    }
    if (offeringId && (await isInstructorFor(userSub, offeringId))) return true;
    if (await isCore(userSub)) return true;
    return false;
  }

  if (entity === "education-submission") {
    const submission = await prisma.educationSubmission.findUnique({
      where: { id },
      select: {
        studentId: true,
        assignment: {
          select: {
            offeringId: true,
            sessionId: true,
          },
        },
      },
    });
    if (!submission) return false;
    if (submission.studentId === userSub) return true;
    let offeringId = submission.assignment.offeringId;
    if (!offeringId && submission.assignment.sessionId) {
      const session = await prisma.educationSession.findUnique({
        where: { id: submission.assignment.sessionId },
        select: { offeringId: true },
      });
      offeringId = session?.offeringId ?? null;
    }
    if (offeringId && (await isInstructorFor(userSub, offeringId))) return true;
    if (await isCore(userSub)) return true;
    return false;
  }

  if (entity === "education-application") {
    const application = await prisma.educationApplication.findUnique({
      where: { id },
      select: { offeringId: true },
    });
    if (!application) return false;
    if (await isInstructorFor(userSub, application.offeringId)) return true;
    if (await isCore(userSub)) return true;
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
