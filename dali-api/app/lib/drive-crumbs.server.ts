import { prisma } from "~/lib/db";
import { driveRootCrumbs, workspaceDriveScope } from "~/lib/drive-crumbs";
import { getPageAccess } from "~/lib/pageAccess.server";
import { rootKeyFor } from "~/lib/drive-roots.server";

// Breadcrumb ancestry for an item that lives in the Drive tree. Walks up the
// Page folder chain from `folderPageId` to the (scoped) root, so a document,
// file, form, agreement or rubric can show its real folder path — Drive ▸
// Folder ▸ Subfolder ▸ item — instead of just Drive ▸ item.
//
// The scope is the folder's workspace: Member → "mine", Project → "projects",
// EducationOffering → "education". Within the Lab workspace, the nearest
// Root-typed ancestor decides ("core", "hiring" or "mentorship") and is not a
// crumb itself. A top-level folder shared with the Core group that has not been
// moved under the Core root yet still counts as Core. A folder that is archived (or deleted) collapses to the General root,
// matching where the listing surfaces its items.
//
// The trail is access-filtered against `viewerSub`: a viewer who reaches the
// item through a share or "Everyone in the lab" General access — but has no
// access to the scoped folder it lives in — must not see the folder names or
// the Core/Hiring drive leak through the breadcrumb. Ancestors the viewer
// can't view are dropped and an unviewable scoped root collapses to the plain
// Lab drive, mirroring what Drive's own listing already hides.

export type DriveCrumb = { id: string; title: string; iconEmoji: string | null };

export type DriveCrumbs = {
  /** Drive scope the item lives in: "lab" | "core" | "hiring" | "mentorship" (Lab workspace) or
   *  "mine" | "projects" | "education" (Member / Project / EducationOffering). */
  scope: string;
  /** Ancestor folders, top-most first (excludes the scoped root itself). */
  folders: DriveCrumb[];
};

const MAX_DEPTH = 12; // guards against cyclic/broken parent chains

export async function driveFolderCrumbs(
  folderPageId: string | null | undefined,
  viewerSub: string,
  request?: Request,
): Promise<DriveCrumbs> {
  if (!folderPageId) return { scope: "lab", folders: [] };

  const chain: DriveCrumb[] = [];
  let scope = "lab";
  let scopeRootId: string | null = null;
  let leafWorkspaceType: string | null = null;
  let cursor: string | null = folderPageId;

  // Not-yet-reparented Core folders are detected by their group scope.
  const coreGroupId =
    (await prisma.groupDefinition.findUnique({ where: { systemKey: "core" }, select: { id: true } }))
      ?.id ?? null;

  for (let i = 0; i < MAX_DEPTH && cursor; i++) {
    const p: {
      id: string;
      title: string;
      iconEmoji: string | null;
      parentPageId: string | null;
      scopeKind: string | null;
      scopeGroupId: string | null;
      folderType: string | null;
      processType: string | null;
      processId: string | null;
      workspaceType: string;
      archivedAt: Date | null;
    } | null = await prisma.page.findUnique({
      where: { id: cursor },
      select: {
        id: true,
        title: true,
        iconEmoji: true,
        parentPageId: true,
        scopeKind: true,
        scopeGroupId: true,
        folderType: true,
        processType: true,
        processId: true,
        workspaceType: true,
        archivedAt: true,
      },
    });
    if (!p) break;
    if (i === 0) {
      // Orphan: the item's own folder is archived (or, via the !p break above,
      // deleted). The Drive listing drops it and the safety-net surfaces it at
      // the General root, so the crumb must match that — Drive ▸ item.
      if (p.archivedAt) return { scope: "lab", folders: [] };
      leafWorkspaceType = p.workspaceType;
    }
    const rootKey = p.folderType === "Root" ? rootKeyFor(p) : null;
    if (rootKey) {
      scope = rootKey;
      scopeRootId = p.id;
      cursor = p.parentPageId;
      continue;
    }
    if (scope === "lab" && coreGroupId && p.scopeKind === "Group" && p.scopeGroupId === coreGroupId) {
      scope = "core";
      scopeRootId = p.id;
    }
    chain.unshift({ id: p.id, title: p.title, iconEmoji: p.iconEmoji });
    cursor = p.parentPageId;
  }

  // Non-Lab workspaces map straight to their Drive space. A parent chain never
  // crosses workspaces, so the leaf's workspaceType decides the scope; only Lab
  // pages carry the Core/Hiring scoped-root distinction resolved in the loop.
  const wsScope = workspaceDriveScope(leafWorkspaceType);
  if (wsScope) scope = wsScope;

  // Access-filter: don't advertise the Core drive to a viewer who can't enter
  // it, and drop any ancestor folder they can't view. getPageAccess
  // walks each folder's own scope, so a non-member is denied the scoped root
  // and its Restricted children alike.
  if (scopeRootId && !(await getPageAccess(viewerSub, scopeRootId, request)).canView) {
    scope = "lab";
  }
  const folderAccess = await Promise.all(
    chain.map((f) => getPageAccess(viewerSub, f.id, request)),
  );
  const folders = chain.filter((_, i) => folderAccess[i].canView);

  return { scope, folders };
}

/** The "Drive" root crumb + each ancestor folder, as plain {label, to} entries
 *  rooted at the Drive hub. Folders deep-link into the Drive folder view. */
export function driveCrumbTrail(crumbs: DriveCrumbs): { label: string; to: string; id?: string }[] {
  const folders = crumbs.folders.map((f) => ({
    label: f.title || "Untitled folder",
    to: `/drive?scope=${crumbs.scope}&folder=${f.id}`,
    id: f.id,
  }));
  return [...driveRootCrumbs(crumbs.scope), ...folders];
}
