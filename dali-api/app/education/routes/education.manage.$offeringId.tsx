import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  redirect,
  useLoaderData,
  useActionData,
  useSearchParams,
  Form,
  Link,
  useFetcher,
  useRevalidator,
} from "react-router";
import { Select, type SelectOption } from "~/components/ui/floating";
import { redirectToLogin } from "~/lib/login-next";
import type { Route } from "./+types/education.manage.$offeringId";
import { requireAuth } from "~/lib/auth";
import { favoritePageIds } from "~/lib/user-pages.server";
import { isCore } from "~/lib/roles";
import { requireOfferingManager } from "~/education/lib/access.server";
import {
  getOfferingDetail,
  runOfferingAction,
} from "~/education/lib/offerings.server";
import { listApplications } from "~/education/lib/apply.server";
import {
  decideApplication,
  approveAllPending,
  moveWaitlistEntry,
} from "~/education/lib/decisions.server";
import { isOfferingManager } from "~/education/lib/access.server";
import { ApplicationAnswers } from "~/education/components/ApplicationAnswers";
import { ApplicationsReview, WaitlistOrder } from "~/education/components/ApplicationsReview";
import { RosterMatrix } from "~/education/components/RosterMatrix";
import { InstructorPicker } from "~/education/components/InstructorPicker";
import { AddFormModal } from "~/education/components/AddFormModal";
import { OfferingDiscussion } from "~/education/components/OfferingDiscussion";
import {
  listMaterialPages,
  listWorkspaceDocs,
  createMaterialPage,
  moveMaterialPage,
  moveMaterialFile,
  renameMaterialPage,
  renameMaterialFile,
  archiveMaterialPage,
  archiveMaterialFile,
} from "~/education/lib/lms.server";
import QRCode from "qrcode";
import {
  isSessionCheckInOpen,
  setSessionCheckInOpen,
} from "~/education/lib/session-checkin.server";
import {
  listAssignments,
  createAssignment,
  updateAssignment,
  deleteAssignment,
} from "~/education/lib/assignments.server";
import {
  listDiscussion,
  postAnnouncement,
  deleteAnnouncement,
} from "~/education/lib/announcements.server";
import {
  listEducationEmails,
  saveEducationEmail,
} from "~/education/lib/education-emails.server";
import {
  DECISION_EMAIL_SLOTS,
  EDUCATION_EMAIL_VARIABLES,
  decisionSlot,
  unknownVariables,
  type DecisionSlotStatus,
  type EducationEmailSlot,
} from "~/education/lib/education-emails";
import {
  getAttendanceMatrix,
  getSessionRoster,
  saveAttendance,
} from "~/education/lib/attendance.server";
import { notesForOffering, upsertStudentNote } from "~/education/lib/student-notes.server";
import {
  listCertificateTemplates,
  getOfferingCertificateBinding,
  bindOfferingCertificateTemplate,
} from "~/education/lib/certificate-templates.server";
import { closeOutOffering, reopenOffering, previewCloseOut, certificateEligibility } from "~/education/lib/certificates.server";
import {
  setFormBinding,
  listFeedbackResults,
  SESSION_FEEDBACK_SLOT,
  INSTRUCTOR_EXIT_SLOT,
} from "~/education/lib/feedback.server";
import {
  ManageMaterials,
  ManageAssignments,
  ManageAnnouncements,
} from "~/education/components/ManageCourseContent";
import type { Question } from "~/types";
import type {
  AttendanceStatus,
  EduApplicationStatus,
  SubmissionType,
} from "~/generated/prisma/client";
import { prisma } from "~/lib/db";
import { parseSessionCookie } from "~/lib/cookies";
import { Button, buttonClasses } from "~/components/ui/Button";
import { Avatar } from "~/components/ui/Avatar";
import { Upload, X } from "lucide-react";
import { Modal, ModalHeader, ModalFooter } from "~/components/Modal";
import { modalCardClass, useOsChrome } from "~/components/os-chrome";
import { isMultiSession } from "~/education/lib/offering-type";
import { renderEmail } from "~/lib/email";
import { uploadFileToS3 } from "~/lib/upload-client";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { TypeBadge, StatusBadge, MyStatusChip } from "~/education/components/OfferingCard";
import { OfferingFields, toDatetimeLocal } from "~/education/components/OfferingFields";
import { DocEditor } from "~/components/doc";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { DateField } from "~/components/ui/DateField";
import { formatDateTime, formatDateShort, formatSessionWhen } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { cn } from "~/lib/cn";
import { InfoTip } from "~/components/ui/floating";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `Manage ${data?.offering.title ?? "Offering"} · DALI OS` },
];

