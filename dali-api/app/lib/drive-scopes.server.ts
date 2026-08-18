// Server-only helper: loads per-scope DriveItems for the Drive hub's Browse
// lens and applies the form-placement de-dup logic so this code never reaches
// the client bundle (*.server.ts convention enforced by client-bundle-leak test).

import { loadDriveScope, loadForms } from "~/lib/drive.server";
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
  /**
   * Signal ③: human-readable audience label for the space/folder scope chip
   * (e.g. "Core only", "Hiring team", "Everyone in the lab"). Derived from
   * `Page.scopeKind` + resolved group audience in Wave 2; unpopulated in Wave 0.
   */
  scopeAudience?: string | null;
  /**
   * Whether this scope is system-managed (its root folder has a `Page.systemKey`
   * and cannot be renamed/deleted). Consumed by Signal ① in Wave 2 to render the
   * "Managed" hover chip and hide destructive actions. Unpopulated in Wave 0.
   */
  systemManaged?: boolean;
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
  // Provision Core and Hiring drive roots in parallel (both are idempotent).
  // Only the relevant member types trigger creation; non-members receive null.
  const [coreRoot, hiringRoot, favIds] = await Promise.all([
    isCore ? ensureCoreDriveRoot(userSub) : Promise.resolve(null),
    hasHiringAccess ? ensureHiringDriveRoot(userSub) : Promise.resolve(null),
    // The viewer's favorited page ids — applied to every scope's items below.
    favoritePageIds(userSub),
  ]);
  const projectIds = projectWorkspaces.map((w) => w.key);
  const projectNames = new Map(projectWorkspaces.map((w) => [w.key, w.label]));
  const projectEmojis = new Map(
    projectWorkspaces.map((w) => [w.key, w.projectIconEmoji ?? null]),
  );

  // Hiring-team members who aren't Core still need to see the hiring Forms that
  // live in the Hiring drive, so widen the forms load for them — then partition
  // into hiringItems and strip managed types from the Lab leftover below.
  // Agreements, rubrics, and email templates are Core-only (Core ▸ Agreements /
  // Rubrics / Templates) and are NEVER widened for the hiring team.
  const labCanViewForms = canViewForms || hasHiringAccess;

  // Phase 1: load pages + files for every scope WITHOUT forms, so we can collect
  // all drive folder ids in one pass before loading forms.
  const [memberItems, labItems, ...projectItemArrays] = await Promise.all([
    loadDriveScope({ userSub, scope: { kind: "Member" }, request }),
    loadDriveScope({
      userSub,
      scope: { kind: "Lab" },
      canViewForms: false, // forms loaded separately below
      // Agreements, rubrics, email templates → REAL Core only, never widened.
      canManageAgreements: isCore,
      canManageEmailTemplates: isCore,
      request,
    }),
    ...projectIds.map((projectId) =>
      loadDriveScope({
        userSub,
        scope: { kind: "Project", projectId },
        canViewForms: false, // forms loaded separately below
        request,
      }),
    ),
  ]);

  // Phase 2: load all forms in ONE query, scoped to folders that exist across
  // all drives + unplaced forms. Then partition per scope in memory.
  // This replaces the previous pattern of one full-table scan per scope.
  const needForms = labCanViewForms || canViewForms;
  let allForms: DriveItem[] = [];
  if (needForms) {
    // Collect every folder id visible across all scopes so the query covers
    // every possible folderPageId placement.
    const allFolderIds = [
      ...labItems.filter((i) => i.type === "folder").map((i) => i.id),
      ...projectItemArrays.flatMap((arr) => arr.filter((i) => i.type === "folder").map((i) => i.id)),
    ];
    allForms = await loadForms(allFolderIds);
  }

  // Split the Core subtree out of the Lab items (Core members only). The Core
  // root + its descendants become their own drive; everything else stays in Lab.
  // getPageAccess already excluded the Core subtree from labItems for non-Core
  // viewers, so this is a no-op for them.
  let coreItems: DriveItem[] = [];
  let labVisibleItems = labItems;
  let coreFolderIds = new Set<string>();
  if (coreRoot) {
    const inCore = subtreeIds(labItems, coreRoot.id);
    labVisibleItems = labItems.filter((it) => !inCore.has(it.id));
    coreItems = labItems
      .filter((it) => it.id !== coreRoot.id && inCore.has(it.id))
      // Re-root: the Core folder's direct children become the drive's top level.
      .map((it) =>
        it.parentFolderId === coreRoot.id ? { ...it, parentFolderId: null } : it,
      );
    // Collect Core folder ids for form partitioning. Include the core root
    // itself so forms placed directly at the core root level are routed here.
    coreFolderIds = new Set([
      coreRoot.id,
      ...coreItems.filter((i) => i.type === "folder").map((i) => i.id),
    ]);
  }

  // Same split for the Hiring drive, on the post-Core lab items.
  let hiringItems: DriveItem[] = [];
  let hiringFolderIds = new Set<string>();
  if (hiringRoot) {
    const inHiring = subtreeIds(labVisibleItems, hiringRoot.id);
    const remaining = labVisibleItems.filter((it) => !inHiring.has(it.id));
    hiringItems = labVisibleItems
      .filter((it) => it.id !== hiringRoot.id && inHiring.has(it.id))
      .map((it) =>
        it.parentFolderId === hiringRoot.id ? { ...it, parentFolderId: null } : it,
      );
    labVisibleItems = remaining;
    // Collect Hiring folder ids for form partitioning. Include the hiring root
    // itself: forms adopted by ensureHiringDriveRoot are placed at rootId
    // directly (folderPageId = hiringRoot.id), so the root id must be present.
    hiringFolderIds = new Set([
      hiringRoot.id,
      ...hiringItems.filter((i) => i.type === "folder").map((i) => i.id),
    ]);
  }

  // Managed artifact types — agreements, rubrics, email templates — live ONLY
  // in their predefined Core/Hiring folders. Whatever the Core/Hiring subtree
  // splits already routed there stays; strip any leftover from the Lab scope so
  // they never appear loose (e.g. a hiring-team member's widened rubric load, or
  // a brand-new item awaiting adoption).
  labVisibleItems = labVisibleItems.filter(
    (it) =>
      it.type !== "agreement" &&
      it.type !== "rubric" &&
      it.type !== "emailTemplate",
  );
  // (Forms are no longer in labVisibleItems — they were not loaded in phase 1.
  //  Form filtering happens below via the allForms partition pass.)

  // Build a folder-id set per scope for the form de-dup pass below.
  const labFolderIds = new Set(
    labVisibleItems.filter((i) => i.type === "folder").map((i) => i.id),
  );
  const projectFolderIdSets = projectItemArrays.map(
    (arr) => new Set(arr.filter((i) => i.type === "folder").map((i) => i.id)),
  );

  // Partition the pre-fetched forms into per-scope lists using the same
  // placement rule as before: a form belongs to the scope whose folder its
  // folderPageId resolves to; unplaced forms (folderPageId = null) go to the
  // Lab scope only. Forms widen: labCanViewForms includes the hiring-team gate;
  // per-project forms use the un-widened canViewForms.
  function pickScopeForms(
    scopeFolderIds: Set<string>,
    isLab: boolean,
    viewerCanSeeForms: boolean,
  ): DriveItem[] {
    if (!viewerCanSeeForms) return [];
    return allForms.filter((item) => {
      if (item.parentFolderId === null) return isLab;
      return scopeFolderIds.has(item.parentFolderId);
    });
  }

  // Core and Hiring forms: Core is always viewable only by Core members (who
  // also have isCore=true → labCanViewForms=true). Hiring: hiring-team members
  // see forms in the Hiring drive (labCanViewForms covers them).
  const coreForms = pickScopeForms(coreFolderIds, false, isCore);
  const hiringForms = pickScopeForms(hiringFolderIds, false, labCanViewForms);
  // Lab forms gate on the UN-widened canViewForms: a viewer who only reached
  // forms via hiring access (hasHiringAccess but !canViewForms) must NOT see
  // them in the Lab scope — they see hiring forms in the Hiring drive instead.
  // This mirrors the original `if (!canViewForms) drop lab forms` behaviour.
  const labForms = pickScopeForms(labFolderIds, true, canViewForms);
  const projectForms = projectItemArrays.map((_, i) =>
    pickScopeForms(projectFolderIdSets[i], false, canViewForms),
  );

  // Compose final item lists: pages+files from phase 1, forms from phase 2.
  const finalCoreItems = [...coreItems, ...coreForms];
  const finalHiringItems = [...hiringItems, ...hiringForms];
  const filteredLab = [...labVisibleItems, ...labForms];
  const filteredProjects = projectItemArrays.map((arr, i) => [...arr, ...projectForms[i]]);

  return [
    // The viewer's private drive leads — personal notes have no forms to
    // de-dup, so they pass through untouched.
    { id: "mine", label: "My Drive", iconEmoji: null, items: tagFavorites(memberItems, favIds) },
    { id: "lab", label: "Lab-wide", iconEmoji: null, items: tagFavorites(filteredLab, favIds) },
    // Core drive: auto-provisioned, Core-only. Shown whenever the root exists
    // (which implies the viewer is Core), even when empty — it's a place to
    // create Core-scoped docs. Creates/moves land inside the Core root folder.
    ...(coreRoot
      ? [{ id: "core", label: "Core", iconEmoji: null, items: tagFavorites(finalCoreItems, favIds), rootFolderId: coreRoot.id }]
      : []),
    // Hiring drive: auto-provisioned, hiring-team-only. Home for hiring Forms,
    // Rubrics, and Confidentiality agreements. Creates/moves land inside it.
    ...(hiringRoot
      ? [{ id: "hiring", label: "Hiring", iconEmoji: null, items: tagFavorites(finalHiringItems, favIds), rootFolderId: hiringRoot.id }]
      : []),
    ...projectIds.map((id, i) => ({
      id,
      label: projectNames.get(id) ?? "Project",
      iconEmoji: projectEmojis.get(id) ?? null,
      items: tagFavorites(filteredProjects[i], favIds),
    })),
  ];
}
