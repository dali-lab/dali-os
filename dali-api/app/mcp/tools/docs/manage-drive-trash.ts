// MCP `manage_drive_trash` — restore or permanently purge an archived drive item.
// Mirrors POST /api/drive/trash (intent=restore|purge). Access model:
//   - Pages (doc/folder): getPageAccess(...).canEdit
//   - Files: canEditFile
//   - Forms: canViewForms (Core/Admin/Instructor)
//
// Purge of forms checks formDeletionBlockers before deleting.

import { prisma } from "~/lib/db";
import { canViewForms } from "~/lib/roles";
import { getPageAccess } from "~/lib/pageAccess.server";
import { canEditFile } from "~/lib/fileAccess.server";
import { requireForAction } from "~/mcp/registry";
import type { McpCtx, McpTool } from "~/mcp/registry";

export const MANAGE_DRIVE_TRASH_TOOL_DEF = {
  name: "manage_drive_trash",
  description:
    "Restore or permanently purge an archived drive item. Pages require edit access; files require edit-file access; forms require Core/Admin/Instructor role. Purging a form fails if the form is still bound to active hiring or education workflows.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["restore", "purge"],
        description: "'restore' clears archivedAt; 'purge' permanently deletes.",
      },
      type: {
        type: "string",
        enum: ["doc", "folder", "file", "form"],
        description: "Item type.",
      },
      id: { type: "string", minLength: 1, description: "Item id." },
    },
    required: ["action", "type", "id"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export class ManageDriveTrashError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "ManageDriveTrashError";
  }
}

const ACTION_REQUIRED: Record<string, string[]> = {
  restore: ["type", "id"],
  purge: ["type", "id"],
};

type ManageDriveTrashInput = {
  action: "restore" | "purge";
  type: "doc" | "folder" | "file" | "form";
  id: string;
};

export async function runManageDriveTrash(callerId: string, input: ManageDriveTrashInput) {
  requireForAction(input.action, input as Record<string, unknown>, ACTION_REQUIRED);

  const { action, type, id } = input;

  if (type === "form") {
    if (!(await canViewForms(callerId))) throw new ManageDriveTrashError("Forbidden", 403);
    const form = await prisma.form.findUnique({ where: { id }, select: { id: true, archivedAt: true } });
    if (!form) throw new ManageDriveTrashError("Form not found", 404);

    if (action === "restore") {
      await prisma.form.update({ where: { id }, data: { archivedAt: null } });
      return { ok: true };
    }

    // purge — check for active bindings
    const { formDeletionBlockers } = await import("~/forms/lib/form-usages.server");
    const blockers = await formDeletionBlockers(id);
    if (blockers.length > 0) {
      throw new ManageDriveTrashError(
        `This form is in use: ${blockers.join("; ")}. Remove those bindings first.`,
        409,
      );
    }
    await prisma.form.delete({ where: { id } });
    return { ok: true };
  }

  if (type === "file") {
    const file = await prisma.projectFile.findUnique({
      where: { id },
      select: { id: true, projectId: true, workspaceType: true, workspaceId: true, folderPageId: true, archivedAt: true },
    });
    if (!file) throw new ManageDriveTrashError("File not found", 404);
    const ok = await canEditFile(callerId, file);
    if (!ok) throw new ManageDriveTrashError("Forbidden", 403);

    if (action === "restore") {
      await prisma.projectFile.update({ where: { id }, data: { archivedAt: null } });
    } else {
      await prisma.projectFile.delete({ where: { id } });
    }
    return { ok: true };
  }

  // doc or folder
  const access = await getPageAccess(callerId, id);
  if (!access.canEdit) throw new ManageDriveTrashError("Forbidden", 403);

  if (action === "restore") {
    await prisma.page.update({ where: { id }, data: { archivedAt: null } });
  } else {
    await prisma.page.delete({ where: { id } });
  }
  return { ok: true };
}

export const MANAGE_DRIVE_TRASH: McpTool = {
  def: MANAGE_DRIVE_TRASH_TOOL_DEF,
  run: (ctx: McpCtx, args) =>
    runManageDriveTrash(ctx.user.id, args as unknown as ManageDriveTrashInput),
};
