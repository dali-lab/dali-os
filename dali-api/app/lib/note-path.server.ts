// "Filed to General ▸ Meeting assets ▸ Weekly sync notes": where a meeting note
// just landed in the Drive, for the toast that follows creating one.

import { prisma } from "~/lib/db";
import { DRIVE_SPACES } from "~/lib/drive-spaces";
import { driveLocation, locationFromCrumbs } from "~/lib/drive-reveal.server";
import type { ItemLocation } from "~/components/drive/location";
import { driveFolderCrumbsBulk, type DriveCrumbs } from "~/lib/drive-crumbs.server";

const LAB_ROOT_CRUMBS: DriveCrumbs = { scope: "lab", folders: [] };

export type NotePath = { label: string; href: string };

export const PATH_SEPARATOR = " ▸ ";

/** Space, then folders, then notebook, as one label. */
export function formatFiledPath(parts: string[]): string {
  return parts.join(PATH_SEPARATOR);
}

type NotebookPlace = { parentPageId: string | null; workspaceType: string; workspaceId: string | null };

function locationParts(
  where: { scope: string; workspaceFolderId: string | null; folders: { title: string }[] },
  projectName: string | undefined,
): string[] {
  const space = DRIVE_SPACES.find((s) => s.key === where.scope)?.label ?? where.scope;
  return [space, ...(projectName !== undefined ? [projectName] : []), ...where.folders.map((f) => f.title || "Untitled folder")];
}

const isProjectLocation = (where: { scope: string; workspaceFolderId: string | null }) =>
  where.scope === "projects" && where.workspaceFolderId !== null;

/** Where a notebook sits, with the ids the Drive opens: its space, the project, and the folders above it. */
export async function notebookItemLocation(
  notebook: NotebookPlace,
  viewerSub: string,
  request?: Request,
): Promise<ItemLocation> {
  const where = await driveLocation(notebook.parentPageId, notebook, viewerSub, request);
  const project = isProjectLocation(where)
    ? await prisma.project.findUnique({ where: { id: where.workspaceFolderId! }, select: { name: true } })
    : null;
  const [scopeLabel, ...titles] = locationParts(where, project?.name);
  const ids = [
    ...(project ? [where.workspaceFolderId!] : []),
    ...where.folders.map((f) => f.id),
  ];
  const folders = titles.map((title, i) => ({ id: ids[i], title }));
  return {
    scopeId: where.scope,
    scopeLabel,
    folderId: ids.at(-1) ?? where.workspaceFolderId,
    folders,
    path: formatFiledPath([scopeLabel, ...titles]),
  };
}

/** Where a notebook sits: its space, the project, and the folders above it. */
export async function notebookLocationParts(
  notebook: NotebookPlace,
  viewerSub: string,
  request?: Request,
): Promise<string[]> {
  const location = await notebookItemLocation(notebook, viewerSub, request);
  return [location.scopeLabel, ...location.folders.map((f) => f.title)];
}

/** `notebookLocationParts` for many notebooks at once, keyed by notebook id, in a fixed number of queries. */
export async function notebookLocationPartsBulk(
  notebooks: ReadonlyArray<NotebookPlace & { id: string }>,
  viewerSub: string,
  request?: Request,
): Promise<Map<string, string[]>> {
  const crumbs = await driveFolderCrumbsBulk(
    notebooks.flatMap((n) => (n.parentPageId ? [n.parentPageId] : [])),
    viewerSub,
    request,
  );
  const locations = notebooks.map((n) => ({
    id: n.id,
    where: locationFromCrumbs((n.parentPageId && crumbs.get(n.parentPageId)) || LAB_ROOT_CRUMBS, n),
  }));

  const projectIds = [...new Set(locations.flatMap(({ where }) => (isProjectLocation(where) ? [where.workspaceFolderId!] : [])))];
  const projects = projectIds.length
    ? await prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(projects.map((p) => [p.id, p.name]));

  return new Map(
    locations.map(({ id, where }) => [
      id,
      locationParts(where, isProjectLocation(where) ? nameById.get(where.workspaceFolderId!) : undefined),
    ]),
  );
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
