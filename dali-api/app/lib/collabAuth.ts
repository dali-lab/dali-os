import { prisma } from "~/lib/db";
import { isCore, isDomainLead, isProjectMember, isLabMember } from "~/lib/roles";
import { getCycleConfidentialityState } from "~/hiring/lib/confidentiality";
import { partnerHasProjectAccess } from "~/partners/lib/partner-access";

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

  // doc:{pageId}:body — any live FreeForm page. Core/Admin everywhere.
  // Project-workspace pages additionally open to anyone staffed on the
  // project (mirrors requireProjectEditAccess, the gate the document API
  // routes already use) and — when the page is explicitly marked
  // partnerVisible — to partner users whose org holds an active
  // ProjectPartner link to the project. EducationOffering-workspace pages
  // are also editable by the offering's instructors; enrolled students never
  // open these rooms — the course hub renders materials server-side
  // read-only.
  if (entity === "doc") {
    const page = await prisma.page.findUnique({
      where: { id },
      select: {
        archivedAt: true,
        workspaceType: true,
        workspaceId: true,
        partnerVisible: true,
      },
    });
    if (!page || page.archivedAt !== null) {
      return false;
    }
    if (await isCore(userSub)) return true;
    // Lab-workspace pages (the lab-wide Documents area) open to any lab member
    // — the lab's members are the Lab workspace's members, mirroring the
    // project-member gate below. There's no read-only collab connection, so
    // "can open" == "can edit the body" here (same as project pages).
    if (page.workspaceType === "Lab") {
      return isLabMember(userSub);
    }
    if (page.workspaceType === "Project" && page.workspaceId) {
      if (await isProjectMember(userSub, page.workspaceId)) return true;
      if (page.partnerVisible) {
        return partnerHasProjectAccess(userSub, page.workspaceId);
      }
    }
    if (page.workspaceType === "EducationOffering" && page.workspaceId) {
      const instructor = await prisma.instructorAssignment.findFirst({
        where: { userId: userSub, offeringId: page.workspaceId },
        select: { id: true },
      });
      return instructor !== null;
    }
    return false;
  }

  // eduassignment:{assignmentId}:instructions — rich assignment instructions,
  // stored as a bare collab room named on EducationAssignment.instructionsDocId
  // (epic-description pattern). Edit gate = offering manager.
  if (entity === "eduassignment") {
    const assignment = await prisma.educationAssignment.findUnique({
      where: { id },
      select: { offeringId: true, session: { select: { offeringId: true } } },
    });
    if (!assignment) return false;
    const offeringId = assignment.offeringId ?? assignment.session?.offeringId;
    if (!offeringId) return false;
    if (await isCore(userSub)) return true;
    const instructor = await prisma.instructorAssignment.findFirst({
      where: { userId: userSub, offeringId },
      select: { id: true },
    });
    return instructor !== null;
  }

  // partnersow:{applicationId}:body — the versionable Statement of Work for a
  // partner application. Core/Admin (same gate as the internal application
  // routes), plus partner users in the org that owns the application — the
  // SOW is co-drafted between the partner and Core.
  if (entity === "partnersow") {
    const application = await prisma.partnerApplication.findUnique({
      where: { id },
      select: { partnerOrgId: true },
    });
    if (!application) return false;
    if (await isCore(userSub)) return true;
    const partnerUser = await prisma.partnerUser.findUnique({
      where: { userId: userSub },
      select: { partnerOrgId: true },
    });
    return partnerUser?.partnerOrgId === application.partnerOrgId;
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

  // eduoffering:{offeringId}:description — the rich description on an
  // EducationOffering. Edit gate = offering manager: Core (Admin superset)
  // or an instructor assigned to this offering. Students never open this
  // room — catalog/detail pages render it server-side read-only.
  if (entity === "eduoffering") {
    const offering = await prisma.educationOffering.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!offering) return false;
    if (await isCore(userSub)) return true;
    const instructor = await prisma.instructorAssignment.findFirst({
      where: { userId: userSub, offeringId: id },
      select: { id: true },
    });
    return instructor !== null;
  }

  return false;
}
