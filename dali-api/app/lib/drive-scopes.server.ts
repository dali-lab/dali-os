// Server-only helper: loads per-scope DriveItems for the Drive hub's Browse
// lens and applies the form-placement de-dup logic so this code never reaches
// the client bundle (*.server.ts convention enforced by client-bundle-leak test).

import { loadDriveScope, loadForms, loadOrphanForms, buildLinkedProcessMap } from "~/lib/drive.server";
import type { DriveItem } from "~/lib/drive.server";
import { prisma } from "~/lib/db";
import { favoritePageIds } from "~/lib/user-pages.server";
import { visibleDriveSpaces } from "~/lib/drive-spaces";
import { HIRING_PROCESS_ID } from "~/lib/bindings.server";
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
 * strategy. My Drive, General (Lab-wide), Projects, Education, Core, and Hiring
 * (the Core-only shared hiring folder set) each materialise per their strategy.
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
  request,
}: {
  userSub: string;
  projectWorkspaces: WorkspaceOut[];
  /** Education offerings the viewer can access (enrolled / instructor / Core). */
  educationWorkspaces: WorkspaceOut[];
  canViewForms: boolean;
  /** Whether to include agreement templates in the Lab scope (= isCore). */
  canManageAgreements: boolean;
  /** Whether the viewer is Core — gates the Core drive space. */
  isCore: boolean;
  request: Request;
}): Promise<DriveTreeScope[]> {
  // Build the minimal RoleFlags needed by the drive-spaces gates. The registry
  // gates only read `isCore` (both the Core and Hiring spaces are Core-only); the
  // other fields default to false (safe: we'd only under-show, never over-show).
  const roleFlags: RoleFlags = {
    isCore,
    hasHiringAccess: false,
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

  // The Core space is a virtual filter over Core-group-scoped folders (no
  // system root any more). The Hiring space is a virtual filter over the Hiring
  // singleton's bound folders. Only build each when the viewer can see it.
  const needsCore = spaces.some((s) => s.key === "core");
  const needsHiring = spaces.some((s) => s.key === "hiring");

  const [favIds, linkedProcessMap] = await Promise.all([
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
  const needForms = canViewForms || isCore;
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

  // Carve the Core + Hiring subtrees out of the Lab load. Both are ordinary Lab
  // folders shared with the Core group (scopeKind=Group), so a non-Core viewer
  // never sees them in labItems — nothing leaks. The Hiring space is the subset
  // bound to the Hiring singleton; the Core space is everything else Core-scoped.
  let coreItems: DriveItem[] = [];
  let hiringItems: DriveItem[] = [];
  let labVisibleItems = labItems;
  let coreFolderIds = new Set<string>();
  let hiringFolderIds = new Set<string>();
  if (needsCore || needsHiring) {
    const coreGroup = await prisma.groupDefinition.findUnique({
      where: { systemKey: "core" },
      select: { id: true },
    });
    const coreRootIds =
      needsCore && coreGroup
        ? (
            await prisma.page.findMany({
              where: {
                workspaceType: "Lab",
                workspaceId: null,
                scopeKind: "Group",
                scopeGroupId: coreGroup.id,
                archivedAt: null,
              },
              select: { id: true },
            })
          ).map((p) => p.id)
        : [];
    // Hiring roots are whatever folders the Hiring singleton's slots bind to —
    // keyed off the BINDING, not the scope, so re-sharing a folder can't eject it.
    const hiringRootIds = needsHiring
      ? (
          await prisma.processFolderBinding.findMany({
            where: {
              processType: "HiringCycle",
              processId: HIRING_PROCESS_ID,
              folderPageId: { not: null },
            },
            select: { folderPageId: true },
          })
        ).flatMap((b) => (b.folderPageId ? [b.folderPageId] : []))
      : [];

    const inHiring = new Set<string>();
    for (const rootId of hiringRootIds) {
      if (!labItems.some((it) => it.id === rootId)) continue;
      inHiring.add(rootId);
      for (const id of subtreeIds(labItems, rootId)) inHiring.add(id);
    }
    const inCore = new Set<string>();
    for (const rootId of coreRootIds) {
      if (!labItems.some((it) => it.id === rootId)) continue;
      inCore.add(rootId);
      for (const id of subtreeIds(labItems, rootId)) inCore.add(id);
    }
    // A Hiring subtree belongs to the Hiring space, never the Core space (the
    // hiring folders are Core-scoped, so they'd otherwise land in both).
    for (const id of inHiring) inCore.delete(id);

    if (inHiring.size > 0) {
      hiringItems = labItems.filter((it) => inHiring.has(it.id));
      hiringFolderIds = new Set(hiringItems.filter((i) => i.type === "folder").map((i) => i.id));
    }
    if (inCore.size > 0) {
      coreItems = labItems.filter((it) => inCore.has(it.id));
      coreFolderIds = new Set(coreItems.filter((i) => i.type === "folder").map((i) => i.id));
    }
    // Remove BOTH carved sets from the lab-visible items in one pass.
    const carved = new Set<string>([...inCore, ...inHiring]);
    if (carved.size > 0) {
      labVisibleItems = labItems.filter((it) => !carved.has(it.id));
    }
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

  // Core + Hiring forms live inside their scoped folders and carry a real
  // parentFolderId (in coreFolderIds / hiringFolderIds), so no root-lift needed.
  const coreForms = pickScopeForms(coreFolderIds, false, isCore);
  const hiringForms = pickScopeForms(hiringFolderIds, false, isCore);
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
  // Signal ③: populate scopeAudience per the space definition.
  const result: DriveTreeScope[] = [];
  for (const space of spaces) {
    switch (space.backing) {
      case "member":
        result.push({
          id: "mine",
          label: "My Drive",
          iconEmoji: null,
          items: tagFavorites(memberItems, favIds),
          scopeAudience: "Private",
        });
        break;

      case "lab-open":
        result.push({
          id: "lab",
          label: "Lab-wide",
          iconEmoji: null,
          items: tagFavorites(filteredLab, favIds),
          scopeAudience: "Everyone in the lab",
        });
        break;

      case "virtual-filter":
        // The Core space is a view over Core-group-scoped folders (no system
        // root). Its top-level items are the Core-scoped folders themselves.
        if (space.key === "core") {
          result.push({
            id: "core",
            label: "Core",
            iconEmoji: null,
            items: tagFavorites(finalCoreItems, favIds),
            // Only Core members can see this space.
            scopeAudience: "Core only",
          });
        } else if (space.key === "hiring") {
          // The Hiring space is a view over the Hiring singleton's bound folders
          // (rubrics, application templates, hiring forms). Core-only.
          result.push({
            id: "hiring",
            label: "Hiring",
            iconEmoji: null,
            items: tagFavorites(finalHiringItems, favIds),
            scopeAudience: "Core only",
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
            scopeAudience: "Enrolled members",
          });
        }
        break;
    }
  }
  return result;
}

/**
 * Load a single project's Drive scope as a `DriveTreeScope` — the same shape
 * the main Drive hub uses, scoped to one project. Used by the project hub's
 * "Drive" tab to render the shared DriveBrowser in embedded mode.
 *
 * Mirrors the per-project entries built by `loadDriveScopes` (the "Projects"
 * workspace-multi branch), with two differences:
 *   1. The items are NOT reparented under a synthetic project-folder row —
 *      they are served raw (parentFolderId null = scope root), because this
 *      scope IS the project and there is no containing "Projects" folder.
 *   2. The returned scope id is `"project:<projectId>"` so it cannot collide
 *      with the named spaces ("mine", "lab", "core", etc.) if the caller
 *      ever passes it alongside a full-drive scope list.
 *
 * `canViewForms` is intentionally NOT forwarded: project-scoped forms are
 * visible only to Core members (same gate used in loadDriveScopes), and the
 * project hub already loads them separately via the bespoke docs/files query.
 * Passing false keeps this call cheap and avoids a second form scan.
 */
export async function loadProjectDriveScope({
  userSub,
  projectId,
  projectName,
  projectIconEmoji,
  request,
}: {
  userSub: string;
  projectId: string;
  projectName: string;
  projectIconEmoji: string | null;
  request: Request;
}): Promise<DriveTreeScope> {
  const items: DriveItem[] = await loadDriveScope({
    userSub,
    scope: { kind: "Project", projectId },
    canViewForms: false,
    request,
  });

  return {
    id: `project:${projectId}`,
    label: projectName,
    iconEmoji: projectIconEmoji,
    items,
    scopeAudience: "Project members",
  };
}
