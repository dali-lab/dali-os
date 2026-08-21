// Server-only helper: loads per-scope DriveItems for the Drive hub's Browse
// lens and applies the form-placement de-dup logic so this code never reaches
// the client bundle (*.server.ts convention enforced by client-bundle-leak test).

import { loadDriveScope, loadForms, loadOrphanForms, buildLinkedProcessMap } from "~/lib/drive.server";
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

/** Items filed directly at a scoped root (`parentFolderId === rootId`) must
 *  render at that scope's top level, where the root folder itself is not an item
 *  (it IS the scope). Reparent them to null so they show at the root instead of
 *  orphaning under a parent the scope doesn't list. Applies uniformly to the
 *  Core/Hiring carve-out folders, docs, AND forms. Pure; `rootId` falsy = no-op. */
export function liftRootChildren(items: DriveItem[], rootId: string | null | undefined): DriveItem[] {
  if (!rootId) return items;
  return items.map((it) =>
    it.parentFolderId === rootId ? { ...it, parentFolderId: null } : it,
  );
}

type WorkspaceOut = {
  key: string;
  label: string;
  kind: "lab" | "project" | "education";
  projectIconEmoji?: string | null;
};

/**
 * Load all DriveScopes for the Browse lens. Registry-driven: iterates
 * `visibleDriveSpaces(roleFlags)` and dispatches on each space's backing
 * strategy. My Drive, General (Lab-wide), Projects, Education, Core (Core
 * members), and Hiring (hiring team) each materialise per their strategy.
 *
 * The form-placement de-dup rule is preserved:
 *   - A form with folderPageId in scope X stays only in scope X.
 *   - An unplaced form (folderPageId = null) appears once, in the Lab scope.
 *   - A form whose folder was archived/deleted surfaces once, in the Lab scope
 *     (via loadOrphanForms) so it is never lost.
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
  request,
}: {
  userSub: string;
  projectWorkspaces: WorkspaceOut[];
  /** Education offerings the viewer can access (enrolled / instructor / Core). */
  educationWorkspaces: WorkspaceOut[];
  canViewForms: boolean;
  /** Whether to include agreement templates in the Lab scope (= isCore). */
  canManageAgreements: boolean;
  /** Whether the viewer is Core — gates the auto-provisioned Core drive. */
  isCore: boolean;
  /** Whether the viewer has hiring access — gates the auto-provisioned Hiring drive. */
  hasHiringAccess: boolean;
  request: Request;
}): Promise<DriveTreeScope[]> {
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

  const [coreRoot, hiringRoot, favIds, linkedProcessMap] = await Promise.all([
    needsCore ? ensureCoreDriveRoot(userSub) : Promise.resolve(null),
    needsHiring ? ensureHiringDriveRoot(userSub) : Promise.resolve(null),
    favoritePageIds(userSub),
    // Signal ②: build process linkages once for the whole load (no per-row queries).
    buildLinkedProcessMap(),
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
      linkedProcessMap,
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
  // Safety-net: forms whose folder was archived/deleted are dropped by the scoped
  // loadForms query above; surface them at the General root so none are lost.
  // Gated on the un-widened canViewForms (they land in the Lab scope, like labForms).
  let orphanForms: DriveItem[] = [];
  if (needForms) {
    const allFolderIds = [
      ...labItems.filter((i) => i.type === "folder").map((i) => i.id),
      ...projectItemArrays.flatMap((arr) => arr.filter((i) => i.type === "folder").map((i) => i.id)),
      ...educationItemArrays.flatMap((arr) => arr.filter((i) => i.type === "folder").map((i) => i.id)),
    ];
    // Pass linkedProcessMap so each form row gets its process annotation (Signal ②).
    [allForms, orphanForms] = await Promise.all([
      loadForms(allFolderIds, linkedProcessMap),
      canViewForms ? loadOrphanForms(linkedProcessMap) : Promise.resolve([] as DriveItem[]),
    ]);
  }

  // Carve out the Core subtree from the Lab load (same logic as legacy).
  let coreItems: DriveItem[] = [];
  let labVisibleItems = labItems;
  let coreFolderIds = new Set<string>();
  if (coreRoot) {
    const inCore = subtreeIds(labItems, coreRoot.id);
    labVisibleItems = labItems.filter((it) => !inCore.has(it.id));
    coreItems = liftRootChildren(
      labItems.filter((it) => it.id !== coreRoot.id && inCore.has(it.id)),
      coreRoot.id,
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
    hiringItems = liftRootChildren(
      labVisibleItems.filter((it) => it.id !== hiringRoot.id && inHiring.has(it.id)),
      hiringRoot.id,
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

  // Forms filed directly at the Core/Hiring root need the same root-lift as the
  // folders/docs above — otherwise they orphan under the excluded root and never
  // render at the scope root (the reason Core-filed forms showed in search but
  // not in the Drive listing).
  const coreForms = liftRootChildren(pickScopeForms(coreFolderIds, false, isCore), coreRoot?.id);
  const hiringForms = liftRootChildren(
    pickScopeForms(hiringFolderIds, false, labCanViewForms),
    hiringRoot?.id,
  );
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
  const filteredLab = [...labVisibleItems, ...labForms, ...orphanForms];
  const filteredProjects = projectItemArrays.map((arr, i) => [...arr, ...projectForms[i]]);
  const filteredEducation = educationItemArrays.map((arr, i) => [...arr, ...educationForms[i]]);

  // Build the output by iterating the registry in display order.
  // Signals ①/③: populate systemManaged + scopeAudience per the space definition.
  const result: DriveTreeScope[] = [];
  for (const space of spaces) {
    switch (space.backing) {
      case "member":
        result.push({
          id: "mine",
          label: "My Drive",
          iconEmoji: null,
          items: tagFavorites(memberItems, favIds),
          systemManaged: false,
          scopeAudience: "Private",
        });
        break;

      case "lab-open":
        result.push({
          id: "lab",
          label: "Lab-wide",
          iconEmoji: null,
          items: tagFavorites(filteredLab, favIds),
          systemManaged: false,
          scopeAudience: "Everyone in the lab",
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
            // ① Core root is a system-managed scoped root; its destructive actions are hidden.
            systemManaged: true,
            // ③ Only Core members can see this space.
            scopeAudience: "Core only",
          });
        } else if (space.key === "hiring" && hiringRoot) {
          result.push({
            id: "hiring",
            label: "Hiring",
            iconEmoji: null,
            items: tagFavorites(finalHiringItems, favIds),
            rootFolderId: hiringRoot.id,
            // ① Hiring root is a system-managed scoped root.
            systemManaged: true,
            // ③ Visible to the hiring team (Core + domain leads + reviewers).
            scopeAudience: "Hiring team",
          });
        }
        break;

      case "workspace-multi":
        if (space.key === "projects" && projectIds.length > 0) {
          // Build one "Projects" top-level scope whose top-level items are
          // synthetic folder rows (one per project). Each project's real items
          // are then reparented so their root-level parentFolderId points at
          // the synthetic project folder id, letting the browser drill in.
          const syntheticProjectItems: DriveItem[] = [];
          for (let i = 0; i < projectIds.length; i++) {
            const pid = projectIds[i];
            const projectItems = filteredProjects[i];

            // Synthetic folder row for this project (id = projectId, no parent).
            syntheticProjectItems.push({
              type: "folder",
              id: pid,
              title: projectNames.get(pid) ?? "Project",
              iconEmoji: projectEmojis.get(pid) ?? null,
              parentFolderId: null,
              href: `/projects/${pid}`,
              updatedAt: new Date(0),
              sizeBytes: null,
              favorited: false,
              linkedProcess: null,
              systemKey: null,
            } as DriveItem);

            // Real items: reparent those whose top-level parentFolderId is null
            // so they land inside the synthetic project folder. Items already
            // nested under a real folder keep their real parentFolderId.
            for (const item of projectItems) {
              syntheticProjectItems.push(
                item.parentFolderId === null
                  ? { ...item, parentFolderId: pid }
                  : item,
              );
            }
          }

          // Add the synthetic project folder ids to the form de-dup sets so
          // any form placed directly at a project's root (parentFolderId = null
          // in the raw data, reparented to pid above) still belongs here.
          // (Forms were already reparented in the loop above, so no extra work
          // is needed — they arrive with parentFolderId === pid after reparent.)

          result.push({
            id: "projects",
            label: "Projects",
            iconEmoji: null,
            items: tagFavorites(syntheticProjectItems, favIds),
            systemManaged: false,
            scopeAudience: "Project members",
          });
        } else if (space.key === "education" && educationIds.length > 0) {
          // Same pattern: one "Education" scope with per-offering synthetic folders.
          const syntheticEducationItems: DriveItem[] = [];
          for (let i = 0; i < educationIds.length; i++) {
            const oid = educationIds[i];
            const offeringItems = filteredEducation[i];

            syntheticEducationItems.push({
              type: "folder",
              id: oid,
              title: educationNames.get(oid) ?? "Offering",
              iconEmoji: null,
              parentFolderId: null,
              href: `/education/${oid}`,
              updatedAt: new Date(0),
              sizeBytes: null,
              favorited: false,
              linkedProcess: null,
              systemKey: null,
            } as DriveItem);

            for (const item of offeringItems) {
              syntheticEducationItems.push(
                item.parentFolderId === null
                  ? { ...item, parentFolderId: oid }
                  : item,
              );
            }
          }

          result.push({
            id: "education",
            label: "Education",
            iconEmoji: null,
            items: tagFavorites(syntheticEducationItems, favIds),
            systemManaged: false,
            scopeAudience: "Enrolled members",
          });
        }
        break;

      // virtual-filter: deferred to Wave 4; skip.
      case "virtual-filter":
        break;
    }
  }
  return result;
}
