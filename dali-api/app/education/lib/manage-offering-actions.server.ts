import { redirect } from "react-router";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { runOfferingAction } from "~/education/lib/offerings.server";
import {
  decideApplication,
  approveAllPending,
  moveWaitlistEntry,
} from "~/education/lib/decisions.server";
import { isOfferingManager } from "~/education/lib/access.server";
import { createMaterialPage, moveMaterialPage, moveMaterialFile, renameMaterialPage, renameMaterialFile, archiveMaterialPage, archiveMaterialFile } from "~/education/lib/lms.server";
import { setSessionCheckInOpen } from "~/education/lib/session-checkin.server";
import { createAssignment, updateAssignment, deleteAssignment } from "~/education/lib/assignments.server";
import { postAnnouncement, deleteAnnouncement } from "~/education/lib/announcements.server";
import { saveAttendance } from "~/education/lib/attendance.server";
import { upsertStudentNote } from "~/education/lib/student-notes.server";
import { bindOfferingCertificateTemplate } from "~/education/lib/certificate-templates.server";
import { closeOutOffering, reopenOffering, previewCloseOut } from "~/education/lib/certificates.server";
import { setFormBinding } from "~/education/lib/feedback.server";
import type {
  AttendanceStatus,
  EduApplicationStatus,
  SubmissionType,
} from "~/generated/prisma/client";
import { prisma } from "~/lib/db.server";
import { APPLICATION_TZ, zonedDateTimeLocalToUtc } from "~/lib/timezone";


export type ManageContentContext = { formData: FormData; offeringId: string; userId: string };
type ManageContentHandler = (ctx: ManageContentContext) => Promise<Response | Record<string, unknown>>;

const fail = (r: { error: string; status: number }) =>
  Response.json({ error: r.error }, { status: r.status });

const decideApplicationHandler: ManageContentHandler = async ({ formData, offeringId, userId }) => {
  // decideApplication self-scopes to offeringId, so a manager of another
  // offering can't act on this application.
  const result = await decideApplication({
    applicationId: String(formData.get("applicationId") ?? ""),
    offeringId,
    status: String(formData.get("status")) as EduApplicationStatus,
    actorId: userId,
  });
  return "error" in result ? fail(result) : { ok: true };
};

const approveAllPendingHandler: ManageContentHandler = async ({ offeringId, userId }) => {
  const result = await approveAllPending({
    offeringId,
    actorId: userId,
  });
  return { ok: true, bulkApprove: result };
};

const moveWaitlistEntryHandler: ManageContentHandler = async ({ formData, offeringId, userId }) => {
  const result = await moveWaitlistEntry({
    applicationId: String(formData.get("applicationId") ?? ""),
    offeringId,
    direction: formData.get("direction") === "up" ? "up" : "down",
    actorId: userId,
  });
  return "error" in result ? fail(result) : { ok: true };
};

const movePageHandler: ManageContentHandler = async ({ formData, offeringId, userId }) => {
  const result = await moveMaterialPage({
    offeringId,
    pageId: String(formData.get("pageId") ?? ""),
    parentPageId: String(formData.get("parentPageId") ?? "") || null,
    actorId: userId,
  });
  return "error" in result ? fail(result) : { ok: true };
};

const moveFileHandler: ManageContentHandler = async ({ formData, offeringId, userId }) => {
  const result = await moveMaterialFile({
    offeringId,
    fileId: String(formData.get("fileId") ?? ""),
    folderId: String(formData.get("folderId") ?? "") || null,
    actorId: userId,
  });
  return "error" in result ? fail(result) : { ok: true };
};

const renamePageHandler: ManageContentHandler = async ({ formData, offeringId, userId }) => {
  const result = await renameMaterialPage({
    offeringId,
    pageId: String(formData.get("pageId") ?? ""),
    title: String(formData.get("title") ?? ""),
    actorId: userId,
  });
  return "error" in result ? fail(result) : { ok: true };
};

const renameFileHandler: ManageContentHandler = async ({ formData, offeringId, userId }) => {
  const result = await renameMaterialFile({
    offeringId,
    fileId: String(formData.get("fileId") ?? ""),
    title: String(formData.get("title") ?? ""),
    actorId: userId,
  });
  return "error" in result ? fail(result) : { ok: true };
};

const deletePageHandler: ManageContentHandler = async ({ formData, offeringId, userId }) => {
  const result = await archiveMaterialPage({
    offeringId,
    pageId: String(formData.get("pageId") ?? ""),
    actorId: userId,
  });
  return "error" in result ? fail(result) : { ok: true };
};