export const handle = {
  // Offering pages name themselves in their own headers, so the trail above
  // them only repeated where you already are.
  hideBreadcrumbs: true,
  // The page fills the shell's main column instead of growing the document:
  // the title, badges and tab strip stay put and each tab's content scrolls
  // under them. Sessions needs it (its side nav has to stay beside the cards),
  // and every other tab reads better for it. Desktop only — below `md` the
  // shell isn't height-capped, so the page scrolls normally there.
  fitViewport: true,
  breadcrumb: (data: { offering: { title: string } } | undefined) =>
    data?.offering.title ?? "Offering",
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const authOrRedirect = await requireAuth(request);
  if (!authOrRedirect.ok) return redirectToLogin(request);

  const gate = await requireOfferingManager(request, params.offeringId!);
  if (!gate.ok) return redirect("/portal");

  const offering = await getOfferingDetail(params.offeringId!);
  if (!offering) throw new Response("Not found", { status: 404 });

  // Roster tab: ?session= picks the session, defaulting to the first one.
  const requestedSessionId = new URL(request.url).searchParams.get("session");
  const rosterSessionId = requestedSessionId ?? offering.sessions[0]?.id ?? null;
  const roster = rosterSessionId
    ? await getSessionRoster(params.offeringId!, rosterSessionId)
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
    listApplications(params.offeringId!),
    listEducationEmails(),
    listMaterialPages(params.offeringId!),
    listWorkspaceDocs(params.offeringId!),
    listAssignments(params.offeringId!),
    listDiscussion(params.offeringId!),
    favoritePageIds(gate.auth.user.sub),
  ]);

  // Uploaded file materials for this offering (S3-backed, not Page records).
  const offeringFiles = await prisma.projectFile.findMany({
    where: {
      workspaceType: "EducationOffering",
      workspaceId: params.offeringId!,
      archivedAt: null,
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, folderPageId: true, sessionId: true },
  });

  const notes = await notesForOffering(params.offeringId!);

  // Certificate template library + this offering's override (Core only; the
  // section itself is also gated on the certificate-templates flag client-side).
  const [certificateTemplates, certificateBinding] = core
    ? await Promise.all([
        listCertificateTemplates(),
        getOfferingCertificateBinding(params.offeringId!),
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
        where: { offeringId: params.offeringId! },
        select: { slot: true, formId: true },
      }),
      rosterSessionId
        ? listFeedbackResults({
            offeringId: params.offeringId!,
            slot: SESSION_FEEDBACK_SLOT,
            sessionId: rosterSessionId,
            includeIdentities: core,
          })
        : Promise.resolve(null),
      core
        ? listFeedbackResults({
            offeringId: params.offeringId!,
            slot: INSTRUCTOR_EXIT_SLOT,
            includeIdentities: true,
          })
        : Promise.resolve(null),
    ]);

  const attendanceMatrix = await getAttendanceMatrix(params.offeringId!);

  // Instructors split by membership: members flow through the checkbox picker
  // (set-instructors), external Dartmouth instructors through the invite
  // controls below it. Both lists are Core-only (who owns the section).
  const memberInstructorRows = core
    ? await prisma.instructorAssignment.findMany({
        where: {
          offeringId: params.offeringId!,
          user: { daliMember: { isNot: null } },
        },
        select: { userId: true },
      })
    : [];
  const externalInstructorRows = core
    ? await prisma.instructorAssignment.findMany({
        where: {
          offeringId: params.offeringId!,
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
    collabToken: parseSessionCookie(request),
    userName: `${gate.auth.user.firstName ?? ""} ${gate.auth.user.lastName ?? ""}`.trim(),
    currentUserId: gate.auth.user.sub,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const formData = await request.formData();

  const intent = String(formData.get("intent") ?? "");
  const contentIntents = [
    "decide-application",
    "move-waitlist-entry",
    "create-page",
    "move-page",
    "move-file",
    "rename-page",
    "rename-file",
    "delete-page",
    "delete-file",
    "set-material-session",
    "set-file-session",
    "create-assignment",
    "update-assignment",
    "delete-assignment",
    "post-announcement",
    "delete-announcement",
    "save-attendance",
    "set-session-check-in",
    "save-student-note",
    "close-out-offering",
    "reopen-offering",
    "set-form-binding",
    "bind-certificate-template",
  ];
  if (contentIntents.includes(intent)) {
    if (!(await isOfferingManager(auth.user.sub, params.offeringId!)))
      return Response.json({ error: "Forbidden" }, { status: 403 });

    const fail = (r: { error: string; status: number }) =>
      Response.json({ error: r.error }, { status: r.status });

    switch (intent) {
      case "decide-application": {
        // decideApplication self-scopes to offeringId, so a manager of another
        // offering can't act on this application.
        const result = await decideApplication({
          applicationId: String(formData.get("applicationId") ?? ""),
          offeringId: params.offeringId!,
          status: String(formData.get("status")) as EduApplicationStatus,
          actorId: auth.user.sub,
        });
        return "error" in result ? fail(result) : { ok: true };
      }
      case "approve-all-pending": {
        const result = await approveAllPending({
          offeringId: params.offeringId!,
          actorId: auth.user.sub,
        });
        return { ok: true, bulkApprove: result };
      }
      case "move-waitlist-entry": {
        const result = await moveWaitlistEntry({
          applicationId: String(formData.get("applicationId") ?? ""),
          offeringId: params.offeringId!,
          direction: formData.get("direction") === "up" ? "up" : "down",
          actorId: auth.user.sub,
        });
        return "error" in result ? fail(result) : { ok: true };
      }
      case "move-page": {
        const result = await moveMaterialPage({
          offeringId: params.offeringId!,
          pageId: String(formData.get("pageId") ?? ""),
          parentPageId: String(formData.get("parentPageId") ?? "") || null,
          actorId: auth.user.sub,
        });
        return "error" in result ? fail(result) : { ok: true };
      }
      case "move-file": {
        const result = await moveMaterialFile({
          offeringId: params.offeringId!,
          fileId: String(formData.get("fileId") ?? ""),
          folderId: String(formData.get("folderId") ?? "") || null,
          actorId: auth.user.sub,
        });
        return "error" in result ? fail(result) : { ok: true };
      }
      case "rename-page": {
        const result = await renameMaterialPage({
          offeringId: params.offeringId!,
          pageId: String(formData.get("pageId") ?? ""),
          title: String(formData.get("title") ?? ""),
          actorId: auth.user.sub,
        });
        return "error" in result ? fail(result) : { ok: true };
      }
      case "rename-file": {
        const result = await renameMaterialFile({
          offeringId: params.offeringId!,
          fileId: String(formData.get("fileId") ?? ""),
          title: String(formData.get("title") ?? ""),
          actorId: auth.user.sub,
        });
        return "error" in result ? fail(result) : { ok: true };
      }
      case "delete-page": {
        const result = await archiveMaterialPage({
          offeringId: params.offeringId!,
          pageId: String(formData.get("pageId") ?? ""),
          actorId: auth.user.sub,
        });
        return "error" in result ? fail(result) : { ok: true };
      }
      case "delete-file": {
        const result = await archiveMaterialFile({
          offeringId: params.offeringId!,
          fileId: String(formData.get("fileId") ?? ""),
          actorId: auth.user.sub,
        });
        return "error" in result ? fail(result) : { ok: true };
      }
      case "set-session-check-in": {
        const result = await setSessionCheckInOpen({
          offeringId: params.offeringId!,
          sessionId: String(formData.get("sessionId") ?? ""),
          open: formData.get("open") === "true",
          actorId: auth.user.sub,
        });
        return "error" in result ? fail(result) : { ok: true };
      }
      case "create-page": {
        const result = await createMaterialPage({
          offeringId: params.offeringId!,
          title: String(formData.get("title") ?? ""),
          parentPageId: String(formData.get("parentPageId") ?? "") || null,
          studentEditable: formData.get("studentEditable") === "true",
          kind: formData.get("kind") === "Folder" ? "Folder" : "FreeForm",
          sessionId: String(formData.get("sessionId") ?? "") || null,
          actorId: auth.user.sub,
        });
        return "error" in result ? fail(result) : { ok: true };
      }
      case "set-material-session": {
        const pageId = String(formData.get("pageId") ?? "");
        const sessionId = String(formData.get("sessionId") ?? "") || null;
        // Guard: page must belong to this offering's workspace.
        const page = await prisma.page.findUnique({
          where: { id: pageId },
          select: { workspaceType: true, workspaceId: true },
        });
        if (
          !page ||
          page.workspaceType !== "EducationOffering" ||
          page.workspaceId !== params.offeringId
        ) {
          return Response.json({ error: "Page not found" }, { status: 404 });
        }
        await prisma.page.update({ where: { id: pageId }, data: { sessionId } });
        return { ok: true };
      }
      case "set-file-session": {
        const fileId = String(formData.get("fileId") ?? "");
        const sessionId = String(formData.get("sessionId") ?? "") || null;
        // Guard: file must belong to this offering's workspace.
        const file = await prisma.projectFile.findUnique({
          where: { id: fileId },
          select: { workspaceType: true, workspaceId: true },
        });
        if (
          !file ||
          file.workspaceType !== "EducationOffering" ||
          file.workspaceId !== params.offeringId
        ) {
          return Response.json({ error: "File not found" }, { status: 404 });
        }
        await prisma.projectFile.update({ where: { id: fileId }, data: { sessionId } });
        return { ok: true };
      }
      case "create-assignment": {
        const dueAtRaw = String(formData.get("dueAt") ?? "");
        const pointsRaw = String(formData.get("points") ?? "");
        const pointsParsed = pointsRaw ? parseInt(pointsRaw, 10) : null;
        const result = await createAssignment({
          offeringId: params.offeringId!,
          sessionId: String(formData.get("sessionId") ?? "") || null,
          title: String(formData.get("title") ?? ""),
          dueAt: dueAtRaw ? new Date(dueAtRaw) : null,
          submissionType: String(formData.get("submissionType")) as SubmissionType,
          points: pointsParsed != null && pointsParsed >= 1 ? pointsParsed : null,
          actorId: auth.user.sub,
        });
        return "error" in result ? fail(result) : { ok: true };
      }
      case "update-assignment": {
        const dueAtRaw = String(formData.get("dueAt") ?? "");
        const pointsRaw = String(formData.get("points") ?? "");
        const pointsParsed = pointsRaw ? parseInt(pointsRaw, 10) : null;
        const result = await updateAssignment({
          assignmentId: String(formData.get("assignmentId") ?? ""),
          offeringId: params.offeringId!,
          title: String(formData.get("title") ?? ""),
          dueAt: dueAtRaw ? new Date(dueAtRaw) : null,
          submissionType: String(formData.get("submissionType")) as SubmissionType,
          points: pointsParsed != null && pointsParsed >= 1 ? pointsParsed : null,
          actorId: auth.user.sub,
        });
        return "error" in result ? fail(result) : { ok: true };
      }
      case "delete-assignment": {
        const result = await deleteAssignment({
          assignmentId: String(formData.get("assignmentId") ?? ""),
          offeringId: params.offeringId!,
          actorId: auth.user.sub,
        });
        return "error" in result ? fail(result) : { ok: true };
      }
      case "post-announcement": {
        const result = await postAnnouncement({
          offeringId: params.offeringId!,
          authorId: auth.user.sub,
          body: String(formData.get("body") ?? ""),
          kind: formData.get("kind") === "Message" ? "Message" : "Announcement",
          parentId: String(formData.get("parentId") ?? "") || null,
        });
        return "error" in result ? fail(result) : { ok: true };
      }
      case "delete-announcement": {
        // Manager-gated by the contentIntents check above, so isManager holds.
        const result = await deleteAnnouncement({
          postId: String(formData.get("postId") ?? ""),
          offeringId: params.offeringId!,
          actorId: auth.user.sub,
          isManager: true,
        });
        return "error" in result ? fail(result) : { ok: true };
      }
      case "set-form-binding": {
        const result = await setFormBinding({
          offeringId: params.offeringId!,
          slot: String(formData.get("slot") ?? ""),
          formId: String(formData.get("formId") ?? "") || null,
          actorId: auth.user.sub,
        });
        return "error" in result ? fail(result) : { ok: true };
      }
      case "bind-certificate-template": {
        // Template management is Core-only (matches who owns the library).
        if (!(await isCore(auth.user.sub)))
          return Response.json({ error: "Forbidden" }, { status: 403 });
        const result = await bindOfferingCertificateTemplate({
          offeringId: params.offeringId!,
          templateId: String(formData.get("templateId") ?? "") || null,
        });
        return "error" in result ? fail(result) : { ok: true };
      }
      case "preview-close-out": {
        const preview = await previewCloseOut(params.offeringId!);
        return { ok: true, closeOutPreview: preview };
      }
      case "close-out-offering": {
        const result = await closeOutOffering({
          offeringId: params.offeringId!,
          actorId: auth.user.sub,
          // The button only appears after a confirm dialog that warns when the
          // course hasn't finished, so an operator reaching here has consciously
          // chosen to close out — let the intentional early close-out through.
          allowEarly: formData.get("allowEarly") === "true",
        });
        if ("error" in result) return fail(result);
        return {
          ok: true,
          closeOut: {
            issued: result.issued,
            alreadyIssued: result.alreadyIssued,
            ineligible: result.ineligible,
          },
        };
      }
      case "reopen-offering": {
        const result = await reopenOffering({
          offeringId: params.offeringId!,
          actorId: auth.user.sub,
        });
        if ("error" in result) return fail(result);
        return { ok: true, reopened: true };
      }
      case "save-student-note": {
        const applicationId = String(formData.get("applicationId") ?? "");
        const application = await prisma.educationApplication.findUnique({
          where: { id: applicationId },
          select: { offeringId: true },
        });
        if (!application || application.offeringId !== params.offeringId)
          return Response.json({ error: "Application not found" }, { status: 404 });
        const result = await upsertStudentNote({
          applicationId,
          actorId: auth.user.sub,
          feedback: String(formData.get("feedback") ?? ""),
          internalNote: String(formData.get("internalNote") ?? ""),
        });
        return "error" in result ? fail(result) : { ok: true };
      }
      case "save-attendance": {
        // One `mark-<applicationId>` field per roster row; "" clears the mark.
        const marks: { applicationId: string; status: AttendanceStatus | null }[] = [];
        for (const [key, value] of formData.entries()) {
          if (!key.startsWith("mark-")) continue;
          marks.push({
            applicationId: key.slice("mark-".length),
            status: value === "" ? null : (String(value) as AttendanceStatus),
          });
        }
        const result = await saveAttendance({
          offeringId: params.offeringId!,
          sessionId: String(formData.get("sessionId") ?? ""),
          marks,
          actorId: auth.user.sub,
        });
        return "error" in result ? fail(result) : { ok: true };
      }
    }
  }

  // One email per slot, shared by every course — so it isn't an offering
  // action. Core owns lab-wide copy, the same rule the certificate-template
  // binding on this page follows; an invited instructor manages their course,
  // not the words every course sends.
  if (intent === "save-education-email") {
    if (!(await isCore(auth.user.sub)))
      return Response.json({ error: "Forbidden" }, { status: 403 });
    const slot = String(formData.get("slot") ?? "");
    if (!DECISION_EMAIL_SLOTS.some((d) => decisionSlot(d.status) === slot))
      return Response.json({ error: "Unknown email" }, { status: 400 });
    await saveEducationEmail(
      slot as EducationEmailSlot,
      {
        subject: String(formData.get("subject") ?? ""),
        body: String(formData.get("body") ?? ""),
      },
      auth.user.sub,
    );
    return { ok: true };
  }

  // Pin the offering id from the URL so a form can't retarget another offering.
  formData.set("offeringId", params.offeringId!);
  const result = await runOfferingAction(formData, auth.user.sub);
  if ("error" in result)
    return Response.json({ error: result.error }, { status: result.status });
  if (formData.get("intent") === "delete-offering") return redirect("/education/offerings");
  if (formData.get("intent") === "duplicate-offering" && "id" in result && result.id)
    return redirect(`/education/manage/${result.id}`);
  return result;
}

const TABS = [
  { key: "details", label: "Details" },
  { key: "sessions", label: "Sessions" },
  { key: "applications", label: "Applications" },
  { key: "roster", label: "Roster" },
  { key: "materials", label: "Materials" },
  { key: "assignments", label: "Assignments" },
  { key: "announcements", label: "Discussion" },
  { key: "feedback", label: "Feedback" },
] as const;

// Weekday chips for the "Generate a session series" picker. Index === JS
// getDay() (0 = Sunday), so the checkbox value maps straight to the weekday the
// server schedules on.
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

// A notice the page posts back after an action. One surface, one shape: the
// old green-50 chip was a brand-shell colour that read as a foreign sticker on
// the os page.
const NOTICE_CLASS =
  "rounded-os-item bg-os-well px-4 py-3 text-sm text-foreground";

// Every block on this page is a titled section: the title and its explanation
// sit on the page ground, and only the thing you operate on is boxed. Stacking
// eight self-titled cards instead made the page read as a column of boxes, with
// each heading trapped inside its own border.
function ManageSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** Pinned to the title's right — a "Manage templates" link, a Save button. */
  action?: ReactNode;
  children: ReactNode;
}) {
  const os = useOsChrome();
  return (
    <section className={os.sectionShell}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 className={os.sectionTitle}>{title}</h2>
          {description && (
            <p className={cn(os.bodyText, "mt-1 max-w-2xl")}>{description}</p>
          )}
        </div>
        {action}
      </div>
      <div className={cn(os.panel, os.panelPad)}>{children}</div>
    </section>
  );
}

