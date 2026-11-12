import { redirect } from "react-router";
import { redirectToLogin } from "~/lib/login-next";
import { requireAuth } from "~/lib/auth";
import { favoritePageIds } from "~/lib/user-pages.server";
import { isCore } from "~/lib/roles";
import { requireOfferingManager } from "~/education/lib/access.server";
import { getOfferingDetail } from "~/education/lib/offerings.server";
import { listApplications } from "~/education/lib/apply.server";
import { listMaterialPages, listWorkspaceDocs } from "~/education/lib/lms.server";
import QRCode from "qrcode";
import { isSessionCheckInOpen } from "~/education/lib/session-checkin.server";
import { listAssignments } from "~/education/lib/assignments.server";
import { listDiscussion } from "~/education/lib/announcements.server";
import {
  listEducationEmails,
} from "~/education/lib/education-emails.server";
import { getAttendanceMatrix, getSessionRoster } from "~/education/lib/attendance.server";
import { notesForOffering } from "~/education/lib/student-notes.server";
import { listCertificateTemplates, getOfferingCertificateBinding } from "~/education/lib/certificate-templates.server";
import { certificateEligibility } from "~/education/lib/certificates.server";
import { listFeedbackResults, SESSION_FEEDBACK_SLOT, INSTRUCTOR_EXIT_SLOT } from "~/education/lib/feedback.server";
import { prisma } from "~/lib/db.server";
import { getCollabToken } from "~/lib/collab-token.server";


