import { prisma } from "~/lib/db.server";
import { setFormArchived } from "~/forms/lib/form-page.server";
import { getPageAccess } from "~/lib/pageAccess.server";
import { canEditFile } from "~/lib/fileAccess.server";
import { logAuditEvent } from "~/lib/audit";
import { canManageFormPlacement } from "~/forms/lib/form-access.server";
import { trashNote, trashNotebook } from "~/calendar/lib/notebooks.server";
import { archiveNote } from "~/members/lib/personal-notes-actions.server";
import { NoteForbiddenError, NoteNotFoundError, requireNoteOwner } from "~/members/lib/personal-notes.server";
import { requireForAction } from "../../errors";
import type { McpCtx, McpTool } from "~/mcp/registry";
import { runDeleteProjectDocument, runDeleteProjectFile } from "../document-curation";
import { runDeleteLabDocument } from "./lab-documents";
import { archiveDescendants, restorePageSubtree } from "~/drive/lib/page-trash.server";

export const MANAGE_DRIVE_TRASH_TOOL_DEF = {
  name: "manage_drive_trash",
  description:
    "Move a drive item to the trash, or restore it from the trash. Works on pages in any workspace (lab, project, notebook, personal note), project and drive files, and forms. Trashing a folder trashes everything inside it, and restoring it brings back what was trashed with it. Pages need edit access (lab pages: the creator or Core; personal notes: the owner; notebooks: someone who can manage them; a note inside a notebook: edit access on the note and the notebook, and a personal note's owner — trashing a notebook's last note trashes the notebook too, unless a meeting series files into it); files need edit-file access; forms need edit access on the form. See list_drive_trash for what is in the trash and purge_drive_item to delete for good.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["trash", "restore"],
        description: "'trash' moves the item to the trash; 'restore' brings it back.",
      },
      type: {
        type: "string",
        enum: ["doc", "folder", "file", "form"],
        description: "Item type. Use doc for documents, notes, slide decks and notebooks.",
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
  trash: ["type", "id"],
  restore: ["type", "id"],
};

type ManageDriveTrashInput = {
  action: "trash" | "restore";
  type: "doc" | "folder" | "file" | "form";
  id: string;
};

async function trashForm(callerId: string, id: string) {
  if (!(await canManageFormPlacement(callerId, id))) throw new ManageDriveTrashError("Forbidden", 403);
  const form = await prisma.form.findUnique({ where: { id }, select: { id: true, archivedAt: true } });
  if (!form) throw new ManageDriveTrashError("Form not found", 404);
  if (form.archivedAt !== null) throw new ManageDriveTrashError("Form is already in the trash", 400);
  await setFormArchived(id, new Date());
  return { ok: true as const };
}

async function trashFile(callerId: string, id: string) {
  const file = await prisma.projectFile.findUnique({
    where: { id },
    select: { id: true, title: true, projectId: true, workspaceType: true, workspaceId: true, folderPageId: true, archivedAt: true },
  });
  if (!file) throw new ManageDriveTrashError("File not found", 404);
  if (file.projectId) {
    const out = await runDeleteProjectFile(callerId, { fileId: id });
    return { ok: true as const, alreadyInTrash: out.alreadyArchived };
  }
  if (!(await canEditFile(callerId, file))) throw new ManageDriveTrashError("Forbidden", 403);
  if (file.archivedAt !== null) return { ok: true as const, alreadyInTrash: true };
  await prisma.projectFile.update({ where: { id }, data: { archivedAt: new Date() } });
  await logAuditEvent({
    action: "projectFile.delete",
    userId: callerId,
    targetId: id,
    metadata: { title: file.title, via: "mcp" },
  });
  return { ok: true as const, alreadyInTrash: false };
}

async function trashPage(callerId: string, id: string) {
  const page = await prisma.page.findUnique({
    where: { id },
    select: { id: true, kind: true, workspaceType: true, workspaceId: true, parent: { select: { kind: true } } },
  });
  if (!page) throw new ManageDriveTrashError("Document not found", 404);
  if (page.kind === "Form") throw new ManageDriveTrashError("This is a form. Pass type form.", 400);

  if (page.kind === "Notebook") {
    await trashNotebook(id, callerId);
    return { ok: true as const };
  }
  if (page.parent?.kind === "Notebook") {
    return { ok: true as const, ...(await trashNote(id, callerId)) };
  }
  switch (page.workspaceType) {
    case "Lab":
      return runDeleteLabDocument(callerId, { pageId: id });
    case "Project":
      return runDeleteProjectDocument(callerId, { pageId: id });
    case "Member":
      try {
        await requireNoteOwner(id, callerId);
        const at = new Date();
        const archivedDescendants = await archiveDescendants(id, at, { profileVisible: false, labListing: "None" });
        await archiveNote(id, callerId, at);
        return { ok: true as const, archivedDescendants };
      } catch (err) {
        if (err instanceof NoteNotFoundError) throw new ManageDriveTrashError("Document not found", 404);
        if (err instanceof NoteForbiddenError) throw new ManageDriveTrashError(err.message, 403);
        throw err;
      }
    default:
      throw new ManageDriveTrashError("Course materials are managed with manage_offering_materials", 400);
  }
}

export async function runManageDriveTrash(callerId: string, input: ManageDriveTrashInput) {
  requireForAction(input.action, input as Record<string, unknown>, ACTION_REQUIRED);

  const { action, type, id } = input;

  if (action === "trash") {
    if (type === "form") return trashForm(callerId, id);
    if (type === "file") return trashFile(callerId, id);
    return trashPage(callerId, id);
  }

  if (type === "form") {
    if (!(await canManageFormPlacement(callerId, id))) throw new ManageDriveTrashError("Forbidden", 403);
    const form = await prisma.form.findUnique({ where: { id }, select: { id: true } });
    if (!form) throw new ManageDriveTrashError("Form not found", 404);
    await setFormArchived(id, null);
    return { ok: true };
  }

  if (type === "file") {
    const file = await prisma.projectFile.findUnique({
      where: { id },
      select: { id: true, projectId: true, workspaceType: true, workspaceId: true, folderPageId: true },
    });
    if (!file) throw new ManageDriveTrashError("File not found", 404);
    if (!(await canEditFile(callerId, file))) throw new ManageDriveTrashError("Forbidden", 403);
    await prisma.projectFile.update({ where: { id }, data: { archivedAt: null } });
    return { ok: true };
  }

  const access = await getPageAccess(callerId, id, undefined, { includeArchived: true });
  if (!access.canEdit) throw new ManageDriveTrashError("Forbidden", 403);
  await restorePageSubtree(id);
  return { ok: true };
}

export const MANAGE_DRIVE_TRASH: McpTool = {
  def: MANAGE_DRIVE_TRASH_TOOL_DEF,
  run: (ctx: McpCtx, args) =>
    runManageDriveTrash(ctx.user.id, args as unknown as ManageDriveTrashInput),
};
