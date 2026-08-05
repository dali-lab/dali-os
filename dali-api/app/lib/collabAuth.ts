import { prisma } from "~/lib/db";
import { isCore, isDomainLead, isProjectMember, isLabMember } from "~/lib/roles";
import { getCycleConfidentialityState } from "~/hiring/lib/confidentiality";
import { partnerHasProjectAccess } from "~/partners/lib/partner-access";
import { resolvePhotoUrl } from "~/lib/photo";
import { COLLAB_SOURCES } from "~/collab/sources";
import { getPageAccess } from "~/lib/pageAccess.server";

/** Hydrate author IDs into `{ id, name, photoUrl }` objects in a single IN
 * query. `photoUrl` is resolved to a ready avatar src (null → initials). */
export async function hydrateAuthors(
  authorIds: string[],
): Promise<{ id: string; name: string; photoUrl: string | null }[]> {
  if (authorIds.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: authorIds } },
    select: { id: true, firstName: true, lastName: true, photoUrl: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return Promise.all(
    authorIds.map(async (id) => {
      const u = byId.get(id);
      return {
        id,
        name: u ? [u.firstName, u.lastName].filter(Boolean).join(" ") : "Unknown",
        photoUrl: await resolvePhotoUrl(u?.photoUrl),
      };
    }),
  );
}

export interface CollabAuthResult {
  allowed: boolean;
  /** When true the server should set connectionConfig.readOnly = true so the
   *  user's writes are dropped. Callers that only need a binary gate can
   *  ignore this field. */
  readOnly: boolean;
}

/**
 * Whether `userSub` is allowed to read/restore the collab doc named `name`,
 * and whether the connection should be read-only.
 *
 * The `doc:{pageId}:body` branch now delegates to getPageAccess so the
 * view-vs-edit distinction is expressed here:
 *   canEdit → full read/write
 *   canView only → allowed but readOnly = true
 *   neither → denied
 *
 * All other entity types continue to require full edit rights (their surfaces
 * don't have a viewer role), so readOnly is always false for them.
 *
 * Returns { allowed: false, readOnly: false } on malformed names, missing
 * parents, etc.
 */
