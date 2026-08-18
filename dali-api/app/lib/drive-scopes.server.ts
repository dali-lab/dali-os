// Server-only helper: loads per-scope DriveItems for the Drive hub's Browse
// lens and applies the form-placement de-dup logic so this code never reaches
// the client bundle (*.server.ts convention enforced by client-bundle-leak test).

import { loadDriveScope, loadForms } from "~/lib/drive.server";
import type { DriveItem } from "~/lib/drive.server";
import { ensureCoreDriveRoot, ensureHiringDriveRoot } from "~/lib/pages";
import { favoritePageIds } from "~/lib/user-pages.server";
import { visibleDriveSpaces } from "~/lib/drive-spaces";
import type { RoleFlags } from "~/lib/nav-areas";

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
  kind: "lab" | "project" | "education";
  projectIconEmoji?: string | null;
};

/**
 * Load all DriveScopes for the Browse lens. Behaviour depends on the
 * `driveSpacesEnabled` flag:
 *
 *   FLAG OFF (default) — byte-for-byte identical to the original hardcoded
 *   loader: My Drive, Lab-wide, Core (Core members), Hiring (hiring team),
 *   then one sub-scope per project.  No Education space.
 *
 *   FLAG ON — registry-driven: iterates `visibleDriveSpaces(roleFlags)` and
 *   dispatches on each space's backing strategy.  Education offerings appear as
 *   `workspace-multi` sub-spaces alongside Projects.
 *
 * In both modes the form-placement de-dup rule is preserved:
 *   - A form with folderPageId in scope X stays only in scope X.
 *   - An unplaced form (folderPageId = null) appears once, in the Lab scope.
 *   - No form is duplicated across scopes.
 */
