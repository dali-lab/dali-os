// POST /api/drive/move — set the `folderPageId` placement for a file or form
// in the unified drive tree (Wave 3, drive-consolidation flag).
//
// This endpoint ONLY handles files and forms. Documents (pages) already have
// their own move endpoint at POST /api/pages/:id/move — do not call this one
// for pages.
//
// ACCESS MODEL (matches the no-widening guarantee in drive.server.ts):
//   - File:  the caller must be Core OR a member of the file's project.
//   - Form:  the caller must pass the `canViewForms` gate (Core/Admin/Instructor).
//   - Destination folder: the caller must be able to EDIT the folder page (via
//     `getPageAccess(...).canEdit`). Null dest (unplace) requires no folder check.
//
// Placement is ORGANISATION only — it does not change who can see or fill the
// item. Access rules in `drive.server.ts` and in the forms fill routes are
// unchanged by this write.

import type { Route } from "./+types/api.drive.move";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore, isProjectMember, canViewForms } from "~/lib/roles";
import { getPageAccess } from "~/lib/pageAccess.server";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { logAuditEvent } from "~/lib/audit";

const BodySchema = z.object({
  itemType: z.enum(["file", "form", "rubric", "agreement", "emailTemplate"]),
  itemId: z.string().min(1),
  // Null = unplace (remove from the unified tree; falls back to legacy location).
  destFolderPageId: z.string().min(1).nullable(),
});

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  const userId = auth.user.sub;

  const body = await parseJson(request, BodySchema);
  if (body instanceof Response) return withCors(request, body);

  const { itemType, itemId, destFolderPageId } = body;

  // ── Block moves on managed types ─────────────────────────────────────────
  // Agreements, rubrics, and email templates are auto-filed by other processes;
  // their Drive placement must not be changed via the move endpoint.
  if (itemType === "agreement" || itemType === "rubric" || itemType === "emailTemplate") {
    return withCors(
      request,
      Response.json(
        { error: "This item is filed automatically and can't be moved." },
        { status: 400 },
      ),
    );
  }

  // ── Authorise the caller for the source item ─────────────────────────────

  if (itemType === "file") {
    const file = await prisma.projectFile.findUnique({
      where: { id: itemId },
      select: { projectId: true, archivedAt: true },
    });
    if (!file || file.archivedAt !== null) {
      return withCors(request, Response.json({ error: "File not found" }, { status: 404 }));
    }
    // File manage: Core or, for project-scoped files, a member of the owning
    // project. Lab-scoped files (no projectId) require Core for now.
    const canManage =
      (await isCore(userId, request)) ||
      (file.projectId != null && (await isProjectMember(userId, file.projectId, request)));
    if (!canManage) {
      return withCors(
        request,
        Response.json({ error: "You can't move this file" }, { status: 403 }),
      );
    }
  } else if (itemType === "form") {
    const form = await prisma.form.findUnique({
      where: { id: itemId },
      select: { id: true },
    });
    if (!form) {
      return withCors(request, Response.json({ error: "Form not found" }, { status: 404 }));
    }
    // Form manage: must pass the canViewForms gate (Core/Admin/Instructor).
    const canManage = await canViewForms(userId);
    if (!canManage) {
      return withCors(
        request,
        Response.json({ error: "You can't move this form" }, { status: 403 }),
      );
    }
  } else if (itemType === "emailTemplate") {
    // emailTemplate — Core-only hiring artifact. Only Core may reposition it.
    const exists = await prisma.emailTemplate.findUnique({
      where: { id: itemId },
      select: { id: true },
    });
    if (!exists) {
      return withCors(request, Response.json({ error: "Email template not found" }, { status: 404 }));
    }
    const canManage = await isCore(userId, request);
    if (!canManage) {
      return withCors(
        request,
        Response.json({ error: "You can't move this email template" }, { status: 403 }),
      );
    }
  } else {
    // rubric | agreement — hiring artifacts. Manage requires Core or the forms
    // gate; the destination-folder canEdit check below is the real placement
    // guard (you can only drop into a folder you can edit, e.g. the Hiring drive).
    const table = itemType === "rubric" ? prisma.rubric : prisma.signingDocument;
    const exists = await (table as any).findUnique({ where: { id: itemId }, select: { id: true } });
    if (!exists) {
      return withCors(request, Response.json({ error: `${itemType} not found` }, { status: 404 }));
    }
    const canManage = (await isCore(userId, request)) || (await canViewForms(userId));
    if (!canManage) {
      return withCors(
        request,
        Response.json({ error: `You can't move this ${itemType}` }, { status: 403 }),
      );
    }
  }

  // ── Authorise the destination folder ─────────────────────────────────────

  if (destFolderPageId !== null) {
    const folder = await prisma.page.findUnique({
      where: { id: destFolderPageId },
      select: {
        id: true,
        kind: true,
        archivedAt: true,
        // Fields getPageAccess needs when passed as PageShape
        workspaceType: true,
        workspaceId: true,
        createdById: true,
        partnerVisible: true,
        profileVisible: true,
        labListing: true,
        linkAccess: true,
        linkPermission: true,
        scopeKind: true,
        scopeGroupId: true,
        scopePermission: true,
      },
    });
    if (!folder || folder.archivedAt !== null || folder.kind !== "Folder") {
      return withCors(
        request,
        Response.json({ error: "Destination folder not found" }, { status: 404 }),
      );
    }
    const folderAccess = await getPageAccess(userId, folder, request);
    if (!folderAccess.canEdit) {
      return withCors(
        request,
        Response.json(
          { error: "You can't place items in that folder" },
          { status: 403 },
        ),
      );
    }
  }

  // ── Apply the placement ───────────────────────────────────────────────────

  if (itemType === "file") {
    await prisma.projectFile.update({
      where: { id: itemId },
      data: { folderPageId: destFolderPageId },
    });
  } else if (itemType === "form") {
    await prisma.form.update({
      where: { id: itemId },
      data: { folderPageId: destFolderPageId },
    });
  } else if (itemType === "rubric") {
    await prisma.rubric.update({
      where: { id: itemId },
      data: { folderPageId: destFolderPageId },
    });
  } else if (itemType === "emailTemplate") {
    await prisma.emailTemplate.update({
      where: { id: itemId },
      data: { folderPageId: destFolderPageId },
    });
  } else {
    await prisma.signingDocument.update({
      where: { id: itemId },
      data: { folderPageId: destFolderPageId },
    });
  }

  await logAuditEvent({
    action: "drive.item.move",
    userId,
    targetId: itemId,
    metadata: {
      itemType,
      destFolderPageId,
    },
    request,
  });

  return withCors(request, Response.json({ ok: true }));
}
