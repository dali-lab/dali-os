import { prisma } from "~/lib/db.server";
import {
  getPageAccess,
  PAGE_ACCESS_SELECT,
  type PageShape,
} from "~/lib/pageAccess.server";
import { moveIntoNotebook } from "~/lib/pages";
import { nameConflictResponse } from "~/drive/lib/page-names.server";

export class NotebookError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "NotebookError";
  }
}

/** The JSON response for a NotebookError; anything else is rethrown. */
export function notebookErrorResponse(err: unknown): Response {
  if (err instanceof NotebookError) return Response.json({ error: err.message }, { status: err.status });
  const conflict = nameConflictResponse(err);
  if (conflict) return conflict;
  throw err;
}

export const notebookRowSelect = {
  ...PAGE_ACCESS_SELECT,
  kind: true,
  title: true,
  notebookKey: true,
  templatePageId: true,
} as const;

/** A live notebook the actor can edit. 404 hides one they cannot see. */
export async function loadEditableNotebook(notebookId: string, actorId: string, request?: Request) {
  const notebook = await prisma.page.findUnique({ where: { id: notebookId }, select: notebookRowSelect });
  if (!notebook || notebook.kind !== "Notebook" || notebook.archivedAt !== null) {
    throw new NotebookError("Notebook not found", 404);
  }
  const access = await getPageAccess(actorId, notebook, request);
  if (!access.canView) throw new NotebookError("Notebook not found", 404);
  if (!access.canEdit) throw new NotebookError("You can't edit this notebook", 403);
  return notebook;
}

export async function canManageNotebook(
  userId: string,
  notebook: { id: string; createdById?: string | null } & PageShape,
  request?: Request,
): Promise<boolean> {
  const base = await getPageAccess(userId, notebook, request, { ignoreShares: true });
  if (base.canEdit || notebook.createdById === userId) return true;
  const organizing = await prisma.scheduledMeeting.findFirst({
    where: { notebookId: notebook.id, organizerId: userId },
    select: { id: true },
  });
  return organizing !== null;
}

/** A live notebook the actor can restructure, not just write in. */
export async function loadManageableNotebook(notebookId: string, actorId: string, request?: Request) {
  const notebook = await loadEditableNotebook(notebookId, actorId, request);
  if (!(await canManageNotebook(actorId, notebook, request))) {
    throw new NotebookError("You can't manage this notebook", 403);
  }
  return notebook;
}

/**
 * File a doc or meeting note as a tab of a notebook. Needs edit on both. A note
 * keeps its meeting link; a plain doc becomes a tab labelled by its title. The
 * notebook the page left is trashed when that emptied it.
 */
export async function addToNotebook(pageId: string, notebookId: string, actorId: string): Promise<void> {
  const notebook = await loadEditableNotebook(notebookId, actorId);
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: {
      ...PAGE_ACCESS_SELECT,
      kind: true,
      projectAsOverview: { select: { id: true } },
      projectAsPRD: { select: { id: true } },
    },
  });
  if (!page || page.archivedAt !== null) throw new NotebookError("Document not found", 404);
  const access = await getPageAccess(actorId, page);
  if (!access.canView) throw new NotebookError("Document not found", 404);
  if (!access.canEdit) throw new NotebookError("You can't move this document", 403);
  if (page.kind !== "FreeForm") throw new NotebookError("Only documents can be added to a notebook", 400);
  if (page.projectAsOverview || page.projectAsPRD) {
    throw new NotebookError("The Overview and PRD docs can't be moved", 400);
  }
  if (page.workspaceType === "EducationOffering") {
    throw new NotebookError("Course documents can't be added to a notebook", 400);
  }
  if (page.id === notebook.id) throw new NotebookError("A notebook can't be added to itself", 400);
  await moveIntoNotebook(pageId, notebookId);
}