export async function loadDriveScopes({
  userSub,
  projectWorkspaces,
  educationWorkspaces,
  canViewForms,
  canManageAgreements,
  isCore,
  hasHiringAccess,
  driveSpacesEnabled,
  request,
}: {
  userSub: string;
  projectWorkspaces: WorkspaceOut[];
  /**
   * Education offerings the viewer can access (enrolled / instructor / Core).
   * Only consulted when `driveSpacesEnabled` is true; pass [] otherwise.
   */
  educationWorkspaces: WorkspaceOut[];
  canViewForms: boolean;
  /** Whether to include agreement templates in the Lab scope (= isCore). */
  canManageAgreements: boolean;
  /** Whether the viewer is Core — gates the auto-provisioned Core drive. */
  isCore: boolean;
  /** Whether the viewer has hiring access — gates the auto-provisioned Hiring drive. */
  hasHiringAccess: boolean;
  /** `drive-spaces` feature flag resolved for this viewer. */
  driveSpacesEnabled: boolean;
  request: Request;
}): Promise<DriveTreeScope[]> {
  // ── Legacy path (flag OFF) ───────────────────────────────────────────────────
  // Identical to the original hardcoded implementation.  When the flag is off
  // this function is a byte-for-byte behavioural clone of the previous version.
  if (!driveSpacesEnabled) {
    return loadDriveScopesLegacy({
      userSub,
      projectWorkspaces,
      canViewForms,
      canManageAgreements,
      isCore,
      hasHiringAccess,
      request,
    });
  }

  // ── Registry-driven path (flag ON) ──────────────────────────────────────────
  // Build the minimal RoleFlags needed by the drive-spaces gates. The registry
  // gates only read `isCore` and `hasHiringAccess`; the other fields default to
  // false (safe: we'd only under-show spaces, never over-show).
  const roleFlags: RoleFlags = {
    isCore,
    hasHiringAccess,
    isAdmin: false,
    isDomainLead: false,
    isInterviewer: false,
    canViewForms: false,
    canViewStaffing: false,
    hasActiveHiringAccess: false,
    isLabMentor: false,
    isInstructor: false,
  };
  const spaces = visibleDriveSpaces(roleFlags);

  // Provision Core/Hiring roots only for spaces that are actually visible to
  // this viewer (same as legacy — avoids unnecessary idempotent creates).
  const needsCore = spaces.some((s) => s.key === "core");
  const needsHiring = spaces.some((s) => s.key === "hiring");

  const [coreRoot, hiringRoot, favIds] = await Promise.all([
    needsCore ? ensureCoreDriveRoot(userSub) : Promise.resolve(null),
    needsHiring ? ensureHiringDriveRoot(userSub) : Promise.resolve(null),
    favoritePageIds(userSub),
  ]);

  const projectIds = projectWorkspaces.map((w) => w.key);
  const projectNames = new Map(projectWorkspaces.map((w) => [w.key, w.label]));
  const projectEmojis = new Map(
    projectWorkspaces.map((w) => [w.key, w.projectIconEmoji ?? null]),
  );
  const educationIds = educationWorkspaces.map((w) => w.key);
  const educationNames = new Map(educationWorkspaces.map((w) => [w.key, w.label]));

  // Hiring-team widening (preserved from legacy): non-Core hiring members may
  // see hiring forms placed inside the Hiring drive.
  const labCanViewForms = canViewForms || hasHiringAccess;

  // Phase 1: load pages + files for every scope WITHOUT forms.
  const [memberItems, labItems, ...projectItemArrays] = await Promise.all([
    loadDriveScope({ userSub, scope: { kind: "Member" }, request }),
    loadDriveScope({
      userSub,
      scope: { kind: "Lab" },
      canViewForms: false,
      canManageAgreements: isCore,
      canManageEmailTemplates: isCore,
      request,
    }),
    ...projectIds.map((projectId) =>
      loadDriveScope({
        userSub,
        scope: { kind: "Project", projectId },
        canViewForms: false,
        request,
      }),
    ),
  ]);

  // Load education offering pages in parallel (no forms yet).
  const educationItemArrays = await Promise.all(
    educationIds.map((offeringId) =>
      loadDriveScope({
        userSub,
        scope: { kind: "EducationOffering", offeringId },
        canViewForms: false,
        request,
      }),
    ),
  );

  // Phase 2: load all forms in ONE query across all visible folder ids.
  const needForms = labCanViewForms || canViewForms;
  let allForms: DriveItem[] = [];
  if (needForms) {
    const allFolderIds = [
      ...labItems.filter((i) => i.type === "folder").map((i) => i.id),
      ...projectItemArrays.flatMap((arr) => arr.filter((i) => i.type === "folder").map((i) => i.id)),
      ...educationItemArrays.flatMap((arr) => arr.filter((i) => i.type === "folder").map((i) => i.id)),
    ];
    allForms = await loadForms(allFolderIds);
  }

  // Carve out the Core subtree from the Lab load (same logic as legacy).
  let coreItems: DriveItem[] = [];
  let labVisibleItems = labItems;
  let coreFolderIds = new Set<string>();
  if (coreRoot) {
    const inCore = subtreeIds(labItems, coreRoot.id);
    labVisibleItems = labItems.filter((it) => !inCore.has(it.id));
    coreItems = labItems
      .filter((it) => it.id !== coreRoot.id && inCore.has(it.id))
      .map((it) =>
        it.parentFolderId === coreRoot.id ? { ...it, parentFolderId: null } : it,
      );
    coreFolderIds = new Set([
      coreRoot.id,
      ...coreItems.filter((i) => i.type === "folder").map((i) => i.id),
    ]);
  }

  // Carve out the Hiring subtree from the post-Core lab items (same logic).
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
    hiringFolderIds = new Set([
      hiringRoot.id,
      ...hiringItems.filter((i) => i.type === "folder").map((i) => i.id),
    ]);
  }

  // Strip managed artifacts from the Lab scope (same as legacy).
  labVisibleItems = labVisibleItems.filter(
    (it) =>
      it.type !== "agreement" &&
      it.type !== "rubric" &&
      it.type !== "emailTemplate",
  );

  // Build folder-id sets for the form de-dup pass.
  const labFolderIds = new Set(
    labVisibleItems.filter((i) => i.type === "folder").map((i) => i.id),
  );
  const projectFolderIdSets = projectItemArrays.map(
    (arr) => new Set(arr.filter((i) => i.type === "folder").map((i) => i.id)),
  );
  const educationFolderIdSets = educationItemArrays.map(
    (arr) => new Set(arr.filter((i) => i.type === "folder").map((i) => i.id)),
  );

  // Partition forms per scope (same placement rule as legacy).
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

  const coreForms = pickScopeForms(coreFolderIds, false, isCore);
  const hiringForms = pickScopeForms(hiringFolderIds, false, labCanViewForms);
  // Lab forms use the un-widened canViewForms gate (same as legacy).
  const labForms = pickScopeForms(labFolderIds, true, canViewForms);
  const projectForms = projectItemArrays.map((_, i) =>
    pickScopeForms(projectFolderIdSets[i], false, canViewForms),
  );
  // Education forms: use un-widened canViewForms (enrolled/instructor/Core).
  const educationForms = educationItemArrays.map((_, i) =>
    pickScopeForms(educationFolderIdSets[i], false, canViewForms),
  );

  // Compose final item lists.
  const finalCoreItems = [...coreItems, ...coreForms];
  const finalHiringItems = [...hiringItems, ...hiringForms];
  const filteredLab = [...labVisibleItems, ...labForms];
  const filteredProjects = projectItemArrays.map((arr, i) => [...arr, ...projectForms[i]]);
  const filteredEducation = educationItemArrays.map((arr, i) => [...arr, ...educationForms[i]]);

  // Build the output by iterating the registry in display order.
  const result: DriveTreeScope[] = [];
  for (const space of spaces) {
    switch (space.backing) {
      case "member":
        result.push({
          id: "mine",
          label: "My Drive",
          iconEmoji: null,
          items: tagFavorites(memberItems, favIds),
        });
        break;

      case "lab-open":
        result.push({
          id: "lab",
          label: "Lab-wide",
          iconEmoji: null,
          items: tagFavorites(filteredLab, favIds),
        });
        break;

      case "lab-scoped-root":
        if (space.key === "core" && coreRoot) {
          result.push({
            id: "core",
            label: "Core",
            iconEmoji: null,
            items: tagFavorites(finalCoreItems, favIds),
            rootFolderId: coreRoot.id,
          });
        } else if (space.key === "hiring" && hiringRoot) {
          result.push({
            id: "hiring",
            label: "Hiring",
            iconEmoji: null,
            items: tagFavorites(finalHiringItems, favIds),
            rootFolderId: hiringRoot.id,
          });
        }
        break;

      case "workspace-multi":
        if (space.key === "projects") {
          for (let i = 0; i < projectIds.length; i++) {
            const id = projectIds[i];
            result.push({
              id,
              label: projectNames.get(id) ?? "Project",
              iconEmoji: projectEmojis.get(id) ?? null,
              items: tagFavorites(filteredProjects[i], favIds),
            });
          }
        } else if (space.key === "education") {
          for (let i = 0; i < educationIds.length; i++) {
            const id = educationIds[i];
            result.push({
              id,
              label: educationNames.get(id) ?? "Offering",
              iconEmoji: null,
              items: tagFavorites(filteredEducation[i], favIds),
            });
          }
        }
        break;

      // virtual-filter: deferred to Wave 4; skip.
      case "virtual-filter":
        break;
    }
  }
  return result;
}