export async function loadManageOffering(request: Request, offeringId: string) {
  const authOrRedirect = await requireAuth(request);
  if (!authOrRedirect.ok) return redirectToLogin(request);

  const gate = await requireOfferingManager(request, offeringId);
  if (!gate.ok) return redirect("/portal");

  const offering = await getOfferingDetail(offeringId);
  if (!offering) throw new Response("Not found", { status: 404 });

  // Roster tab: ?session= picks the session, defaulting to the first one.
  const requestedSessionId = new URL(request.url).searchParams.get("session");
  const rosterSessionId = requestedSessionId ?? offering.sessions[0]?.id ?? null;
  const roster = rosterSessionId
    ? await getSessionRoster(offeringId, rosterSessionId)
    : null;

  // Self-check-in for the selected session: its open state + a QR the instructor
  // projects for students to scan. One QR (just the selected session), so this
  // stays cheap regardless of how many sessions the offering has.
  const rosterSession = rosterSessionId
    ? offering.sessions.find((s) => s.id === rosterSessionId) ?? null
    : null;
  const checkInUrl = rosterSession
    ? `${new URL(request.url).origin}/education/check-in/${rosterSession.id}`
    : null;
  const checkInQrSvg = checkInUrl
    ? await QRCode.toString(checkInUrl, { type: "svg", margin: 1, width: 200 })
    : null;
  const sessionCheckIn = rosterSession
    ? {
        sessionId: rosterSession.id,
        open: isSessionCheckInOpen(rosterSession),
        checkInUrl,
        checkInQrSvg,
      }
    : null;

  const core = await isCore(gate.auth.user.sub);
  const [
    instructorCandidates,
    applications,
    educationEmails,
    materials,
    workspaceDocs,
    assignments,
    announcements,
    favoriteIds,
  ] = await Promise.all([
    core
      ? prisma.user.findMany({
          // Any lab member is eligible as an instructor — not just those active
          // in the current term. Alums, future-term members, and anyone not
          // staffed this cycle should still be addable.
          where: { daliMember: { isNot: null } },
          select: { id: true, firstName: true, lastName: true },
          orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        })
      : Promise.resolve([]),
    listApplications(offeringId),
    listEducationEmails(),
    listMaterialPages(offeringId),
    listWorkspaceDocs(offeringId),
    listAssignments(offeringId),
    listDiscussion(offeringId),
    favoritePageIds(gate.auth.user.sub),
  ]);

  // Uploaded file materials for this offering (S3-backed, not Page records).
  const offeringFiles = await prisma.projectFile.findMany({
    where: {
      workspaceType: "EducationOffering",
      workspaceId: offeringId,
      archivedAt: null,
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, folderPageId: true, sessionId: true },
  });

  const notes = await notesForOffering(offeringId);

  // Certificate template library + this offering's override (Core only; the
  // section itself is also gated on the certificate-templates flag client-side).
  const [certificateTemplates, certificateBinding] = core
    ? await Promise.all([
        listCertificateTemplates(),
        getOfferingCertificateBinding(offeringId),
      ])
    : [[], null];

  // Feedback bindings + results. Instructors see anonymized rows; Core may
  // see identities (moderation escape hatch).
  const [publishedForms, feedbackBindings, sessionFeedback, exitFeedback] =
    await Promise.all([
      prisma.form.findMany({
        where: { published: true, publicToken: { not: null } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.educationFormBinding.findMany({
        where: { offeringId: offeringId },
        select: { slot: true, formId: true },
      }),
      rosterSessionId
        ? listFeedbackResults({
            offeringId: offeringId,
            slot: SESSION_FEEDBACK_SLOT,
            sessionId: rosterSessionId,
            includeIdentities: core,
          })
        : Promise.resolve(null),
      core
        ? listFeedbackResults({
            offeringId: offeringId,
            slot: INSTRUCTOR_EXIT_SLOT,
            includeIdentities: true,
          })
        : Promise.resolve(null),
    ]);

  const attendanceMatrix = await getAttendanceMatrix(offeringId);

  // Instructors split by membership: members flow through the checkbox picker
  // (set-instructors), external Dartmouth instructors through the invite
  // controls below it. Both lists are Core-only (who owns the section).
  const memberInstructorRows = core
    ? await prisma.instructorAssignment.findMany({
        where: {
          offeringId: offeringId,
          user: { daliMember: { isNot: null } },
        },
        select: { userId: true },
      })
    : [];
  const externalInstructorRows = core
    ? await prisma.instructorAssignment.findMany({
        where: {
          offeringId: offeringId,
          user: { daliMember: { is: null } },
        },
        select: {
          userId: true,
          user: { select: { firstName: true, lastName: true } },
        },
      })
    : [];
  const memberInstructorIds = [
    ...new Set(memberInstructorRows.map((r) => r.userId)),
  ];
  const externalInstructors = Array.from(
    new Map(
      externalInstructorRows.map((r) => [
        r.userId,
        {
          userId: r.userId,
          name: `${r.user.firstName} ${r.user.lastName}`.trim(),
        },
      ]),
    ).values(),
  );

  // Performance view: submissions keyed by (studentId, assignmentId) for the
  // approved roster. Assignments already loaded above; this is just submissions.
  const approvedStudentIds = attendanceMatrix.students.map((s) => s.applicationId);
  // applicationId == student application id — fetch via applicantUserId.
  const approvedApplications = await prisma.educationApplication.findMany({
    where: {
      id: { in: approvedStudentIds },
    },
    select: { id: true, applicantUserId: true },
  });
  const studentIdByApp = new Map(approvedApplications.map((a) => [a.id, a.applicantUserId]));
  const studentUserIds = [...new Set(approvedApplications.map((a) => a.applicantUserId))];

  const submissionsForRoster =
    assignments.length > 0 && studentUserIds.length > 0
      ? await prisma.educationSubmission.findMany({
          where: {
            assignmentId: { in: assignments.map((a) => a.id) },
            studentId: { in: studentUserIds },
          },
          select: { assignmentId: true, studentId: true, grade: true, score: true },
        })
      : [];

  // Build a map: applicationId → (assignmentId → {grade, score}) for component use.
  // The matrix students are keyed by applicationId, so we translate via studentIdByApp.
  const userIdToAppId = new Map(
    approvedApplications.map((a) => [a.applicantUserId, a.id]),
  );
  const performanceByApp: Record<string, Record<string, { grade: string | null; score: number | null }>> = {};
  for (const sub of submissionsForRoster) {
    const appId = userIdToAppId.get(sub.studentId);
    if (!appId) continue;
    if (!performanceByApp[appId]) performanceByApp[appId] = {};
    performanceByApp[appId][sub.assignmentId] = { grade: sub.grade, score: sub.score };
  }

  return {
    publishedForms,
    feedbackBindings,
    sessionFeedback,
    exitFeedback,
    feedbackSessionId: rosterSessionId,
    offering,
    applications: applications.map((a) => ({
      ...a,
      note: notes.get(a.id)
        ? {
            feedback: notes.get(a.id)!.feedback,
            internalNote: notes.get(a.id)!.internalNote,
          }
        : null,
    })),
    roster,
    sessionCheckIn,
    attendanceMatrix,
    // Performance view data (plain — no Prisma types, safe to pass to client).
    performanceByApp,
    assignmentsForPerformance: assignments.map((a) => ({
      id: a.id,
      title: a.title,
      points: a.points,
    })),
    // Pre-computed completion eligibility per student (attendance-driven; scores are informational).
    completionByApp: Object.fromEntries(
      attendanceMatrix.students.map((st) => {
        const present = Object.values(st.marks).filter((m) => m === "Present").length;
        const excused = Object.values(st.marks).filter((m) => m === "Excused").length;
        return [
          st.applicationId,
          certificateEligibility({
            type: offering.type,
            totalSessions: attendanceMatrix.sessions.length,
            present,
            excused,
            threshold: offering.completionThreshold,
            minSessions: offering.completionMinSessions,
          }),
        ];
      }),
    ),
    materials,
    offeringFiles: offeringFiles.map((f) => ({
      id: f.id,
      title: f.title,
      folderPageId: f.folderPageId,
      sessionId: f.sessionId,
      href: `/documents/file/${f.id}`,
    })),
    workspaceDocs,
    favoriteIds: [...favoriteIds],
    assignments,
    // Discussion posts pass through whole — the component renders authors,
    // replies and the announcement/message distinction.
    announcements,
    // One email per slot, shared by every course. Keyed by slot so the editor
    // can tell "not written yet" (nothing sends) from an empty string.
    educationEmails: Object.fromEntries(
      educationEmails.map((e) => [e.slot, { subject: e.subject, body: e.body }]),
    ) as Record<string, { subject: string; body: string }>,
    isCore: core,
    certificateTemplates: certificateTemplates.map((t) => ({
      id: t.id,
      name: t.name,
      isDefault: t.isDefault,
    })),
    certificateBinding,
    instructorCandidates: instructorCandidates.map((u) => ({
      id: u.id,
      name: `${u.firstName} ${u.lastName}`.trim(),
    })),
    memberInstructorIds,
    externalInstructors,
    collabToken: await getCollabToken(request),
    userName: `${gate.auth.user.firstName ?? ""} ${gate.auth.user.lastName ?? ""}`.trim(),
    currentUserId: gate.auth.user.sub,
  };
}

export type ManageOfferingData = Exclude<Awaited<ReturnType<typeof loadManageOffering>>, Response>;
