// POST /api/drive/move: set `folderPageId` for the non-page Drive items. Pages use /api/pages/:id/move.

import { moveForm } from "~/forms/lib/form-page.server";
import type { Route } from "./+types/api.drive.move";
import { z } from "zod";
import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { canEditFile } from "~/lib/fileAccess.server";
import { canManageFormPlacement } from "~/forms/lib/form-access.server";
import { getPageAccess } from "~/lib/pageAccess.server";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { logAuditEvent } from "~/lib/audit";
import { loadAncestorChain } from "~/lib/page-ancestry.server";
import { nearestRoot, rootBoundMoveError } from "~/lib/drive-roots";

const BodySchema = z.object({
  itemType: z.enum(["file", "form", "rubric", "agreement"]),
  itemId: z.string().min(1),
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

  if ((itemType === "agreement" || itemType === "rubric") && destFolderPageId === null) {
    return withCors(request, Response.json({ error: "Pick a folder to move this into" }, { status: 400 }));
  }

  // The source and destination checks read independent rows, so they run
  // together; the source verdict still wins when both refuse.
  const refuse = (error: string, status: number) =>
    withCors(request, Response.json({ error }, { status }));

  let sourceFolderId: string | null = null;

  async function refuseSource(): Promise<Response | null> {
    if (itemType === "file") {
      const file = await prisma.projectFile.findUnique({
        where: { id: itemId },
        select: {
          id: true,
          projectId: true,
          workspaceType: true,
          workspaceId: true,
          folderPageId: true,
          linkAccess: true,
          linkPermission: true,
          archivedAt: true,
        },
      });
      if (!file || file.archivedAt !== null) return refuse("File not found", 404);
      sourceFolderId = file.folderPageId ?? null;
      return (await canEditFile(userId, file, request)) ? null : refuse("You can't move this file", 403);
    }
    if (itemType === "agreement" || itemType === "rubric") {
      const [row, core] = await Promise.all([
        itemType === "agreement"
          ? prisma.signingDocument.findUnique({ where: { id: itemId }, select: { folderPageId: true, archivedAt: true } })
          : prisma.rubric.findUnique({ where: { id: itemId }, select: { folderPageId: true } }),
        isCore(userId, request),
      ]);
      const label = itemType === "agreement" ? "Agreement" : "Rubric";
      if (!row || ("archivedAt" in row && row.archivedAt !== null)) return refuse(`${label} not found`, 404);
      sourceFolderId = row.folderPageId ?? null;
      return core ? null : refuse(`You can't move this ${label.toLowerCase()}`, 403);
    }
    const [form, canManage] = await Promise.all([
      prisma.form.findUnique({ where: { id: itemId }, select: { id: true, folderPageId: true } }),
      canManageFormPlacement(userId, itemId, request),
    ]);
    if (!form) return refuse("Form not found", 404);
    sourceFolderId = form.folderPageId ?? null;
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

  const [sourceChain, destChain] = await Promise.all([
    sourceFolderId ? loadAncestorChain(sourceFolderId) : [],
    destFolderPageId ? loadAncestorChain(destFolderPageId) : [],
  ]);
  const rootRefusal = rootBoundMoveError(nearestRoot(sourceChain), nearestRoot(destChain));
  if (rootRefusal) return refuse(rootRefusal, 400);

  // ── Apply the placement ───────────────────────────────────────────────────

  if (itemType === "file") {
    await prisma.projectFile.update({ where: { id: itemId }, data: { folderPageId: destFolderPageId } });
  } else if (itemType === "agreement") {
    await prisma.signingDocument.update({ where: { id: itemId }, data: { folderPageId: destFolderPageId } });
  } else if (itemType === "rubric") {
    await prisma.rubric.update({ where: { id: itemId }, data: { folderPageId: destFolderPageId } });
  } else {
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
