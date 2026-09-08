import { prisma } from "~/lib/db";
import { isOfferingManager } from "~/education/lib/access.server";
import { runOfferingAction } from "~/education/lib/offerings.server";
import { decideApplication, approveAllPending } from "~/education/lib/decisions.server";
import {
  createMaterialPage,
  moveMaterialPage,
  moveMaterialFile,
} from "~/education/lib/lms.server";
import { setSessionCheckInOpen } from "~/education/lib/session-checkin.server";
import {
  createAssignment,
  updateAssignment,
  deleteAssignment,
} from "~/education/lib/assignments.server";
import { postAnnouncement } from "~/education/lib/announcements.server";
import { saveAttendance } from "~/education/lib/attendance.server";
import { upsertStudentNote } from "~/education/lib/student-notes.server";
import { closeOutOffering, previewCloseOut } from "~/education/lib/certificates.server";
import { setFormBinding } from "~/education/lib/feedback.server";
import type {
  AttendanceStatus,
  EduApplicationStatus,
  SubmissionType,
} from "~/generated/prisma/client";

export type ManageActionContext = { offeringId: string; actorId: string };

type ManageActionResult = Response | Record<string, unknown>;

const fail = (r: { error: string; status: number }) =>
  Response.json({ error: r.error }, { status: r.status });

// One handler per manager-gated content intent. The dispatch guard is the key
// set itself, so a case can't silently fall through to runOfferingAction (the
// old route's hand-maintained intent list dropped approve-all-pending and
// preview-close-out, 400ing both).
const CONTENT_INTENT_HANDLERS: Record<
  string,
  (formData: FormData, ctx: ManageActionContext) => Promise<ManageActionResult>
