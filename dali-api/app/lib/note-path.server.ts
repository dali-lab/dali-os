// "Filed to General ▸ Meeting assets ▸ Weekly sync notes": where a meeting note
// just landed in the Drive, for the toast that follows creating one.

import { prisma } from "~/lib/db";
import { DRIVE_SPACES } from "~/lib/drive-spaces";
import { driveLocation } from "~/lib/drive-reveal.server";

export type NotePath = { label: string; href: string };

export const PATH_SEPARATOR = " ▸ ";

/** Space, then folders, then notebook, as one label. */
export function formatFiledPath(parts: string[]): string {
  return parts.join(PATH_SEPARATOR);
}

/** Where a notebook sits: its space, the project, and the folders above it. */
export async function notebookLocationParts(
  notebook: { parentPageId: string | null; workspaceType: string; workspaceId: string | null },
  viewerSub: string,
  request?: Request,
): Promise<string[]> {
  const where = await driveLocation(notebook.parentPageId, notebook, viewerSub, request);
  const space = DRIVE_SPACES.find((s) => s.key === where.scope)?.label ?? where.scope;
  const project =
    where.scope === "projects" && where.workspaceFolderId
      ? await prisma.project.findUnique({
          where: { id: where.workspaceFolderId },
          select: { name: true },
        })
      : null;
  return [space, ...(project ? [project.name] : []), ...where.folders.map((f) => f.title || "Untitled folder")];
}

/** Null when the note has no notebook to name. */
export async function meetingNotePath({
  notePageId,
  notebookId,
  viewerSub,
  request,
}: {
  notePageId: string;
  notebookId: string | null;
  viewerSub: string;
  request?: Request;
}): Promise<NotePath | null> {
  if (!notebookId) return null;
  const notebook = await prisma.page.findUnique({
    where: { id: notebookId },
    select: { title: true, parentPageId: true, workspaceType: true, workspaceId: true },
  });
  if (!notebook) return null;

  return {
    label: formatFiledPath([...(await notebookLocationParts(notebook, viewerSub, request)), notebook.title]),
    href: `/documents/${notePageId}`,
  };
}
