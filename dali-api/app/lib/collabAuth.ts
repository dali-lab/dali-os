import { prisma } from "~/lib/db";
import { isCore, isDomainLead } from "~/lib/roles";
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
    if (await isCore(userSub)) return true;
    return false;
  }

  // domainApplication:{id}:prepNote — the free-form "things to bring up in the
  // interview" note written during Initial delibs. Same gate as the delibs
  // moves endpoint: signed confidentiality plus domain lead or hiring lead.
  // (The "Initial only" edit window is enforced UI-side — the doc name carries
  // no DelibsSession context to gate on here.)
  if (entity === "domainApplication") {
    const da = await prisma.domainApplication.findUnique({
      where: { id },
      select: { application: { select: { applicationCycleId: true } } },
    });
    if (!da) return false;
    const cycleId = da.application.applicationCycleId;
    const confState = await getCycleConfidentialityState(userSub, cycleId);
    if (confState.status !== "signed") return false;
    if (await isDomainLead(userSub)) return true;
    if (await isCore(userSub)) return true;
    return false;
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

    // Per-interviewer private notes: `interview:{id}:rec-notes-{assignmentId}`.
    // Only the owner of that assignment may open the room. Hiring leads are
    // intentionally excluded — these are private reasoning notes.
    const field = parts[2]!;
    if (field.startsWith("rec-notes-")) {
      const assignmentId = field.slice("rec-notes-".length);
      return !!assignment && assignment.id === assignmentId;
    }

    if (assignment) return true;
    if (await isCore(userSub)) return true;
    return false;
  }

  // doc:{pageId}:body — project document pages. Access mirrors the project
  // edit gate used by the project document API routes (isCore ===
  // Admin || Core). The page must be a live (non-archived) Project page.
  if (entity === "doc") {
    const page = await prisma.page.findUnique({
      where: { id },
      select: { workspaceType: true, archivedAt: true },
    });
    if (!page || page.workspaceType !== "Project" || page.archivedAt !== null) {
      return false;
    }
    return isCore(userSub);
  }

  // partnersow:{applicationId}:body — the versionable Statement of Work for a
  // partner application. Same edit gate as the partner-application routes
  // (isCore === Admin || Core). The application must exist.
  if (entity === "partnersow") {
    const application = await prisma.partnerApplication.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!application) return false;
    return isCore(userSub);
  }

  // epic:{descriptionDocId}:description — the rich description on an Epic.
  // `id` is the opaque cuid stored on Epic.descriptionDocId (a room name,
  // NOT a Page row). The lookup goes by that column rather than by Epic.id
  // because the editor only knows the room name. Same edit gate as the
  // epic write API (isCore === Admin || Core); no separate read gate
  // since reading an epic is already gated by the page that renders it.
  if (entity === "epic") {
    const epic = await prisma.epic.findFirst({
      where: { descriptionDocId: id },
      select: { id: true },
    });
    if (!epic) return false;
    return isCore(userSub);
  }

  return false;
}