const deleteFileHandler: ManageContentHandler = async ({ formData, offeringId, userId }) => {
  const result = await archiveMaterialFile({
    offeringId,
    fileId: String(formData.get("fileId") ?? ""),
    actorId: userId,
  });
  return "error" in result ? fail(result) : { ok: true };
};

const setSessionCheckInHandler: ManageContentHandler = async ({ formData, offeringId, userId }) => {
  const result = await setSessionCheckInOpen({
    offeringId,
    sessionId: String(formData.get("sessionId") ?? ""),
    open: formData.get("open") === "true",
    actorId: userId,
  });
  return "error" in result ? fail(result) : { ok: true };
};

const createPageHandler: ManageContentHandler = async ({ formData, offeringId, userId }) => {
  const result = await createMaterialPage({
    offeringId,
    title: String(formData.get("title") ?? ""),
    parentPageId: String(formData.get("parentPageId") ?? "") || null,
    studentEditable: formData.get("studentEditable") === "true",
    kind: formData.get("kind") === "Folder" ? "Folder" : "FreeForm",
    sessionId: String(formData.get("sessionId") ?? "") || null,
    actorId: userId,
  });
  return "error" in result ? fail(result) : { ok: true };
};

const setMaterialSessionHandler: ManageContentHandler = async ({ formData, offeringId }) => {
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
    page.workspaceId !== offeringId
  ) {
    return Response.json({ error: "Page not found" }, { status: 404 });
  }
  await prisma.page.update({ where: { id: pageId }, data: { sessionId } });
  return { ok: true };
};

const setFileSessionHandler: ManageContentHandler = async ({ formData, offeringId }) => {
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
    file.workspaceId !== offeringId
  ) {
    return Response.json({ error: "File not found" }, { status: 404 });
  }
  await prisma.projectFile.update({ where: { id: fileId }, data: { sessionId } });
  return { ok: true };
};

const createAssignmentHandler: ManageContentHandler = async ({ formData, offeringId, userId }) => {
  const dueAtRaw = String(formData.get("dueAt") ?? "");
  const pointsRaw = String(formData.get("points") ?? "");
  const pointsParsed = pointsRaw ? parseInt(pointsRaw, 10) : null;
  const result = await createAssignment({
    offeringId,
    sessionId: String(formData.get("sessionId") ?? "") || null,
    title: String(formData.get("title") ?? ""),
    dueAt: dueAtRaw ? zonedDateTimeLocalToUtc(dueAtRaw, APPLICATION_TZ) : null,
    submissionType: String(formData.get("submissionType")) as SubmissionType,
    points: pointsParsed != null && pointsParsed >= 1 ? pointsParsed : null,
    actorId: userId,
  });
  return "error" in result ? fail(result) : { ok: true };
};

const updateAssignmentHandler: ManageContentHandler = async ({ formData, offeringId, userId }) => {
  const dueAtRaw = String(formData.get("dueAt") ?? "");
  const pointsRaw = String(formData.get("points") ?? "");
  const pointsParsed = pointsRaw ? parseInt(pointsRaw, 10) : null;
  const result = await updateAssignment({
    assignmentId: String(formData.get("assignmentId") ?? ""),
    offeringId,
    title: String(formData.get("title") ?? ""),
    dueAt: dueAtRaw ? zonedDateTimeLocalToUtc(dueAtRaw, APPLICATION_TZ) : null,
    submissionType: String(formData.get("submissionType")) as SubmissionType,
    points: pointsParsed != null && pointsParsed >= 1 ? pointsParsed : null,
    actorId: userId,
  });
  return "error" in result ? fail(result) : { ok: true };
};

const deleteAssignmentHandler: ManageContentHandler = async ({ formData, offeringId, userId }) => {
  const result = await deleteAssignment({
    assignmentId: String(formData.get("assignmentId") ?? ""),
    offeringId,
    actorId: userId,
  });
  return "error" in result ? fail(result) : { ok: true };
};

const postAnnouncementHandler: ManageContentHandler = async ({ formData, offeringId, userId }) => {
  const result = await postAnnouncement({
    offeringId,
    authorId: userId,
    body: String(formData.get("body") ?? ""),
    kind: formData.get("kind") === "Message" ? "Message" : "Announcement",
    parentId: String(formData.get("parentId") ?? "") || null,
  });
  return "error" in result ? fail(result) : { ok: true };
};

const deleteAnnouncementHandler: ManageContentHandler = async ({ formData, offeringId, userId }) => {
  // Manager-gated by the contentIntents check above, so isManager holds.
  const result = await deleteAnnouncement({
    postId: String(formData.get("postId") ?? ""),
    offeringId,
    actorId: userId,
    isManager: true,
  });
  return "error" in result ? fail(result) : { ok: true };
};

