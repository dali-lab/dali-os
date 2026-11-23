import { deleteForm } from "~/forms/lib/form-page.server";
import { prisma } from "~/lib/db.server";
import { getPageAccess } from "~/lib/pageAccess.server";
import { canEditFile } from "~/lib/fileAccess.server";
import { isRoot, ROOT_DELETE_ERROR } from "~/drive/lib/drive-roots";
import { canManageFormPlacement } from "~/forms/lib/form-access.server";
import type { McpCtx, McpTool } from "~/mcp/registry";

export const PURGE_DRIVE_ITEM_TOOL_DEF = {
  name: "purge_drive_item",
  description:
    "Permanently delete an item that is already in the trash. This cannot be undone. Pages need edit access, files need edit-file access, forms need edit access on the form and fail while still bound to active hiring or education workflows. Trash an item first with manage_drive_trash.",
  inputSchema: {
    type: "object" as const,
    properties: {
      type: { type: "string", enum: ["doc", "folder", "file", "form"], description: "Item type." },
      id: { type: "string", minLength: 1, description: "Id of an item in the trash." },
    },
    required: ["type", "id"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export class PurgeDriveItemError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "PurgeDriveItemError";
  }
}

const NOT_IN_TRASH = "Only items in the trash can be deleted for good. Trash it first with manage_drive_trash.";

type PurgeDriveItemInput = { type: "doc" | "folder" | "file" | "form"; id: string };

export async function runPurgeDriveItem(callerId: string, input: PurgeDriveItemInput) {
  const { type, id } = input;

  if (type === "form") {
    if (!(await canManageFormPlacement(callerId, id))) throw new PurgeDriveItemError("Forbidden", 403);
    const form = await prisma.form.findUnique({ where: { id }, select: { id: true, archivedAt: true } });
    if (!form) throw new PurgeDriveItemError("Form not found", 404);
    if (form.archivedAt === null) throw new PurgeDriveItemError(NOT_IN_TRASH, 400);
    const { formDeletionBlockers } = await import("~/forms/lib/form-usages.server");
    const blockers = await formDeletionBlockers(id);
    if (blockers.length > 0) {
      throw new PurgeDriveItemError(
        `This form is in use: ${blockers.join("; ")}. Remove those bindings first.`,
        409,
      );
    }
    await deleteForm(id);
    return { ok: true };
  }

  if (type === "file") {
    const file = await prisma.projectFile.findUnique({
      where: { id },
      select: { id: true, projectId: true, workspaceType: true, workspaceId: true, folderPageId: true, archivedAt: true },
    });
    if (!file) throw new PurgeDriveItemError("File not found", 404);
    if (!(await canEditFile(callerId, file))) throw new PurgeDriveItemError("Forbidden", 403);
    if (file.archivedAt === null) throw new PurgeDriveItemError(NOT_IN_TRASH, 400);
    await prisma.projectFile.delete({ where: { id } });
    return { ok: true };
  }

  const access = await getPageAccess(callerId, id, undefined, { includeArchived: true });
  if (!access.canEdit) throw new PurgeDriveItemError("Forbidden", 403);
  const target = await prisma.page.findUnique({ where: { id }, select: { folderType: true, archivedAt: true } });
  if (!target) throw new PurgeDriveItemError("Document not found", 404);
  if (isRoot(target)) throw new PurgeDriveItemError(ROOT_DELETE_ERROR, 400);
  if (target.archivedAt === null) throw new PurgeDriveItemError(NOT_IN_TRASH, 400);
  await prisma.page.delete({ where: { id } });
  return { ok: true };
}

export const PURGE_DRIVE_ITEM: McpTool = {
  def: PURGE_DRIVE_ITEM_TOOL_DEF,
  run: (ctx: McpCtx, args) => runPurgeDriveItem(ctx.user.id, args as unknown as PurgeDriveItemInput),
};
