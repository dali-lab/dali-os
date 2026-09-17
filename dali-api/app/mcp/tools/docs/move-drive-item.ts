// MCP `move_drive_item` — set the folderPageId placement for a file, form,
// or email template in the unified drive tree.
// Mirrors POST /api/drive/move. Agreements and rubrics are auto-filed and
// are rejected by this tool (same as the web route).
//
// ACCESS MODEL:
//   file         — Core OR project member
//   form         — canViewForms (Core/Admin/Instructor)
//   emailTemplate — Core only
//   Destination folder — getPageAccess(...).canEdit (or null to unplace)

import { prisma } from "~/lib/db";
import { isCore, isProjectMember, canViewForms } from "~/lib/roles";
import { getPageAccess } from "~/lib/pageAccess.server";
import { logAuditEvent } from "~/lib/audit";

export const MOVE_DRIVE_ITEM_TOOL = {
  name: "move_drive_item",
  description:
    "Move a file, form, or email template to a different folder in the Drive (sets folderPageId). Pass destFolderPageId=null to unplace (remove from the folder tree). Agreements and rubrics are auto-filed and cannot be moved here. The caller must have appropriate access to both the item and the destination folder.",
  inputSchema: {
    type: "object" as const,
    properties: {
      itemType: {
        type: "string",
        enum: ["file", "form", "emailTemplate"],
        description: "Type of drive item to move.",
      },
      itemId: { type: "string", minLength: 1, description: "ID of the item to move." },
      destFolderPageId: {
        type: "string",
        description: "Target folder Page id. Omit to unplace (remove from the folder tree).",
      },
    },
    required: ["itemType", "itemId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export class MoveDriveItemError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "MoveDriveItemError";
  }
}

type Input = {
  itemType: "file" | "form" | "emailTemplate";
  itemId: string;
  destFolderPageId?: string;
};

export async function runMoveDriveItem(callerId: string, input: Input) {
  const { itemType, itemId } = input;
  // Omitted destination = unplace (remove from the folder tree).
  const destFolderPageId = input.destFolderPageId ?? null;

  // Authorise the caller for the source item.
  if (itemType === "file") {
    const file = await prisma.projectFile.findUnique({
      where: { id: itemId },
      select: { projectId: true, archivedAt: true },
    });
    if (!file || file.archivedAt !== null) throw new MoveDriveItemError("File not found", 404);
    const canManage =
      (await isCore(callerId)) ||
      (file.projectId != null && (await isProjectMember(callerId, file.projectId)));
    if (!canManage) throw new MoveDriveItemError("You can't move this file", 403);
  } else if (itemType === "form") {
    const form = await prisma.form.findUnique({ where: { id: itemId }, select: { id: true } });
    if (!form) throw new MoveDriveItemError("Form not found", 404);
    if (!(await canViewForms(callerId))) throw new MoveDriveItemError("You can't move this form", 403);
  } else {
    // emailTemplate
    const exists = await prisma.emailTemplate.findUnique({ where: { id: itemId }, select: { id: true } });
    if (!exists) throw new MoveDriveItemError("Email template not found", 404);
    if (!(await isCore(callerId))) throw new MoveDriveItemError("You can't move this email template", 403);
  }

  // Authorise the destination folder.
  if (destFolderPageId !== null) {
    const folder = await prisma.page.findUnique({
      where: { id: destFolderPageId },
      select: { id: true, kind: true, archivedAt: true },
    });
    if (!folder || folder.archivedAt !== null || folder.kind !== "Folder") {
      throw new MoveDriveItemError("Destination folder not found", 404);
    }
    const folderAccess = await getPageAccess(callerId, destFolderPageId);
    if (!folderAccess.canEdit) throw new MoveDriveItemError("You can't place items in that folder", 403);
  }

  // Apply the placement.
  if (itemType === "file") {
    await prisma.projectFile.update({ where: { id: itemId }, data: { folderPageId: destFolderPageId } });
  } else if (itemType === "form") {
    await prisma.form.update({ where: { id: itemId }, data: { folderPageId: destFolderPageId } });
  } else {
    await prisma.emailTemplate.update({ where: { id: itemId }, data: { folderPageId: destFolderPageId } });
  }

  await logAuditEvent({
    action: "drive.item.move",
    userId: callerId,
    targetId: itemId,
    metadata: { itemType, destFolderPageId },
  }).catch((err) => console.error("move_drive_item audit failed", err));

  return { ok: true };
}