const setFormBindingHandler: ManageContentHandler = async ({ formData, offeringId, userId }) => {
  const result = await setFormBinding({
    offeringId,
    slot: String(formData.get("slot") ?? ""),
    formId: String(formData.get("formId") ?? "") || null,
    actorId: userId,
  });
  return "error" in result ? fail(result) : { ok: true };
};

const bindCertificateTemplateHandler: ManageContentHandler = async ({ formData, offeringId, userId }) => {
  // Template management is Core-only (matches who owns the library).
  if (!(await isCore(userId)))
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const result = await bindOfferingCertificateTemplate({
    offeringId,
    templateId: String(formData.get("templateId") ?? "") || null,
  });
  return "error" in result ? fail(result) : { ok: true };
};

const previewCloseOutHandler: ManageContentHandler = async ({ offeringId }) => {
  const preview = await previewCloseOut(offeringId);
  return { ok: true, closeOutPreview: preview };
};

const closeOutOfferingHandler: ManageContentHandler = async ({ formData, offeringId, userId }) => {
  const result = await closeOutOffering({
    offeringId,
    actorId: userId,
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
};

const reopenOfferingHandler: ManageContentHandler = async ({ offeringId, userId }) => {
  const result = await reopenOffering({
    offeringId,
    actorId: userId,
  });
  if ("error" in result) return fail(result);
  return { ok: true, reopened: true };
};

const saveStudentNoteHandler: ManageContentHandler = async ({ formData, offeringId, userId }) => {
  const applicationId = String(formData.get("applicationId") ?? "");
  const application = await prisma.educationApplication.findUnique({
    where: { id: applicationId },
    select: { offeringId: true },
  });
  if (!application || application.offeringId !== offeringId)
    return Response.json({ error: "Application not found" }, { status: 404 });
  const result = await upsertStudentNote({
    applicationId,
    actorId: userId,
    feedback: String(formData.get("feedback") ?? ""),
    internalNote: String(formData.get("internalNote") ?? ""),
  });
  return "error" in result ? fail(result) : { ok: true };
};

const saveAttendanceHandler: ManageContentHandler = async ({ formData, offeringId, userId }) => {
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
    offeringId,
    sessionId: String(formData.get("sessionId") ?? ""),
    marks,
    actorId: userId,
  });
  return "error" in result ? fail(result) : { ok: true };
};

export const MANAGE_CONTENT_ACTIONS = {
  "decide-application": decideApplicationHandler,
  "approve-all-pending": approveAllPendingHandler,
  "move-waitlist-entry": moveWaitlistEntryHandler,
  "move-page": movePageHandler,
  "move-file": moveFileHandler,
  "rename-page": renamePageHandler,
  "rename-file": renameFileHandler,
  "delete-page": deletePageHandler,
  "delete-file": deleteFileHandler,
  "set-session-check-in": setSessionCheckInHandler,
  "create-page": createPageHandler,
  "set-material-session": setMaterialSessionHandler,
  "set-file-session": setFileSessionHandler,
  "create-assignment": createAssignmentHandler,
  "update-assignment": updateAssignmentHandler,
  "delete-assignment": deleteAssignmentHandler,
  "post-announcement": postAnnouncementHandler,
  "delete-announcement": deleteAnnouncementHandler,
  "set-form-binding": setFormBindingHandler,
  "bind-certificate-template": bindCertificateTemplateHandler,
  "preview-close-out": previewCloseOutHandler,
  "close-out-offering": closeOutOfferingHandler,
  "reopen-offering": reopenOfferingHandler,
  "save-student-note": saveStudentNoteHandler,
  "save-attendance": saveAttendanceHandler,
} satisfies Record<string, ManageContentHandler>;

export type ManageContentIntent = keyof typeof MANAGE_CONTENT_ACTIONS;

export function isManageContentIntent(intent: string): intent is ManageContentIntent {
  return Object.hasOwn(MANAGE_CONTENT_ACTIONS, intent);
}

export async function runManageOfferingAction(request: Request, offeringId: string) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const formData = await request.formData();
  const userId = auth.user.sub;

  const intent = String(formData.get("intent") ?? "");
  if (isManageContentIntent(intent)) {
    if (!(await isOfferingManager(userId, offeringId)))
      return Response.json({ error: "Forbidden" }, { status: 403 });
    return MANAGE_CONTENT_ACTIONS[intent]({ formData, offeringId, userId });
  }

  formData.set("offeringId", offeringId);
  const result = await runOfferingAction(formData, userId);
  if ("error" in result)
    return Response.json({ error: result.error }, { status: result.status });
  if (formData.get("intent") === "delete-offering") return redirect("/education/offerings");
  if (formData.get("intent") === "duplicate-offering" && "id" in result && result.id)
    return redirect(`/education/manage/${result.id}`);
  return result;
}
