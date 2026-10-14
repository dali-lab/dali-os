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

import { moveForm } from "~/forms/lib/form-page.server";
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
  itemType: z.enum(["file", "form", "rubric", "agreement"]),
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

  // ── Block moves on placement-locked types ────────────────────────────────
  // Agreements and rubrics are auto-filed into Core-managed folders by other
  // processes; their Drive placement must not be changed via the move endpoint.
  // (Email templates ARE relocatable — handled below with a Core check.)
  if (itemType === "agreement" || itemType === "rubric") {
    return withCors(
      request,
      Response.json(
        { error: "This item is filed automatically and can't be moved." },
        { status: 400 },
      ),
    );
  }

  // The source and destination checks read independent rows, so they run
  // together; the source verdict still wins when both refuse.
  const refuse = (error: string, status: number) =>
    withCors(request, Response.json({ error }, { status }));

  async function refuseSource(): Promise<Response | null> {
    if (itemType === "file") {
      // File manage: Core or, for project-scoped files, a member of the owning
      // project. Lab-scoped files (no projectId) require Core for now.
      const [file, core] = await Promise.all([
        prisma.projectFile.findUnique({
          where: { id: itemId },
          select: { projectId: true, archivedAt: true },
        }),
        isCore(userId, request),
      ]);
      if (!file || file.archivedAt !== null) return refuse("File not found", 404);
      const canManage =
        core || (file.projectId != null && (await isProjectMember(userId, file.projectId, request)));
      return canManage ? null : refuse("You can't move this file", 403);
    }
    // form — agreements and rubrics are rejected by the guard above.
    const [form, canManage] = await Promise.all([
      prisma.form.findUnique({ where: { id: itemId }, select: { id: true } }),
      // Form manage: must pass the canViewForms gate (Core/Admin/Instructor).
      canViewForms(userId),
    ]);
    if (!form) return refuse("Form not found", 404);
    return canManage ? null : refuse("You can't move this form", 403);
  }

  async function refuseDestination(): Promise<Response | null> {
    if (destFolderPageId === null) return null;
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
      return refuse("Destination folder not found", 404);
    }
    const folderAccess = await getPageAccess(userId, folder, request);
    return folderAccess.canEdit ? null : refuse("You can't place items in that folder", 403);
  }

  const [sourceRefusal, destinationRefusal] = await Promise.all([refuseSource(), refuseDestination()]);
  if (sourceRefusal) return sourceRefusal;
  if (destinationRefusal) return destinationRefusal;

  // ── Apply the placement ───────────────────────────────────────────────────

  if (itemType === "file") {
    await prisma.projectFile.update({
      where: { id: itemId },
      data: { folderPageId: destFolderPageId },
    });
  } else {
    // form — agreements and rubrics are rejected by the guard above.
    await moveForm(itemId, destFolderPageId);
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
