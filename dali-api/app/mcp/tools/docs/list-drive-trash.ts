// MCP `list_drive_trash` — list archived (trashed) drive items the caller
// can access. Mirrors GET /api/drive/trash access model:
//   - Pages: getPageAccess(...).canView
//   - Files: canEditFile (restore/delete requires edit, not just view)
//   - Forms: canViewForms (Core/Admin/Instructor)

import { prisma } from "~/lib/db";
import { canViewForms } from "~/lib/roles";
import { getPageAccess } from "~/lib/pageAccess.server";
import { canEditFile } from "~/lib/fileAccess.server";

export const LIST_DRIVE_TRASH_TOOL = {
  name: "list_drive_trash",
  description:
    "List archived (trashed) drive items the caller can access: docs, folders, files, and forms. Pages require at least view access; files require edit access; forms require Core/Admin/Instructor role. Returns items sorted newest-archived first.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export class ListDriveTrashError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "ListDriveTrashError";
  }
}

export async function runListDriveTrash(callerId: string) {
  const userCanViewForms = await canViewForms(callerId);

  // Archived pages (docs + folders).
  const archivedPages = await prisma.page.findMany({
    where: {
      archivedAt: { not: null },
      kind: { in: ["FreeForm", "Folder", "Structured"] },
    },
    select: { id: true, title: true, archivedAt: true, kind: true },
    orderBy: { archivedAt: "desc" },
  });

  const accessiblePages = (
    await Promise.all(
      archivedPages.map(async (p) => {
        const access = await getPageAccess(callerId, p.id);
        return access.canView ? p : null;
      }),
    )
  ).filter(Boolean) as typeof archivedPages;

  // Archived files the caller can edit.
  const archivedFiles = await prisma.projectFile.findMany({
    where: { archivedAt: { not: null } },
    select: {
      id: true,
      title: true,
      archivedAt: true,
      projectId: true,
      workspaceType: true,
      workspaceId: true,
      folderPageId: true,
    },
    orderBy: { archivedAt: "desc" },
  });

  const accessibleFiles = (
    await Promise.all(
      archivedFiles.map(async (f) => {
        const ok = await canEditFile(callerId, f);
        return ok ? f : null;
      }),
    )
  ).filter(Boolean) as typeof archivedFiles;

  // Archived forms — canViewForms gate.
  const archivedForms = userCanViewForms
    ? await prisma.form.findMany({
        where: { archivedAt: { not: null } },
        select: { id: true, name: true, archivedAt: true },
        orderBy: { archivedAt: "desc" },
      })
    : [];

  const items = [
    ...accessiblePages.map((p) => ({
      id: p.id,
      type: p.kind === "Folder" ? ("folder" as const) : ("doc" as const),
      title: p.title ?? "",
      archivedAt: p.archivedAt!.toISOString(),
    })),
    ...accessibleFiles.map((f) => ({
      id: f.id,
      type: "file" as const,
      title: f.title,
      archivedAt: f.archivedAt!.toISOString(),
    })),
    ...archivedForms.map((f) => ({
      id: f.id,
      type: "form" as const,
      title: f.name,
      archivedAt: f.archivedAt!.toISOString(),
    })),
  ].sort((a, b) => new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime());

  return { items };
}