// ── Legacy loader (flag OFF) ──────────────────────────────────────────────────
// Preserved verbatim from the original implementation so the flag-off path is
// identical to what shipped before Wave 1.  This function is private; callers
// always go through `loadDriveScopes` which dispatches based on the flag.

async function loadDriveScopesLegacy({
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
  canManageAgreements: boolean;
  isCore: boolean;
  hasHiringAccess: boolean;
  request: Request;
}): Promise<DriveTreeScope[]> {
  const [coreRoot, hiringRoot, favIds] = await Promise.all([
    isCore ? ensureCoreDriveRoot(userSub) : Promise.resolve(null),
    hasHiringAccess ? ensureHiringDriveRoot(userSub) : Promise.resolve(null),
    favoritePageIds(userSub),
  ]);
  const projectIds = projectWorkspaces.map((w) => w.key);
  const projectNames = new Map(projectWorkspaces.map((w) => [w.key, w.label]));
  const projectEmojis = new Map(
    projectWorkspaces.map((w) => [w.key, w.projectIconEmoji ?? null]),
  );

  const labCanViewForms = canViewForms || hasHiringAccess;

  const [memberItems, labItems, ...projectItemArrays] = await Promise.all([
    loadDriveScope({ userSub, scope: { kind: "Member" }, request }),
    loadDriveScope({
      userSub,
      scope: { kind: "Lab" },
      canViewForms: false,
      canManageAgreements: isCore,
      canManageEmailTemplates: isCore,
      request,
    }),
    ...projectIds.map((projectId) =>
      loadDriveScope({
        userSub,
        scope: { kind: "Project", projectId },
        canViewForms: false,
        request,
      }),
    ),
  ]);

  const needForms = labCanViewForms || canViewForms;
  let allForms: DriveItem[] = [];
  if (needForms) {
    const allFolderIds = [
      ...labItems.filter((i) => i.type === "folder").map((i) => i.id),
      ...projectItemArrays.flatMap((arr) => arr.filter((i) => i.type === "folder").map((i) => i.id)),
    ];
    allForms = await loadForms(allFolderIds);
  }

  let coreItems: DriveItem[] = [];
  let labVisibleItems = labItems;
  let coreFolderIds = new Set<string>();
  if (coreRoot) {
    const inCore = subtreeIds(labItems, coreRoot.id);
    labVisibleItems = labItems.filter((it) => !inCore.has(it.id));
    coreItems = labItems
      .filter((it) => it.id !== coreRoot.id && inCore.has(it.id))
      .map((it) =>
        it.parentFolderId === coreRoot.id ? { ...it, parentFolderId: null } : it,
      );
    coreFolderIds = new Set([
      coreRoot.id,
      ...coreItems.filter((i) => i.type === "folder").map((i) => i.id),
    ]);
  }

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
    hiringFolderIds = new Set([
      hiringRoot.id,
      ...hiringItems.filter((i) => i.type === "folder").map((i) => i.id),
    ]);
  }

  labVisibleItems = labVisibleItems.filter(
    (it) =>
      it.type !== "agreement" &&
      it.type !== "rubric" &&
      it.type !== "emailTemplate",
  );

  const labFolderIds = new Set(
    labVisibleItems.filter((i) => i.type === "folder").map((i) => i.id),
  );
  const projectFolderIdSets = projectItemArrays.map(
    (arr) => new Set(arr.filter((i) => i.type === "folder").map((i) => i.id)),
  );

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

  const coreForms = pickScopeForms(coreFolderIds, false, isCore);
  const hiringForms = pickScopeForms(hiringFolderIds, false, labCanViewForms);
  const labForms = pickScopeForms(labFolderIds, true, canViewForms);
  const projectForms = projectItemArrays.map((_, i) =>
    pickScopeForms(projectFolderIdSets[i], false, canViewForms),
  );

  const finalCoreItems = [...coreItems, ...coreForms];
  const finalHiringItems = [...hiringItems, ...hiringForms];
  const filteredLab = [...labVisibleItems, ...labForms];
  const filteredProjects = projectItemArrays.map((arr, i) => [...arr, ...projectForms[i]]);

  return [
    { id: "mine", label: "My Drive", iconEmoji: null, items: tagFavorites(memberItems, favIds) },
    { id: "lab", label: "Lab-wide", iconEmoji: null, items: tagFavorites(filteredLab, favIds) },
    ...(coreRoot
      ? [{ id: "core", label: "Core", iconEmoji: null, items: tagFavorites(finalCoreItems, favIds), rootFolderId: coreRoot.id }]
      : []),
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
