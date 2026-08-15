// Server-only helper: loads per-scope DriveItems for the Drive hub's Browse
// lens and applies the form-placement de-dup logic so this code never reaches
// the client bundle (*.server.ts convention enforced by client-bundle-leak test).

import { loadDriveScope } from "~/lib/drive.server";
import type { DriveItem } from "~/lib/drive.server";
import { ensureCoreDriveRoot, ensureHiringDriveRoot } from "~/lib/pages";
import { favoritePageIds } from "~/lib/user-pages.server";

// Tag each doc/folder item with whether the viewer has favorited it (drives the
// inline star). Files/forms/agreements aren't page-favoritable, so they pass
// through untagged. Mutates in place for brevity — the arrays are freshly built.
function tagFavorites(items: DriveItem[], favIds: Set<string>): DriveItem[] {
  return items.map((it) =>
    (it.type === "doc" || it.type === "folder") && favIds.has(it.id)
      ? { ...it, favorited: true }
      : it,
  );
}

export type DriveTreeScope = {
  id: string;
  label: string;
  iconEmoji: string | null;
  items: DriveItem[];
  /** DB parent that this scope's top level maps to. null for My Drive/Lab/
   *  projects (top level = parentPageId null); set to the Core root folder id
   *  for the Core drive, so creates/moves land inside the scoped folder. */
  rootFolderId?: string | null;
};

// Given a flat item list and a root folder id, return the ids of the root plus
// every descendant (folder or leaf) reachable through parentFolderId.
function subtreeIds(items: DriveItem[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const it of items) {
    const p = it.parentFolderId;
    if (p === null) continue;
    const list = childrenOf.get(p);
    if (list) list.push(it.id);
    else childrenOf.set(p, [it.id]);
  }
  const out = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    for (const child of childrenOf.get(cur) ?? []) {
      if (!out.has(child)) {
        out.add(child);
        queue.push(child);
      }
    }
  }
  return out;
}

type WorkspaceOut = {
  key: string;
  label: string;
  kind: "lab" | "project";
  projectIconEmoji?: string | null;
};

/**
 * Load all DriveScopes for the Browse lens. Runs the Lab scope and each
 * project scope in parallel, then applies the form-placement de-dup rule:
 *
 *   - A form with folderPageId pointing to a folder in scope X stays only in
 *     scope X.
 *   - An unplaced form (folderPageId = null) appears ONCE, in the Lab scope.
 *   - No form is duplicated across scopes.
 */
