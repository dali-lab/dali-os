import { prisma } from "~/lib/db";
import { driveRootCrumbs, workspaceDriveScope } from "~/lib/drive-crumbs";
import {
  MAX_ANCESTOR_WALK,
  getPageAccess,
  getPageAccessBulk,
  governingScopeMap,
} from "~/lib/pageAccess.server";
import { loadAncestorChains, type LocationChainRow } from "~/lib/page-ancestry.server";
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

type CrumbRow = {
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
};

const CRUMB_SELECT = {
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
} as const;

type CrumbPath = { scope: string; scopeRootId: string | null; chain: DriveCrumb[] };

const LAB_ROOT: CrumbPath = { scope: "lab", scopeRootId: null, chain: [] };

/** The scope and unfiltered folder trail for `rows`: the folder's own row first, then each ancestor. */
function crumbPathFromRows(rows: ReadonlyArray<CrumbRow>, coreGroupId: string | null): CrumbPath {
  const chain: DriveCrumb[] = [];
  let scope = "lab";
  let scopeRootId: string | null = null;
  let leafWorkspaceType: string | null = null;

  for (const [i, p] of rows.slice(0, MAX_DEPTH).entries()) {
    if (i === 0) {
      // Orphan: the item's own folder is archived (or, via the empty rows of a
      // deleted folder, gone). The Drive listing drops it and the safety-net
      // surfaces it at the General root, so the crumb must match that.
      if (p.archivedAt) return LAB_ROOT;
      leafWorkspaceType = p.workspaceType;
    }
    const rootKey = p.folderType === "Root" ? rootKeyFor(p) : null;
    if (rootKey) {
      scope = rootKey;
      scopeRootId = p.id;
      continue;
    }
    if (scope === "lab" && coreGroupId && p.scopeKind === "Group" && p.scopeGroupId === coreGroupId) {
      scope = "core";
      scopeRootId = p.id;
    }
    chain.unshift({ id: p.id, title: p.title, iconEmoji: p.iconEmoji });
  }

  // Non-Lab workspaces map straight to their Drive space. A parent chain never
  // crosses workspaces, so the leaf's workspaceType decides the scope; only Lab
  // pages carry the Core/Hiring scoped-root distinction resolved in the loop.
  const wsScope = workspaceDriveScope(leafWorkspaceType);
  return { scope: wsScope ?? scope, scopeRootId, chain };
}

// Don't advertise the Core drive to a viewer who can't enter it, and drop any
// ancestor folder they can't view. Access walks each folder's own scope, so a
// non-member is denied the scoped root and its Restricted children alike.
function withViewAccess({ scope, scopeRootId, chain }: CrumbPath, canView: (id: string) => boolean): DriveCrumbs {
  return {
    scope: scopeRootId && !canView(scopeRootId) ? "lab" : scope,
    folders: chain.filter((f) => canView(f.id)),
  };
}

async function coreGroupId(): Promise<string | null> {
  // Not-yet-reparented Core folders are detected by their group scope.
  return (await prisma.groupDefinition.findUnique({ where: { systemKey: "core" }, select: { id: true } }))?.id ?? null;
}

export async function driveFolderCrumbs(
  folderPageId: string | null | undefined,
  viewerSub: string,
  request?: Request,
): Promise<DriveCrumbs> {
  if (!folderPageId) return { scope: "lab", folders: [] };

  const coreId = await coreGroupId();
  const rows: CrumbRow[] = [];
  let cursor: string | null = folderPageId;
  while (rows.length < MAX_DEPTH && cursor) {
    const p: CrumbRow | null = await prisma.page.findUnique({ where: { id: cursor }, select: CRUMB_SELECT });
    if (!p) break;
    rows.push(p);
    if (rows.length === 1 && p.archivedAt) break;
    cursor = p.parentPageId;
  }

  const path = crumbPathFromRows(rows, coreId);
  const ids = [...new Set([...(path.scopeRootId ? [path.scopeRootId] : []), ...path.chain.map((f) => f.id)])];
  const viewable = new Set<string>();
  await Promise.all(
    ids.map(async (id) => {
      if ((await getPageAccess(viewerSub, id, request)).canView) viewable.add(id);
    }),
  );
  return withViewAccess(path, (id) => viewable.has(id));
}

/**
 * `driveFolderCrumbs` for many folders at once: one ancestor query, one
 * access computation over every distinct folder, and one Core-group lookup,
 * however many folders are asked about. Keyed by folder id.
 */
export async function driveFolderCrumbsBulk(
  folderPageIds: ReadonlyArray<string>,
  viewerSub: string,
  request?: Request,
): Promise<Map<string, DriveCrumbs>> {
  const ids = [...new Set(folderPageIds)];
  const result = new Map<string, DriveCrumbs>();
  if (ids.length === 0) return result;

  // Enough rows past the deepest crumb for the governing-scope walk of every
  // folder in the trail to stay inside what was loaded.
  const [chains, coreId] = await Promise.all([
    loadAncestorChains(ids, MAX_DEPTH + MAX_ANCESTOR_WALK),
    coreGroupId(),
  ]);

  const rowsById = new Map<string, LocationChainRow>();
  for (const chain of chains.values()) for (const row of chain) rowsById.set(row.id, row);

  const paths = new Map(ids.map((id) => [id, crumbPathFromRows(chains.get(id) ?? [], coreId)]));
  const checked = new Set<string>();
  for (const path of paths.values()) {
    if (path.scopeRootId) checked.add(path.scopeRootId);
    for (const f of path.chain) checked.add(f.id);
  }
  const access = await getPageAccessBulk(
    viewerSub,
    [...checked].map((id) => rowsById.get(id)!),
    request,
    undefined,
    governingScopeMap([...rowsById.values()]),
  );

  const canView = (id: string) => access.get(id)?.canView === true;
  for (const [id, path] of paths) result.set(id, withViewAccess(path, canView));
  return result;
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