export async function authorizeCollabDoc(
  userSub: string,
  name: string,
): Promise<CollabAuthResult> {
  const deny: CollabAuthResult = { allowed: false, readOnly: false };
  const allow: CollabAuthResult = { allowed: true, readOnly: false };

  const parts = name.split(":");
  if (parts.length !== 3) return deny;
  const [entity, id, field] = parts;

  if (entity === "review") {
    const review = await prisma.applicationReview.findUnique({
      where: { id },
      include: { cycleReviewer: true },
    });
    if (!review) return deny;
    const cycleId = review.cycleReviewer.applicationCycleId;
    const confState = await getCycleConfidentialityState(userSub, cycleId);
    if (confState.status !== "signed") return deny;
    if (review.cycleReviewer.userId === userSub) return allow;
    if (await isDomainLead(userSub)) return allow;
    if (await isCore(userSub)) return allow;
    return deny;
  }

  // domainApplication:{id}:prepNote — the free-form "things to bring up in the
  // interview" note written during Initial delibs. Same gate as the delibs
  // moves endpoint: signed confidentiality plus domain lead or hiring lead.
  if (entity === "domainApplication") {
    const da = await prisma.domainApplication.findUnique({
      where: { id },
      select: { application: { select: { applicationCycleId: true } } },
    });
    if (!da) return deny;
    const cycleId = da.application.applicationCycleId;
    const confState = await getCycleConfidentialityState(userSub, cycleId);
    if (confState.status !== "signed") return deny;
    if (await isDomainLead(userSub)) return allow;
    if (await isCore(userSub)) return allow;
    return deny;
  }

  if (entity === "interview") {
    const interview = await prisma.interview.findUnique({
      where: { id },
      select: { applicationCycleId: true },
    });
    if (!interview) return deny;
    const confState = await getCycleConfidentialityState(
      userSub,
      interview.applicationCycleId,
    );
    if (confState.status !== "signed") return deny;
    const assignment = await prisma.interviewAssignment.findFirst({
      where: {
        interviewId: id,
        cycleInterviewer: { userId: userSub },
      },
      select: { id: true },
    });

    // Per-interviewer private notes: `interview:{id}:rec-notes-{assignmentId}`.
    const field = parts[2]!;
    if (field.startsWith("rec-notes-")) {
      const assignmentId = field.slice("rec-notes-".length);
      return !!assignment && assignment.id === assignmentId ? allow : deny;
    }

    if (assignment) return allow;
    if (await isCore(userSub)) return allow;
    return deny;
  }

  // doc:{pageId}:body — delegates to getPageAccess so viewer-only users
  // connect with readOnly = true rather than being denied entirely.
  // Member-workspace pages stay fully private (noteAccess enforces the gate).
  // Partner users on partner-visible Project pages get readOnly = true here;
  // the server.ts partner readOnly path is now superseded by this branch.
  if (entity === "doc") {
    const page = await prisma.page.findUnique({
      where: { id },
      select: {
        id: true,
        archivedAt: true,
        workspaceType: true,
        workspaceId: true,
        partnerVisible: true,
        createdById: true,
        studentEditable: true,
        // Read by getPageAccess's object path — keep this select in sync so the
        // collab socket honors named-share tiers and the General access setting
        // exactly as the by-id path does.
        profileVisible: true,
        labListing: true,
        linkAccess: true,
        linkPermission: true,
      },
    });
    if (!page || page.archivedAt !== null) return deny;

    const access = await getPageAccess(userSub, page);
    if (access.canView) return { allowed: true, readOnly: !access.canEdit };

    // Enrolled students co-edit a page explicitly marked studentEditable (a
    // shared "workspace" doc), but only while the offering is live. Enrollment
    // is the gate, not auth type, so this covers members and Dartmouth-portal
    // students alike — and getPageAccess doesn't model it.
    if (
      page.workspaceType === "EducationOffering" &&
      page.workspaceId &&
      page.studentEditable
    ) {
      const offering = await prisma.educationOffering.findUnique({
        where: { id: page.workspaceId },
        select: { status: true, closedOutAt: true },
      });
      if (offering?.status === "Published" && offering.closedOutAt === null) {
        const enrolled = await prisma.educationApplication.findFirst({
          where: {
            applicantUserId: userSub,
            offeringId: page.workspaceId,
            status: "Approved",
          },
          select: { id: true },
        });
        if (enrolled !== null) return { allowed: true, readOnly: false };
      }
    }
    return deny;
  }

  // eduassignment:{assignmentId}:instructions — edit gate = offering manager.
  if (entity === "eduassignment") {
    const assignment = await prisma.educationAssignment.findUnique({
      where: { id },
      select: { offeringId: true, session: { select: { offeringId: true } } },
    });
    if (!assignment) return deny;
    const offeringId = assignment.offeringId ?? assignment.session?.offeringId;
    if (!offeringId) return deny;
    if (await isCore(userSub)) return allow;
    const instructor = await prisma.instructorAssignment.findFirst({
      where: { userId: userSub, offeringId },
      select: { id: true },
    });
    return instructor !== null ? allow : deny;
  }

  // partnersow:{applicationId}:body — co-drafted SOW, intentionally editable
  // by both Core and the partner org. Not read-only for partners here.
  if (entity === "partnersow") {
    const application = await prisma.partnerApplication.findUnique({
      where: { id },
      select: { partnerOrgId: true },
    });
    if (!application) return deny;
    if (await isCore(userSub)) return allow;
    const partnerUser = await prisma.partnerUser.findUnique({
      where: { userId: userSub },
      select: { partnerOrgId: true },
    });
    return partnerUser?.partnerOrgId === application.partnerOrgId ? allow : deny;
  }

  // task:{taskId}:description — same gate as the task's project.
  if (entity === "task") {
    const task = await prisma.task.findUnique({
      where: { id },
      select: { projectId: true },
    });
    if (!task) return deny;
    if (await isCore(userSub)) return allow;
    return (await isProjectMember(userSub, task.projectId)) ? allow : deny;
  }

  // epic:{descriptionDocId}:description — Core only.
  if (entity === "epic") {
    const epic = await prisma.epic.findFirst({
      where: { descriptionDocId: id },
      select: { id: true },
    });
    if (!epic) return deny;
    return (await isCore(userSub)) ? allow : deny;
  }

  // eduoffering:{offeringId}:description — Core or instructor.
  if (entity === "eduoffering") {
    const offering = await prisma.educationOffering.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!offering) return deny;
    if (await isCore(userSub)) return allow;
    const instructor = await prisma.instructorAssignment.findFirst({
      where: { userId: userSub, offeringId: id },
      select: { id: true },
    });
    return instructor !== null ? allow : deny;
  }

  // edusubmission:{submissionId}:content|feedback — collaborative assignment
  // submission (student-owned "content" doc) and instructor feedback
  // ("feedback" doc). The field segment decides which side may edit: the
  // student edits their own content and reads feedback via the hub; the
  // instructor edits feedback and may open the content doc to review/annotate.
  if (entity === "edusubmission") {
    const submission = await prisma.educationSubmission.findUnique({
      where: { id },
      select: {
        studentId: true,
        assignment: {
          select: { offeringId: true, session: { select: { offeringId: true } } },
        },
      },
    });
    if (!submission) return deny;
    const offeringId =
      submission.assignment.offeringId ?? submission.assignment.session?.offeringId;
    if (!offeringId) return deny;
    if (await isCore(userSub)) return allow;
    const isInstructor =
      (await prisma.instructorAssignment.findFirst({
        where: { userId: userSub, offeringId },
        select: { id: true },
      })) !== null;
    if (field === "feedback") return isInstructor ? allow : deny;
    // content doc: the owning student, or an instructor reviewing it.
    return submission.studentId === userSub || isInstructor ? allow : deny;
  }

  // Registry-backed surfaces (mentorship notes/templates, …)
  const source = COLLAB_SOURCES[entity];
  if (source) {
    const allowed = await source.authorize(userSub, id);
    return { allowed, readOnly: false };
  }

  return deny;
}