export async function loadDriveScopes({
  userSub,
  projectWorkspaces,
  canViewForms,
  canManageAgreements,
  isCore,
  hasHiringAccess,
  request,
}: {
  userSub: string;
  projectWorkspaces: WorkspaceOut[];
  canViewForms: boolean;
  /** Whether to include agreement templates in the Lab scope (= isCore). */
  canManageAgreements: boolean;
  /** Whether the viewer is Core — gates the auto-provisioned Core drive. */
  isCore: boolean;
  /** Whether the viewer has hiring access — gates the auto-provisioned Hiring drive. */
  hasHiringAccess: boolean;
  request: Request;
}): Promise<DriveTreeScope[]> {
  // Provision the Core drive root on first Core visit (idempotent). Only Core
  // members trigger creation; the folder is Core-scoped so non-Core never see it.
  const coreRoot = isCore ? await ensureCoreDriveRoot(userSub) : null;
  // Same for the Hiring drive: hiring-team members trigger creation; the folder
  // is scoped to the "hiring" group so nobody else sees it.
  const hiringRoot = hasHiringAccess ? await ensureHiringDriveRoot(userSub) : null;
  // The viewer's favorited page ids — applied to every scope's items below.
  const favIds = await favoritePageIds(userSub);
  const projectIds = projectWorkspaces.map((w) => w.key);
  const projectNames = new Map(projectWorkspaces.map((w) => [w.key, w.label]));
  const projectEmojis = new Map(
    projectWorkspaces.map((w) => [w.key, w.projectIconEmoji ?? null]),
  );

  const [memberItems, labItems, ...projectItemArrays] = await Promise.all([
    loadDriveScope({ userSub, scope: { kind: "Member" }, request }),
    loadDriveScope({
      userSub,
      scope: { kind: "Lab" },
      canViewForms,
      canManageAgreements,
      request,
    }),
    ...projectIds.map((projectId) =>
      loadDriveScope({
        userSub,
        scope: { kind: "Project", projectId },
        canViewForms,
        request,
      }),
    ),
  ]);

  // Split the Core subtree out of the Lab items (Core members only). The Core
  // root + its descendants become their own drive; everything else stays in Lab.
  // getPageAccess already excluded the Core subtree from labItems for non-Core
  // viewers, so this is a no-op for them.
  let coreItems: DriveItem[] = [];
  let labVisibleItems = labItems;
  if (coreRoot) {
    const inCore = subtreeIds(labItems, coreRoot.id);
    labVisibleItems = labItems.filter((it) => !inCore.has(it.id));
    coreItems = labItems
      .filter((it) => it.id !== coreRoot.id && inCore.has(it.id))
      // Re-root: the Core folder's direct children become the drive's top level.
      .map((it) =>
        it.parentFolderId === coreRoot.id ? { ...it, parentFolderId: null } : it,
      );
  }

  // Same split for the Hiring drive, on the post-Core lab items.
  let hiringItems: DriveItem[] = [];
  if (hiringRoot) {
    const inHiring = subtreeIds(labVisibleItems, hiringRoot.id);
    const remaining = labVisibleItems.filter((it) => !inHiring.has(it.id));
    hiringItems = labVisibleItems
      .filter((it) => it.id !== hiringRoot.id && inHiring.has(it.id))
      .map((it) =>
        it.parentFolderId === hiringRoot.id ? { ...it, parentFolderId: null } : it,
      );
    labVisibleItems = remaining;
  }

  // Build a folder-id set per scope for the de-dup pass below.
  const labFolderIds = new Set(
    labVisibleItems.filter((i) => i.type === "folder").map((i) => i.id),
  );
  const projectFolderIdSets = projectItemArrays.map(
    (arr) => new Set(arr.filter((i) => i.type === "folder").map((i) => i.id)),
  );

  // Keep a form in a scope only if its folderPageId belongs to a folder in
  // THAT scope. Unplaced forms (folderPageId = null) go to the Lab scope only.
  function filterScopeForms(
    items: DriveItem[],
    scopeFolderIds: Set<string>,
    isLab: boolean,
  ): DriveItem[] {
    return items.filter((item) => {
      if (item.type !== "form") return true;
      if (item.parentFolderId === null) return isLab;
      return scopeFolderIds.has(item.parentFolderId);
    });
  }

  const filteredLab = filterScopeForms(labVisibleItems, labFolderIds, true);
  const filteredProjects = projectItemArrays.map((arr, i) =>
    filterScopeForms(arr, projectFolderIdSets[i], false),
  );

  return [
    // The viewer's private drive leads — personal notes have no forms to
    // de-dup, so they pass through untouched.
    { id: "mine", label: "My Drive", iconEmoji: null, items: tagFavorites(memberItems, favIds) },
    { id: "lab", label: "Lab-wide", iconEmoji: null, items: tagFavorites(filteredLab, favIds) },
    // Core drive: auto-provisioned, Core-only. Shown whenever the root exists
    // (which implies the viewer is Core), even when empty — it's a place to
    // create Core-scoped docs. Creates/moves land inside the Core root folder.
    ...(coreRoot
      ? [{ id: "core", label: "Core", iconEmoji: null, items: tagFavorites(coreItems, favIds), rootFolderId: coreRoot.id }]
      : []),
    // Hiring drive: auto-provisioned, hiring-team-only. Home for hiring Forms,
    // Rubrics, and Confidentiality agreements. Creates/moves land inside it.
    ...(hiringRoot
      ? [{ id: "hiring", label: "Hiring", iconEmoji: null, items: tagFavorites(hiringItems, favIds), rootFolderId: hiringRoot.id }]
      : []),
    ...projectIds.map((id, i) => ({
      id,
      label: projectNames.get(id) ?? "Project",
      iconEmoji: projectEmojis.get(id) ?? null,
      items: tagFavorites(filteredProjects[i], favIds),
    })),
  ];
}