// A row nested inside one of those panels: an instructor, an email slot, a
// feedback binding. The design sinks them into a well rather than drawing a
// second border inside the card.
const WELL_ROW_CLASS =
  "flex items-center justify-between gap-3 rounded-os-item bg-os-well px-4 py-3";

// A stacked field: caption above control. The caption itself wears
// `.os-field-label`, the design's 11px uppercase cap, so this only owns the
// column — and `os-form` on the enclosing form dresses the control.
const FIELD_COL = "flex flex-col gap-2";


export default function ManageOffering() {
  const {
    offering,
    applications,
    roster,
    sessionCheckIn,
    attendanceMatrix,
    materials,
    offeringFiles,
    workspaceDocs,
    favoriteIds,
    assignments,
    announcements,
    educationEmails,
    publishedForms,
    feedbackBindings,
    sessionFeedback,
    exitFeedback,
    feedbackSessionId,
    isCore: core,
    certificateTemplates,
    certificateBinding,
    instructorCandidates,
    memberInstructorIds,
    externalInstructors,
    collabToken,
    userName,
    currentUserId,
    performanceByApp,
    assignmentsForPerformance,
    completionByApp,
  } = useLoaderData<typeof loader>();
  const tz = useUserTimeZone();
  const confirmSubmit = useConfirmSubmit();
  const certTemplatesOn = useFeatureFlag("certificate-templates");
  const actionData = useActionData<{
    error?: string;
    closeOut?: { issued: number; alreadyIssued: number; ineligible: number };
    closeOutPreview?: { eligible: string[]; belowThreshold: string[]; alreadyIssued: number } | null;
    reopened?: boolean;
    bulkApprove?: { approved: number; skipped: number };
  }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [addSessionOpen, setAddSessionOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const tab = searchParams.get("tab") ?? "details";

  const [appFilter, setAppFilter] = useState("all");
  const appCounts = applications.reduce<Record<string, number>>((m, a) => {
    m[a.status] = (m[a.status] ?? 0) + 1;
    return m;
  }, {});
  const filteredApps =
    appFilter === "all"
      ? applications
      : applications.filter((a) => a.status === appFilter);

  // Publishing is a toggle. Archiving isn't a button of its own any more:
  // close-out archives, and Reopen brings it back — so a closed-out course
  // shows Reopen instead of a publish toggle that would contradict it.
  const publishToggle: { to: string; label: string; variant: "primary" | "secondary" } | null =
    offering.closedOutAt
      ? null
      : offering.status === "Published"
        ? { to: "Draft", label: "Unpublish", variant: "secondary" }
        : { to: "Published", label: "Publish", variant: "primary" };

  // Close-out completes the course (issues certificates, emails students). If it
  // hasn't finished running yet, warn hard in the confirm dialog before letting
  // an operator proceed — closing early is what strands an offering in the "Past
  // offerings" bucket before it ever happens.
  const hasEnded =
    offering.endsAt != null && new Date(offering.endsAt).getTime() < Date.now();
  const closeOutConfirm = hasEnded
    ? {
        title: "Close out this course?",
        description:
          "Certificates are issued to every approved student meeting the attendance threshold, and each gets an email. The course is archived. Re-running only issues missing certificates.",
        confirmLabel: "Close out",
      }
    : {
        title: "Close out before it's finished?",
        description: `This course ${offering.endsAt ? `runs until ${formatDateShort(offering.endsAt, tz)} and ` : ""}hasn't finished yet. Closing out now issues certificates to everyone who has already met the attendance threshold and emails them. Anyone still to attend is left out, and the course is archived. You can reopen it afterward.`,
        confirmLabel: "Close out anyway",
      };

  // Per-session rollups so the Sessions tab connects to the rest of the offering
  // (attendance, materials, assignments) instead of being a bare date list.
  const totalRosterStudents = attendanceMatrix.students.length;
  const presentBySession = new Map<string, number>();
  for (const s of attendanceMatrix.sessions) {
    presentBySession.set(
      s.id,
      attendanceMatrix.students.filter((st) => st.marks[s.id] === "Present").length,
    );
  }
  // Pages and uploaded files are one thing to an instructor ("the material for
  // week 3"), and both carry a sessionId, so the session card treats them as
  // one list and remembers which intent each needs on the way back.
  const allMaterials: {
    id: string;
    title: string;
    kind: "page" | "file";
    sessionId: string | null;
    href: string;
  }[] = [];
  for (const top of materials) {
    // A folder holds material, it isn't material — only its children (and
    // top-level pages, which are never folders when isFolder is false) attach
    // to a session.
    for (const m of [...(top.isFolder ? [] : [top]), ...top.children]) {
      allMaterials.push({
        id: m.id,
        title: m.title,
        kind: "page",
        sessionId: m.sessionId,
        href: `/documents/${m.id}`,
      });
    }
  }
  for (const f of offeringFiles) {
    allMaterials.push({
      id: f.id,
      title: f.title,
      kind: "file",
      sessionId: f.sessionId,
      href: f.href,
    });
  }
  const assignmentsBySession = new Map<string, { id: string; title: string }[]>();
  for (const a of assignments) {
    if (!a.sessionId) continue;
    const list = assignmentsBySession.get(a.sessionId) ?? [];
    list.push({ id: a.id, title: a.title });
    assignmentsBySession.set(a.sessionId, list);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          {/* Title first: the badges qualify the offering, so they read better
              under its name than as an eyebrow above it. */}
          <h1 className="font-heading text-4xl font-medium text-foreground">
            {offering.title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <TypeBadge type={offering.type} />
            <StatusBadge status={offering.status} />
            <span className="text-sm text-os-grey">
              {offering.approvedCount} of {offering.capacity} seats filled
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to={`/education/${offering.id}/hub?as=student`}
            className={buttonClasses("ghost", "sm")}
          >
            Student view
          </Link>
          {publishToggle && (
            <Form method="post">
              <input type="hidden" name="intent" value="set-status" />
              <input type="hidden" name="status" value={publishToggle.to} />
              <Button type="submit" variant={publishToggle.variant} size="sm">
                {publishToggle.label}
              </Button>
            </Form>
          )}
          <Form method="post" onSubmit={confirmSubmit(closeOutConfirm)}>
            <input type="hidden" name="intent" value="close-out-offering" />
            {/* The confirm dialog above warns when the course hasn't finished, so
                a submit that reaches the action is a deliberate close-out. */}
            <input type="hidden" name="allowEarly" value="true" />
            <Button type="submit" variant="secondary" size="sm">
              {offering.closedOutAt ? "Re-run close-out" : "Close out course"}
            </Button>
          </Form>
          {offering.closedOutAt && (
            <Form
              method="post"
              onSubmit={confirmSubmit({
                title: "Reopen this course?",
                description:
                  "This unarchives the course and clears the close-out, so it leaves Past offerings and can be edited and closed out again later. Certificates already issued stay valid.",
                confirmLabel: "Reopen",
              })}
            >
              <input type="hidden" name="intent" value="reopen-offering" />
              <Button type="submit" variant="ghost" size="sm">
                Reopen
              </Button>
            </Form>
          )}
        </div>
      </header>

      {actionData?.error && (
        <p className="rounded-os-item bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {actionData.error}
        </p>
      )}
      {actionData?.closeOut && (
        <p className={NOTICE_CLASS}>
          Close-out complete: {actionData.closeOut.issued} certificate
          {actionData.closeOut.issued === 1 ? "" : "s"} issued
          {actionData.closeOut.alreadyIssued > 0 &&
            `, ${actionData.closeOut.alreadyIssued} already issued`}
          {actionData.closeOut.ineligible > 0 &&
            `, ${actionData.closeOut.ineligible} below the attendance threshold`}
          .
        </p>
      )}
      {actionData?.reopened && (
        <p className={NOTICE_CLASS}>
          Course reopened — it's back in the active catalog and can be edited.
        </p>
      )}
      {actionData?.closeOutPreview && (
        <div className="flex flex-col gap-1 rounded-os-card bg-os-card px-5 py-4 text-sm">
          <p className="font-semibold text-foreground">
            Close-out preview — {actionData.closeOutPreview.eligible.length} would get a
            certificate
            {actionData.closeOutPreview.alreadyIssued > 0 &&
              `, ${actionData.closeOutPreview.alreadyIssued} already issued`}
            {actionData.closeOutPreview.belowThreshold.length > 0 &&
              `, ${actionData.closeOutPreview.belowThreshold.length} below threshold`}
            .
          </p>
          {actionData.closeOutPreview.belowThreshold.length > 0 && (
            <p className="text-xs text-amber-700">
              Below threshold: {actionData.closeOutPreview.belowThreshold.join(", ")}
            </p>
          )}
        </div>
      )}
      {actionData?.bulkApprove && (
        <p className={NOTICE_CLASS}>
          Approved {actionData.bulkApprove.approved} pending application
          {actionData.bulkApprove.approved === 1 ? "" : "s"}
          {actionData.bulkApprove.skipped > 0 &&
            ` — ${actionData.bulkApprove.skipped} left (capacity reached)`}
          .
        </p>
      )}

      {/* Underlined tabs on the page ground: eight sections is too many for a
          filled segmented track, which stretches each one into a wide chip. */}
      {/* Every tab draws its own 2px rule and a trailing spacer carries it to
          the edge, so the underline is one continuous line. Laying the rule on
          a wrapper and pulling the row over it leaves the line half-covered
          under each tab and full-strength in the gaps between them.
          The active colour is inline because app.css sets `* { border-color }`
          outside any layer, and an unlayered rule outranks every Tailwind
          border-colour utility — see the note in the PR/summary. Inactive tabs
          take that same global default, which is the grey we want. */}
      <nav className="flex overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setSearchParams({ tab: t.key }, { preventScrollReset: true })}
            style={
              tab === t.key
                ? { borderBottomColor: "var(--color-os-accent)" }
                : undefined
            }
            className={cn(
              "shrink-0 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold transition",
              tab === t.key
                ? "text-os-accent"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
        <span aria-hidden className="flex-1 border-b-2" />
      </nav>

      {/* One scroll region for whichever tab is open. `min-h-0` is what lets a
          flex child actually shrink below its content and scroll. */}
      <div className="flex min-h-0 flex-1 flex-col md:overflow-y-auto md:pr-1">
      {tab === "details" && (
        <div className="flex flex-col gap-6">
          {offering.applicationFormId && (
            <ManageSection
              title="Application form"
              description="What applicants answer. Fillers always see the latest saved version."
              action={
                <Link
                  to={`/forms/edit/${offering.applicationFormId}`}
                  className={cn(buttonClasses("secondary", "sm"), "shrink-0")}
                >
                  Edit form
                </Link>
              }
            >
              <p className="text-sm text-os-grey">
                Lives in Drive under Education, with this course.
              </p>
            </ManageSection>
          )}

          <ManageSection title="Course details">
            <Form method="post" className="os-form flex flex-col gap-4">
              <input type="hidden" name="intent" value="update-offering" />
              <OfferingFields values={offering} typeLocked />
              <div className="flex justify-end">
                <Button type="submit">Save details</Button>
              </div>
            </Form>
          </ManageSection>

          <ManageSection title="Description">
            {collabToken && offering.descriptionDocId ? (
              <PresenceProvider
                pageId={`eduoffering:${offering.id}`}
                token={collabToken}
                userName={userName}
              >
                <DocEditor
                  features="notes"
                  aiEnabled
                  collab={{
                    documentName: offering.descriptionDocId,
                    token: collabToken,
                    userName,
                  }}
                  placeholder="What this offering covers, who it's for, what attendees build…"
                  className="rounded-os-item bg-os-well"
                />
              </PresenceProvider>
            ) : (
              <p className="text-sm italic text-os-grey">
                Sign in again to edit the description.
              </p>
            )}
          </ManageSection>

          {core && (
            <>
              <ManageSection
                title="Instructors"
              >
                <Form method="post" className="os-form">
                  <input type="hidden" name="intent" value="set-instructors" />
                  <InstructorPicker
                    candidates={instructorCandidates}
                    initialSelectedIds={memberInstructorIds}
                  />
                  <div className="mt-4 flex justify-end">
                    <Button type="submit" variant="secondary">
                      Save instructors
                    </Button>
                  </div>
                </Form>
              </ManageSection>

              <ManageSection
                title="External instructors"
              >
                {externalInstructors.length > 0 && (
                  <ul className="mb-4 flex flex-col gap-2">
                    {externalInstructors.map((x) => (
                      <li key={x.userId} className={WELL_ROW_CLASS}>
                        <span className="inline-flex min-w-0 items-center gap-2 text-sm text-foreground">
                          <Avatar name={x.name} size="xs" />
                          <span className="truncate">{x.name}</span>
                          <span className="rounded-full bg-os-container px-2 py-0.5 text-[11px] font-medium text-os-grey">
                            External
                          </span>
                        </span>
                        <Form method="post">
                          <input
                            type="hidden"
                            name="intent"
                            value="remove-external-instructor"
                          />
                          <input type="hidden" name="userId" value={x.userId} />
                          <button
                            type="submit"
                            aria-label={`Remove ${x.name}`}
                            className="os-icon-btn hover:text-destructive"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </Form>
                      </li>
                    ))}
                  </ul>
                )}

                <Form
                  method="post"
                  className="os-form flex flex-col gap-3 sm:flex-row sm:items-center"
                >
                  <input
                    type="hidden"
                    name="intent"
                    value="invite-external-instructor"
                  />
                  <div className="flex flex-1 flex-col gap-3 sm:flex-row">
                    <input
                      type="text"
                      name="firstName"
                      required
                      placeholder="First name"
                      className="w-full"
                    />
                    <input
                      type="text"
                      name="lastName"
                      required
                      placeholder="Last name"
                      className="w-full"
                    />
                    <input
                      type="text"
                      name="netId"
                      required
                      placeholder="NetID"
                      className="w-full sm:max-w-[9rem]"
                    />
                  </div>
                  <Button type="submit" variant="secondary">
                    Invite
                  </Button>
                </Form>
              </ManageSection>
            </>
          )}

          {core && (
            <ManageSection
              title="Decision emails"
            >
              <div className="flex flex-col gap-2">
                {DECISION_EMAIL_SLOTS.map((slot) => (
                  <DecisionEmailRow
                    key={slot.status}
                    slot={slot}
                    email={educationEmails[decisionSlot(slot.status)] ?? null}
                    offeringTitle={offering.title}
                  />
                ))}
              </div>
            </ManageSection>
          )}

          <ManageSection
            title="Feedback forms"
          >
            <div className="flex flex-col gap-2">
              {(
                [
                  {
                    slot: "session-feedback",
                    label: "Session feedback",
                    tip: "Sent automatically to everyone marked Present after each session. Results are visible to the instructor and Core members.",
                  },
                  {
                    slot: "instructor-exit",
                    label: "Instructor exit survey",
                    tip: "Sent to instructors when the offering is closed out. Used to capture end-of-course reflections — separate from the per-session feedback students receive.",
                  },
                ] as const
              ).map(({ slot, label, tip }) => (
                <Form
                  key={slot}
                  method="post"
                  className={cn(WELL_ROW_CLASS, "os-form flex-wrap")}
                >
                  <input type="hidden" name="intent" value="set-form-binding" />
                  <input type="hidden" name="slot" value={slot} />
                  <span className="inline-flex w-44 items-center gap-1.5 text-sm font-semibold text-foreground">
                    {label}
                    <InfoTip content={tip} />
                  </span>
                  <Select
                    name="formId"
                    defaultValue={
                      feedbackBindings.find((b) => b.slot === slot)?.formId ?? ""
                    }
                    placeholder="None"
                    options={[
                      { value: "", label: "None" },
                      ...publishedForms.map((f) => ({ value: f.id, label: f.name })),
                    ]}
                    buttonClassName="flex-1"
                  />
                  <Button type="submit" variant="secondary">
                    Save
                  </Button>
                </Form>
              ))}
            </div>
          </ManageSection>

          {core && certTemplatesOn && (
            <ManageSection
              title="Completion certificate"
              description="The design students get when this course is closed out. Leave it on the lab default, or bind a specific template to this offering."
              action={
                <Link
                  to="/education/certificate-templates"
                  className="text-sm font-medium text-os-accent hover:underline"
                >
                  Manage templates
                </Link>
              }
            >
              <Form method="post" className="os-form flex items-center gap-3">
                <input type="hidden" name="intent" value="bind-certificate-template" />
                <Select
                  name="templateId"
                  defaultValue={certificateBinding ?? ""}
                  options={[
                    { value: "", label: "Lab default" },
                    ...certificateTemplates.map((t) => ({
                      value: t.id,
                      label: t.isDefault ? `${t.name} (default)` : t.name,
                    })),
                  ]}
                  buttonClassName="flex-1"
                />
                <Button type="submit" variant="secondary">
                  Save
                </Button>
              </Form>
              {certificateTemplates.length === 0 && (
                <p className="mt-3 text-sm italic text-os-grey">
                  No templates yet.{" "}
                  <Link to="/education/certificate-templates" className="underline">
                    Create one
                  </Link>{" "}
                  to override the built-in design.
                </p>
              )}
            </ManageSection>
          )}

          {core && offering.status === "Draft" && (
            <Form
              method="post"
              onSubmit={confirmSubmit({
                title: "Delete this draft offering?",
                description: "This can't be undone.",
                confirmLabel: "Delete",
                tone: "destructive",
              })}
            >
              <input type="hidden" name="intent" value="delete-offering" />
              <Button type="submit" variant="destructive">
                Delete draft
              </Button>
            </Form>
          )}
        </div>
      )}

      {tab === "sessions" && (
        // A term's worth of sessions is a long scroll of near-identical cards,
        // so the list of titles stays on screen beside them as the way in.
        // Both columns fill the page's scroll region and scroll inside it, so
        // the nav stays put and the two always end on the same line.
        <div className="flex min-h-0 flex-1 items-stretch gap-6">
          {offering.sessions.length > 1 && (
            <nav
              aria-label="Sessions"
              className="hidden w-56 shrink-0 flex-col gap-1 overflow-y-auto rounded-os-card bg-os-card p-2 lg:flex"
            >
              {offering.sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    document
                      .getElementById(`session-${s.id}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className="rounded-os-item px-3 py-2 text-left text-sm text-os-grey transition-colors hover:bg-os-well hover:text-foreground"
                >
                  <span className="block truncate font-medium text-foreground">
                    {s.title ? `${s.sequence}. ${s.title}` : `Session ${s.sequence}`}
                  </span>
                  <span className="block truncate text-[13px]">
                    {formatSessionWhen(s.datetime, s.endsAt, tz)}
                  </span>
                </button>
              ))}
            </nav>
          )}
        <div className="flex min-w-0 flex-1 flex-col gap-4 lg:overflow-y-auto lg:pb-2 lg:pr-1">
          {offering.sessions.length === 0 ? (
            <p className="rounded-os-card bg-os-card px-6 py-5 text-sm italic text-os-grey">
              No sessions yet.{" "}
              {isMultiSession(offering.type)
                ? `A ${offering.type.toLowerCase()} needs at least one session before it can publish.`
                : "Add the workshop's session below."}
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {offering.sessions.map((s) => (
                <li
                  key={s.id}
                  id={`session-${s.id}`}
                  // Clear the sticky nav's own top offset when scrolled to.
                  className="scroll-mt-4 rounded-os-card bg-os-card p-6"
                >
                  <div className="mb-5 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="font-heading text-[19px] font-semibold text-foreground">
                        {s.title ? `${s.sequence}. ${s.title}` : `Session ${s.sequence}`}
                      </h3>
                      <p className="mt-0.5 text-sm text-os-grey">
                        {formatSessionWhen(s.datetime, s.endsAt, tz)}
                      </p>
                    </div>
                    <Form
                      method="post"
                      onSubmit={confirmSubmit({
                        title: "Delete this session?",
                        confirmLabel: "Delete",
                        tone: "destructive",
                      })}
                    >
                      <input type="hidden" name="intent" value="delete-session" />
                      <input type="hidden" name="sessionId" value={s.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        Delete
                      </Button>
                    </Form>
                  </div>
                  {/* Topic leads on its own line: it's the session's name and
                      the longest thing you type here, so sharing a row with
                      three short fields left it a stub. */}
                  <Form method="post" className="os-form flex flex-col gap-4">
                    <input type="hidden" name="intent" value="update-session" />
                    <input type="hidden" name="sessionId" value={s.id} />
                    <label className={FIELD_COL}>
                      <span className="os-field-label">Topic</span>
                      <input
                        type="text"
                        name="title"
                        placeholder="e.g. Intro to Figma"
                        defaultValue={s.title ?? ""}
                        className="w-full"
                      />
                    </label>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className={FIELD_COL}>
                        <span className="os-field-label">Starts</span>
                        <DateField
                          mode="datetime-local"
                          name="datetime"
                          required
                          defaultValue={toDatetimeLocal(s.datetime)}
                          className="w-full"
                          ariaLabel="Session start date and time"
                        />
                      </label>
                      <label className={FIELD_COL}>
                        <span className="os-field-label">Ends</span>
                        <DateField
                          mode="datetime-local"
                          name="endsAt"
                          defaultValue={s.endsAt ? toDatetimeLocal(s.endsAt) : ""}
                          className="w-full"
                          ariaLabel="Session end date and time"
                        />
                      </label>
                      <label className={FIELD_COL}>
                        <span className="os-field-label">Location</span>
                        <input
                          type="text"
                          name="location"
                          defaultValue={s.location ?? ""}
                          className="w-full"
                        />
                      </label>
                      <label className={FIELD_COL}>
                        <span className="os-field-label">Recording URL</span>
                        <input
                          type="url"
                          name="recordingUrl"
                          defaultValue={s.recordingUrl ?? ""}
                          className="w-full"
                        />
                      </label>
                    </div>
                    <label className={FIELD_COL}>
                      <span className="os-field-label">Notes for students</span>
                      <textarea
                        name="notes"
                        rows={2}
                        defaultValue={s.notes ?? ""}
                        placeholder="Prep work, what to bring, links. Students see this on the course page."
                        className="w-full"
                      />
                    </label>
                    <div className="flex justify-end">
                      <Button type="submit" variant="secondary">
                        Save
                      </Button>
                    </div>
                  </Form>
                  {/* What this session connects to — attendance, materials and
                      assignments — so the tab isn't just a bare date list. */}
                  <div className="mt-5 flex flex-col gap-2 rounded-os-item bg-os-well px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-os-grey">
                        {totalRosterStudents > 0
                          ? `${presentBySession.get(s.id) ?? 0} of ${totalRosterStudents} present`
                          : "No enrolled students yet"}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSearchParams({ tab: "roster", session: s.id })}
                        className="font-medium text-os-accent hover:underline"
                      >
                        Take attendance
                      </button>
                    </div>
                    <SessionMaterials
                      offeringId={offering.id}
                      sessionId={s.id}
                      materials={allMaterials}
                    />
                    {(assignmentsBySession.get(s.id)?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-os-grey">Assignments:</span>
                        {assignmentsBySession.get(s.id)!.map((a) => (
                          <a
                            key={a.id}
                            href={`/education/manage/assignments/${a.id}`}
                            className="text-foreground hover:text-os-accent hover:underline"
                          >
                            {a.title}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Adding a session is occasional; the form sat open permanently above
              the list you actually came to read. The button reveals it. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={addSessionOpen ? "secondary" : "primary"}
              onClick={() => setAddSessionOpen((o) => !o)}
            >
              Add session
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setGenerateOpen((o) => !o)}
            >
              Generate weekly series
            </Button>
          </div>

          <AddFormModal
            open={addSessionOpen}
            onClose={() => setAddSessionOpen(false)}
            title="Add session"
            intent="add-session"
            submitLabel="Add session"
          >
            <label className={FIELD_COL}>
              <span className="os-field-label">Topic</span>
              <input type="text" name="title" placeholder="e.g. Intro to Figma" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={FIELD_COL}>
                <span className="os-field-label">Starts</span>
                <DateField
                  mode="datetime-local"
                  name="datetime"
                  required
                  className="w-full"
                  ariaLabel="Session start date and time"
                />
              </label>
              <label className={FIELD_COL}>
                <span className="os-field-label">Ends</span>
                <DateField
                  mode="datetime-local"
                  name="endsAt"
                  className="w-full"
                  ariaLabel="Session end date and time"
                />
              </label>
            </div>
            <label className={FIELD_COL}>
              <span className="os-field-label">Location</span>
              <input type="text" name="location" placeholder="Sudikoff 007" />
            </label>
            <label className={FIELD_COL}>
              <span className="os-field-label">Notes for students</span>
              <textarea
                name="notes"
                rows={2}
                placeholder="Prep work, what to bring, links. Students see this on the course page."
              />
            </label>
          </AddFormModal>

          <AddFormModal
            open={generateOpen}
            onClose={() => setGenerateOpen(false)}
            title="Generate a session series"
            subtitle="Pick the weekdays this class meets — a Mon/Wed class fills in both, in date order. Rename or retime any session afterward."
            intent="generate-sessions"
            submitLabel="Generate"
          >
            <label className={FIELD_COL}>
              <span className="os-field-label">Starting the week of</span>
              <DateField
                mode="date"
                name="startDate"
                required
                className="w-full"
                ariaLabel="Series start date"
              />
            </label>
            <div className={FIELD_COL}>
              <span className="os-field-label">Meets on</span>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((label, i) => (
                  <label
                    key={i}
                    className="relative cursor-pointer select-none"
                    title={WEEKDAY_NAMES[i]}
                  >
                    <input
                      type="checkbox"
                      name="weekdays"
                      value={i}
                      className="peer sr-only"
                    />
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-os-well text-sm font-medium text-os-grey transition-colors peer-checked:bg-os-accent peer-checked:text-os-card peer-focus-visible:ring-2 peer-focus-visible:ring-os-accent/40">
                      {label}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className={FIELD_COL}>
                <span className="os-field-label">Starts</span>
                <DateField
                  mode="time"
                  name="startTime"
                  required
                  className="w-full"
                  ariaLabel="Session start time"
                />
              </label>
              <label className={FIELD_COL}>
                <span className="os-field-label">Ends</span>
                <DateField
                  mode="time"
                  name="endTime"
                  className="w-full"
                  ariaLabel="Session end time"
                />
              </label>
              <label className={FIELD_COL}>
                <span className="os-field-label">Weeks</span>
                <input type="number" name="weeks" min={1} max={26} defaultValue={6} />
              </label>
            </div>
            <label className={FIELD_COL}>
              <span className="os-field-label">Location</span>
              <input type="text" name="location" placeholder="Sudikoff 007" />
            </label>
          </AddFormModal>
        </div>
        </div>
      )}

      {tab === "applications" && (
        <div className="flex flex-col gap-3">
          {applications.length === 0 ? (
            <p className="rounded-os-card bg-os-card px-6 py-5 text-sm italic text-os-grey">
              No applications yet.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {(["all", "Submitted", "Approved", "Waitlisted", "Rejected", "Withdrawn"] as const)
                  .filter((s) => s === "all" || (appCounts[s] ?? 0) > 0)
                  .map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setAppFilter(s)}
                      className={cn(
                        "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                        appFilter === s
                          ? "bg-os-accent text-os-card"
                          : "bg-os-well text-os-grey hover:text-foreground",
                      )}
                    >
                      {s === "all" ? `All ${applications.length}` : `${s} ${appCounts[s] ?? 0}`}
                    </button>
                  ))}
                {(appCounts["Submitted"] ?? 0) > 0 && (
                  <Form
                    method="post"
                    className="ml-auto"
                    onSubmit={confirmSubmit({
                      title: `Approve all ${appCounts["Submitted"]} pending applicants?`,
                      description:
                        "Approves up to capacity and emails each approved applicant. Applicants beyond the seat limit are waitlisted instead.",
                      confirmLabel: "Approve all",
                    })}
                  >
                    <input type="hidden" name="intent" value="approve-all-pending" />
                    <Button type="submit">
                      Approve all {appCounts["Submitted"]} pending
                    </Button>
                  </Form>
                )}
              </div>
              {(appCounts["Waitlisted"] ?? 0) > 0 &&
                (appFilter === "all" || appFilter === "Waitlisted") && (
                  <WaitlistOrder applications={applications} />
                )}
              <ApplicationsReview
                applications={filteredApps}
                statusChip={(status) => <MyStatusChip status={status as never} />}
                formatSubmitted={(at) => formatDateTime(at as never, tz)}
              />
            </>
          )}
        </div>
      )}

      {tab === "roster" && (
        <div className="flex flex-col gap-4">
          {sessionCheckIn && (
            <ManageSection
              title="Self check-in"
              description="Open check-in and project the QR. Students scan it to mark themselves present. You can still mark anyone by hand below."
              action={
                <Form method="post" className="shrink-0">
                  <input type="hidden" name="intent" value="set-session-check-in" />
                  <input type="hidden" name="sessionId" value={sessionCheckIn.sessionId} />
                  <input type="hidden" name="open" value={sessionCheckIn.open ? "false" : "true"} />
                  <Button type="submit" variant={sessionCheckIn.open ? "secondary" : "primary"}>
                    {sessionCheckIn.open ? "Close check-in" : "Open self check-in"}
                  </Button>
                </Form>
              }
            >
              {sessionCheckIn.open && sessionCheckIn.checkInQrSvg && sessionCheckIn.checkInUrl && (
                <div className="flex flex-wrap items-center gap-5">
                  <div
                    className="h-44 w-44 shrink-0 rounded-os-item bg-white p-3 [&_svg]:h-full [&_svg]:w-full"
                    dangerouslySetInnerHTML={{ __html: sessionCheckIn.checkInQrSvg }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      Check-in is open for this session.
                    </p>
                    <p className="mt-1 text-sm text-os-grey">
                      Students scan the code (signed in) to mark themselves present. Marks appear in
                      the roster below.
                    </p>
                    <a
                      href={sessionCheckIn.checkInUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-block break-all text-sm text-os-accent hover:underline"
                    >
                      {sessionCheckIn.checkInUrl}
                    </a>
                  </div>
                </div>
              )}
              {!sessionCheckIn.open && (
                <p className="text-sm text-os-grey">
                  Check-in is closed. Open it to show the QR code.
                </p>
              )}
            </ManageSection>
          )}
          <RosterMatrix
            sessions={attendanceMatrix.sessions.map((s) => ({
              id: s.id,
              sequence: s.sequence,
              datetime: s.datetime,
            }))}
            students={attendanceMatrix.students}
            activeSessionId={roster?.session.id ?? attendanceMatrix.sessions[0]?.id ?? null}
            onSelectSession={(sessionId) =>
              setSearchParams(
                { tab: "roster", session: sessionId },
                { preventScrollReset: true },
              )
            }
            formatSessionDate={(d) => formatDateTime(d as never, tz)}
            assignments={assignmentsForPerformance}
            submissionsByApp={performanceByApp}
            completionByApp={completionByApp}
          />
        </div>
      )}

      {tab === "materials" && (
        <ManageMaterials
          offeringId={offering.id}
          materials={materials}
          files={offeringFiles}
          workspaceDocs={workspaceDocs}
          sessions={offering.sessions.map((s) => ({ id: s.id, sequence: s.sequence }))}
          favoriteIds={favoriteIds}
        />
      )}

      {tab === "assignments" && (
        <ManageAssignments
          assignments={assignments}
          sessions={offering.sessions.map((s) => ({ id: s.id, sequence: s.sequence }))}
          collabToken={collabToken}
          userName={userName}
        />
      )}

      {tab === "announcements" && (
        <OfferingDiscussion posts={announcements} currentUserId={currentUserId} canAnnounce />
      )}

      {tab === "feedback" && (
        <div className="flex flex-col gap-5">
          <div className="os-form flex items-center gap-3">
            <span className="text-sm text-os-grey">Session</span>
            <Select
              value={feedbackSessionId ?? ""}
              onChange={(value) =>
                setSearchParams(
                  { tab: "feedback", session: value },
                  { preventScrollReset: true },
                )
              }
              options={offering.sessions.map((s) => ({
                value: s.id,
                label: `Session ${s.sequence}, ${formatDateTime(s.datetime, tz)}`,
              }))}
              buttonClassName="min-w-[16rem]"
            />
          </div>

          {!sessionFeedback ? (
            <p className="rounded-os-card bg-os-card px-6 py-5 text-sm italic text-os-grey">
              No session-feedback form is bound yet. Pick one on the Details tab.
            </p>
          ) : (
            <FeedbackResults
              title={`Session feedback (${sessionFeedback.submissions.length} response${sessionFeedback.submissions.length === 1 ? "" : "s"})`}
              anonymizedNote={!core}
              results={sessionFeedback}
            />
          )}

          {core && exitFeedback && (
            <FeedbackResults
              title={`Instructor exit surveys (${exitFeedback.submissions.length})`}
              anonymizedNote={false}
              results={exitFeedback}
            />
          )}
        </div>
      )}
      </div>
    </div>
  );
}

function FeedbackResults({
  title,
  anonymizedNote,
  results,
}: {
  title: string;
  anonymizedNote: boolean;
  results: {
    responded: number;
    eligible: number;
    questions: { key: string; type: string; data: { label: string } }[];
    submissions: {
      id: string;
      answers: Record<string, unknown>;
      submitterName: string | null;
    }[];
  };
}) {
  const visibleQuestions = results.questions.filter((q) => q.type !== "info");
  const rate =
    results.eligible > 0
      ? Math.round((results.responded / results.eligible) * 100)
      : null;
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="font-heading text-[19px] font-semibold text-foreground">
          {title}
        </h2>
        {rate !== null && (
          <p className="mt-1 text-sm text-os-grey">
            {results.responded} of {results.eligible} responded ({rate}%)
          </p>
        )}
        {anonymizedNote && (
          <p className="mt-0.5 text-sm text-os-grey">
            Responses are anonymized and shown in a shuffled order.
          </p>
        )}
      </div>
      <div className="flex flex-col gap-5 rounded-os-card bg-os-card p-6">
      {results.submissions.length === 0 ? (
        <p className="text-sm italic text-os-grey">No responses yet.</p>
      ) : anonymizedNote && results.responded < 3 ? (
        <p className="text-sm italic text-os-grey">
          Only {results.responded} response{results.responded === 1 ? "" : "s"} so far.
          Individual responses stay hidden until at least 3, to keep them anonymous.
        </p>
      ) : (
        visibleQuestions.map((q) => {
          // Aggregate answers: a tally for enumerable (choice/rating) questions
          // and an average when every answer is numeric. Skipped for free text
          // (too many distinct values).
          const values = results.submissions
            .map((s) => {
              const raw = s.answers[q.key];
              return raw == null || raw === ""
                ? null
                : Array.isArray(raw)
                  ? raw.join(", ")
                  : String(raw);
            })
            .filter((v): v is string => v !== null);
          const tally = new Map<string, number>();
          for (const v of values) tally.set(v, (tally.get(v) ?? 0) + 1);
          const nums = values.map(Number).filter((n) => Number.isFinite(n));
          const avg =
            values.length > 0 && nums.length === values.length
              ? nums.reduce((a, b) => a + b, 0) / nums.length
              : null;
          const showTally = tally.size > 0 && tally.size <= 8;
          return (
          <div key={q.key}>
            <h3 className="text-sm font-semibold text-foreground">{q.data.label}</h3>
            {(avg !== null || showTally) && (
              <p className="mt-1 text-sm text-os-grey">
                {avg !== null && (
                  <span className="font-semibold text-foreground">avg {avg.toFixed(1)}</span>
                )}
                {avg !== null && showTally && " · "}
                {showTally &&
                  [...tally.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([v, n]) => `${v} (${n})`)
                    .join(", ")}
              </p>
            )}
            <ul className="mt-2 flex flex-col gap-1.5">
              {results.submissions.map((s) => {
                const raw = s.answers[q.key];
                const value =
                  raw == null || raw === ""
                    ? null
                    : Array.isArray(raw)
                      ? raw.join(", ")
                      : String(raw);
                if (value === null) return null;
                return (
                  <li
                    key={s.id}
                    className="whitespace-pre-wrap rounded-os-item bg-os-well px-3.5 py-2.5 text-sm text-foreground"
                  >
                    {value}
                    {s.submitterName && (
                      <span className="text-os-grey"> · {s.submitterName}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          );
        })
      )}
      </div>
    </section>
  );
}

// What a session's materials are, and the place to change them. The Sessions
// tab used to state them read-only, which meant filing week 3's slides under
// week 3 was a trip to the Materials tab and back for every session. Pages and
// uploaded files are one list here; only the intent they post differs.
function SessionMaterials({
  offeringId,
  sessionId,
  materials,
}: {
  offeringId: string;
  sessionId: string;
  materials: {
    id: string;
    title: string;
    kind: "page" | "file";
    sessionId: string | null;
    href: string;
  }[];
}) {
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  // Upload straight onto the session. Going via the Materials tab to upload and
  // then back here to file it was the long way round to "here are week 3's
  // slides", which is the one thing this row is for.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const meta = await uploadFileToS3(file, `offering/${offeringId}/materials`);
      const res = await fetch(`/api/education/${offeringId}/files`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: file.name, sessionId, ...meta }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to register file");
      }
      revalidator.revalidate();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }
  const attached = materials.filter((m) => m.sessionId === sessionId);
  // Anything not already on this session, including material attached to
  // another one — moving it here is the same edit as attaching a loose file.
  const available = materials.filter((m) => m.sessionId !== sessionId);

  const setSession = (m: { id: string; kind: "page" | "file" }, to: string) =>
    fetcher.submit(
      {
        intent: m.kind === "page" ? "set-material-session" : "set-file-session",
        [m.kind === "page" ? "pageId" : "fileId"]: m.id,
        sessionId: to,
      },
      { method: "post" },
    );

  const uploadButton = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        onChange={upload}
        className="hidden"
        aria-hidden
        tabIndex={-1}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => fileInputRef.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-full bg-os-container px-3 py-1 text-sm text-os-grey transition-colors hover:text-foreground disabled:opacity-60"
      >
        <Upload className="h-3.5 w-3.5" aria-hidden />
        {uploading ? "Uploading…" : "Upload"}
      </button>
    </>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-os-grey">Materials:</span>
      {attached.map((m) => (
        <span
          key={m.id}
          className="inline-flex items-center gap-1.5 rounded-full bg-os-container px-3 py-1"
        >
          <a href={m.href} className="text-foreground hover:text-os-accent hover:underline">
            {m.title}
          </a>
          <button
            type="button"
            onClick={() => setSession(m, "")}
            aria-label={`Remove ${m.title} from this session`}
            className="text-os-grey transition-colors hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
      {attached.length === 0 && <span className="text-os-grey">None yet.</span>}
      {available.length > 0 && (
        <Select
          value=""
          onChange={(id) => {
            const m = available.find((x) => x.id === id);
            if (m) setSession(m, sessionId);
          }}
          placeholder="Attach existing"
          options={available.map((m) => ({
            value: m.id,
            label: m.sessionId ? `${m.title} (move here)` : m.title,
          }))}
          buttonClassName="inline-flex items-center gap-1 rounded-full bg-os-container px-3 py-1 text-sm text-os-grey transition-colors hover:text-foreground"
        />
      )}
      {uploadButton}
      {uploadError && <span className="text-destructive">{uploadError}</span>}
    </div>
  );
}

// One row of the Decision emails list: what the status sends, flagged when no
// email is written yet, with Edit/Write opening the shared subject and body in
// a modal. The email is one per status for the whole lab, not per course — the
// preview renders it against this course so the words can be checked in place.
function DecisionEmailRow({
  slot,
  email,
  offeringTitle,
}: {
  slot: { status: DecisionSlotStatus; label: string; description: string };
  email: { subject: string; body: string } | null;
  offeringTitle: string;
}) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(email?.subject ?? "");
  const [body, setBody] = useState(email?.body ?? "");
  const busy = fetcher.state !== "idle";

  // Close once a save lands; the loader brings the new email back.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) setEditing(false);
  }, [fetcher.state, fetcher.data]);

  const open = () => {
    setSubject(email?.subject ?? "");
    setBody(email?.body ?? "");
    setEditing(true);
  };
  const save = () =>
    fetcher.submit(
      {
        intent: "save-education-email",
        slot: decisionSlot(slot.status),
        subject,
        body,
      },
      { method: "post" },
    );

  // Soft warning only: an unknown variable still saves.
  const unknown = [
    ...new Set([...unknownVariables(subject), ...unknownVariables(body)]),
  ];
  const preview = renderEmail({ subject, body }, { firstName: "Alex", domain: offeringTitle });
  const titleId = `education-email-${slot.status.toLowerCase()}`;

  return (
    <div className={cn(WELL_ROW_CLASS, "items-start")}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">{slot.label}</span>
        <span className="text-sm text-os-grey">
          {email ? slot.description : "No email yet. Nothing sends for this status."}
        </span>
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={open}>
        {email ? "Edit" : "Write"}
      </Button>
      <Modal
        open={editing}
        onClose={busy ? () => {} : () => setEditing(false)}
        disableEscape={busy}
        labelledBy={titleId}
        containerClassName={modalCardClass("max-w-3xl")}
      >
        <ModalHeader
          titleId={titleId}
          title={`${slot.label} email`}
          subtitle="Shared by every course."
          onClose={() => setEditing(false)}
        />
        <div className="os-form flex flex-col gap-4">
          <label className={FIELD_COL}>
            <span className="os-field-label">Subject</span>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              aria-label={`${slot.label} subject`}
            />
          </label>
          <label className={FIELD_COL}>
            <span className="os-field-label">Body</span>
            <textarea
              rows={14}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              aria-label={`${slot.label} body`}
            />
          </label>
          <p className="text-sm text-os-grey">
            Supports{" "}
            {EDUCATION_EMAIL_VARIABLES.map((v, i) => (
              <span key={v}>
                {i > 0 && ", "}
                <code className="rounded bg-os-well px-1.5 py-0.5 font-mono">{`{{${v}}}`}</code>
              </span>
            ))}
            . Leave both fields empty to send nothing for this status.
          </p>
          {unknown.length > 0 && (
            <p className="text-sm text-amber-700">
              {unknown.map((v) => `{{${v}}}`).join(", ")} won&apos;t be filled in.
            </p>
          )}
          {(subject.trim() || body.trim()) && (
            <div className="rounded-os-item bg-os-well px-4 py-3 text-sm">
              <p className="text-os-grey">Sample for “Alex”:</p>
              <p className="mt-1.5 font-medium text-foreground">{preview.subject}</p>
              <div
                className="mt-1 text-foreground [&_p]:my-1"
                dangerouslySetInnerHTML={{ __html: preview.html }}
              />
            </div>
          )}
          {fetcher.data?.error && (
            <p className="text-sm text-destructive">{fetcher.data.error}</p>
          )}
        </div>
        <ModalFooter onCancel={() => setEditing(false)}>
          <Button type="button" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