> = {
  "decide-application": async (formData, ctx) => {
    // decideApplication self-scopes to offeringId, so a manager of another
    // offering can't act on this application.
    const result = await decideApplication({
      applicationId: String(formData.get("applicationId") ?? ""),
      offeringId: ctx.offeringId,
      status: String(formData.get("status")) as EduApplicationStatus,
      actorId: ctx.actorId,
    });
    return "error" in result ? fail(result) : { ok: true };
  },
  "approve-all-pending": async (_formData, ctx) => {
    const result = await approveAllPending({
      offeringId: ctx.offeringId,
      actorId: ctx.actorId,
    });
    return { ok: true, bulkApprove: result };
  },
  "move-page": async (formData, ctx) => {
    const result = await moveMaterialPage({
      offeringId: ctx.offeringId,
      pageId: String(formData.get("pageId") ?? ""),
      parentPageId: String(formData.get("parentPageId") ?? "") || null,
      actorId: ctx.actorId,
    });
    return "error" in result ? fail(result) : { ok: true };
  },
  "move-file": async (formData, ctx) => {
    const result = await moveMaterialFile({
      offeringId: ctx.offeringId,
      fileId: String(formData.get("fileId") ?? ""),
      folderId: String(formData.get("folderId") ?? "") || null,
      actorId: ctx.actorId,
    });
    return "error" in result ? fail(result) : { ok: true };
  },
  "set-session-check-in": async (formData, ctx) => {
    const result = await setSessionCheckInOpen({
      offeringId: ctx.offeringId,
      sessionId: String(formData.get("sessionId") ?? ""),
      open: formData.get("open") === "true",
      actorId: ctx.actorId,
    });
    return "error" in result ? fail(result) : { ok: true };
  },
  "create-page": async (formData, ctx) => {
    const result = await createMaterialPage({
      offeringId: ctx.offeringId,
      title: String(formData.get("title") ?? ""),
      parentPageId: String(formData.get("parentPageId") ?? "") || null,
      studentEditable: formData.get("studentEditable") === "true",
      kind: formData.get("kind") === "Folder" ? "Folder" : "FreeForm",
      sessionId: String(formData.get("sessionId") ?? "") || null,
      actorId: ctx.actorId,
    });
    return "error" in result ? fail(result) : { ok: true };
  },
  "set-material-session": async (formData, ctx) => {
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
      page.workspaceId !== ctx.offeringId
    ) {
      return Response.json({ error: "Page not found" }, { status: 404 });
    }
    await prisma.page.update({ where: { id: pageId }, data: { sessionId } });
    return { ok: true };
  },
  "create-assignment": async (formData, ctx) => {
    const dueAtRaw = String(formData.get("dueAt") ?? "");
    const pointsRaw = String(formData.get("points") ?? "");
    const pointsParsed = pointsRaw ? parseInt(pointsRaw, 10) : null;
    const result = await createAssignment({
      offeringId: ctx.offeringId,
      sessionId: String(formData.get("sessionId") ?? "") || null,
      title: String(formData.get("title") ?? ""),
      dueAt: dueAtRaw ? new Date(dueAtRaw) : null,
      submissionType: String(formData.get("submissionType")) as SubmissionType,
      points: pointsParsed != null && pointsParsed >= 1 ? pointsParsed : null,
      actorId: ctx.actorId,
    });
    return "error" in result ? fail(result) : { ok: true };
  },
  "update-assignment": async (formData, ctx) => {
    const dueAtRaw = String(formData.get("dueAt") ?? "");
    const pointsRaw = String(formData.get("points") ?? "");
    const pointsParsed = pointsRaw ? parseInt(pointsRaw, 10) : null;
    const result = await updateAssignment({
      assignmentId: String(formData.get("assignmentId") ?? ""),
      offeringId: ctx.offeringId,
      title: String(formData.get("title") ?? ""),
      dueAt: dueAtRaw ? new Date(dueAtRaw) : null,
      submissionType: String(formData.get("submissionType")) as SubmissionType,
      points: pointsParsed != null && pointsParsed >= 1 ? pointsParsed : null,
      actorId: ctx.actorId,
    });
    return "error" in result ? fail(result) : { ok: true };
  },
  "delete-assignment": async (formData, ctx) => {
    const result = await deleteAssignment({
      assignmentId: String(formData.get("assignmentId") ?? ""),
      offeringId: ctx.offeringId,
      actorId: ctx.actorId,
    });
    return "error" in result ? fail(result) : { ok: true };
  },
  "post-announcement": async (formData, ctx) => {
    const result = await postAnnouncement({
      offeringId: ctx.offeringId,
      authorId: ctx.actorId,
      body: String(formData.get("body") ?? ""),
      kind: formData.get("kind") === "Message" ? "Message" : "Announcement",
      parentId: String(formData.get("parentId") ?? "") || null,
    });
    return "error" in result ? fail(result) : { ok: true };
  },
  "set-form-binding": async (formData, ctx) => {
    const result = await setFormBinding({
      offeringId: ctx.offeringId,
      slot: String(formData.get("slot") ?? ""),
      formId: String(formData.get("formId") ?? "") || null,
      actorId: ctx.actorId,
    });
    return "error" in result ? fail(result) : { ok: true };
  },
  "preview-close-out": async (_formData, ctx) => {
    const preview = await previewCloseOut(ctx.offeringId);
    return { ok: true, closeOutPreview: preview };
  },
  "close-out-offering": async (_formData, ctx) => {
    const result = await closeOutOffering({
      offeringId: ctx.offeringId,
      actorId: ctx.actorId,
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
  },
  "save-student-note": async (formData, ctx) => {
    const applicationId = String(formData.get("applicationId") ?? "");
    const application = await prisma.educationApplication.findUnique({
      where: { id: applicationId },
      select: { offeringId: true },
    });
    if (!application || application.offeringId !== ctx.offeringId)
      return Response.json({ error: "Application not found" }, { status: 404 });
    const result = await upsertStudentNote({
      applicationId,
      actorId: ctx.actorId,
      feedback: String(formData.get("feedback") ?? ""),
      internalNote: String(formData.get("internalNote") ?? ""),
    });
    return "error" in result ? fail(result) : { ok: true };
  },
  "save-attendance": async (formData, ctx) => {
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
      offeringId: ctx.offeringId,
      sessionId: String(formData.get("sessionId") ?? ""),
      marks,
      actorId: ctx.actorId,
    });
    return "error" in result ? fail(result) : { ok: true };
  },
};

export const MANAGE_CONTENT_INTENTS = Object.keys(CONTENT_INTENT_HANDLERS);

/**
 * Shared manager-action dispatcher for every education surface (legacy manage
 * route, course-page hub, People/Setup routes and their portal mirrors).
 * Returns data or an error Response — navigation (delete/duplicate redirects)
 * is the caller's job.
 */
export async function runManageAction(
  formData: FormData,
  ctx: ManageActionContext,
): Promise<ManageActionResult> {
  const intent = String(formData.get("intent") ?? "");
  const handler = CONTENT_INTENT_HANDLERS[intent];
  if (handler) {
    if (!(await isOfferingManager(ctx.actorId, ctx.offeringId)))
      return Response.json({ error: "Forbidden" }, { status: 403 });
    return handler(formData, ctx);
  }

  // Pin the offering id from the URL so a form can't retarget another offering.
  formData.set("offeringId", ctx.offeringId);
  const result = await runOfferingAction(formData, ctx.actorId);
  if ("error" in result)
    return Response.json({ error: result.error }, { status: result.status });
  return result;
}
