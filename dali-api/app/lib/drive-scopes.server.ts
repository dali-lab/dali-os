// Server-only helper: loads per-scope DriveItems for the Drive hub's Browse
// lens and applies the form-placement de-dup logic so this code never reaches
// the client bundle (*.server.ts convention enforced by client-bundle-leak test).

import { loadDriveScope, loadForms, loadOrphanForms, buildLinkedProcessMap } from "~/lib/drive.server";
import type { DriveItem, ProjectPageRow, ProjectFileRow } from "~/lib/drive.server";
import { prisma } from "~/lib/db";
import { requireAuth, isImpersonating } from "~/lib/auth";
import { favoritePageIds } from "~/lib/user-pages.server";
import { withChildCounts } from "~/lib/drive-counts.server";
import { visibleDriveSpaces } from "~/lib/drive-spaces";
import { getPageAccess } from "~/lib/pageAccess.server";
import { ensureAllRoots, findAllRoots, type RootKey } from "~/lib/drive-roots.server";
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
   *  projects (top level = parentPageId null); set to the root folder id for
   *  the process-root drives (Core, Hiring, Mentorship), so creates/moves land
   *  inside the root. */
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

/** A carved-out space lists a subset of its workspace's items, so an item whose
 *  parent didn't make the cut has nowhere to render — the browser builds its
 *  tree from `parentFolderId`, and an item pointing at an absent parent is
 *  simply never drawn. That happens whenever a Core-scoped folder is moved
 *  inside an unscoped Lab folder: it's carved out of the Lab space and lands in
 *  Core with a parent Core doesn't hold, vanishing from the Drive entirely.
 *  Lifting those to the space's top level keeps them reachable. Pure. */
export function liftOrphans(items: DriveItem[]): DriveItem[] {
  const present = new Set(items.map((it) => it.id));
  return items.map((it) =>
    it.parentFolderId !== null && !present.has(it.parentFolderId)
      ? { ...it, parentFolderId: null }
      : it,
  );
}

const ROOT_AUDIENCE: Record<RootKey, string> = {
  core: "Core only",
  hiring: "Core only",
  mentorship: "Mentors",
};

// Core members get any missing root created on first load, so the creator is
// always someone the root's scope admits. Everyone else only sees roots that
// already exist.
async function resolveLiveRoots(userSub: string, isCore: boolean) {
  const found = await findAllRoots();
  const missing = (["core", "hiring", "mentorship"] as const).some((k) => !found.byKey[k]);
  if (!isCore || !missing) return found;
  try {
    await ensureAllRoots(userSub);
  } catch (err) {
    console.error("Drive roots could not be ensured", err);
    return found;
  }
  return findAllRoots();
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
 * strategy. My Drive, General (Lab-wide), Projects and Education materialise
 * per their strategy; Core, Hiring and Mentorship are the contents of their
 * root folder, shown only to viewers who can view that root.
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
  // gates only read `isCore` (the Core space is Core-only); the other fields
  // default to false (safe: we'd only under-show, never over-show).
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
    isAlumni: false,
  };
  const spaces = visibleDriveSpaces(roleFlags);

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

  // My Drive is the member's private space (Member-workspace pages and files,
  // i.e. their personal notes). An admin impersonating them gets the scope but
  // none of its contents — nothing personal is even queried.
  const auth = await requireAuth(request);
  const hidePersonal = auth.ok && isImpersonating(auth);

  // Phase 1: load pages + files for every scope WITHOUT forms.
  const [memberItems, labItems, liveRoots, ...projectItemArrays] = await Promise.all([
    hidePersonal
      ? Promise.resolve<DriveItem[]>([])
      : loadDriveScope({ userSub, scope: { kind: "Member" }, request }),
    loadDriveScope({
      userSub,
      scope: { kind: "Lab" },
      canViewForms: false,
      canManageAgreements: isCore,
      request,
      linkedProcessMap,
    }),
    resolveLiveRoots(userSub, isCore),
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

  // Carve every root's subtree out of the Lab load, whichever process owns it:
  // a Mentorship root must never show as a folder in General, and a viewer who
  // cannot open a root has no space for it either. The root itself is dropped
  // and its children re-rooted to the space's top level.
  const carved = new Set<string>();
  const rootSpaceItems = new Map<RootKey, DriveItem[]>();
  const visibleRootIds = new Map<RootKey, string>();
  const rootFolderIdsByKey = new Map<RootKey, Set<string>>();
  for (const rootId of liveRoots.ids) {
    for (const id of subtreeIds(labItems, rootId)) carved.add(id);
  }
  const processSpaces = spaces.filter((s) => s.backing === "process-root" && s.rootKey);
  await Promise.all(
    processSpaces.map(async (space) => {
      const key = space.rootKey!;
      const rootId = liveRoots.byKey[key];
      if (!rootId) return;
      const access = await getPageAccess(userSub, rootId, request);
      if (!access.canView) return;
      visibleRootIds.set(key, rootId);
      const inRoot = subtreeIds(labItems, rootId);
      rootSpaceItems.set(
        key,
        labItems
          .filter((it) => inRoot.has(it.id) && it.id !== rootId)
          .map((it) => (it.parentFolderId === rootId ? { ...it, parentFolderId: null } : it)),
      );
      rootFolderIdsByKey.set(key, inRoot);
    }),
  );

  // Until the reparent job has run, Core-scoped folders still sit at the Lab
  // top level. Show them in Core too, so the space reads the same before and
  // after the move.
  if (isCore && visibleRootIds.has("core")) {
    const coreGroup = await prisma.groupDefinition.findUnique({
      where: { systemKey: "core" },
      select: { id: true },
    });
    const legacyTops = coreGroup
      ? await prisma.page.findMany({
          where: {
            workspaceType: "Lab",
            workspaceId: null,
            parentPageId: null,
            scopeKind: "Group",
            scopeGroupId: coreGroup.id,
            archivedAt: null,
          },
          select: { id: true, folderType: true },
        })
      : [];
    const legacyIds = new Set<string>();
    for (const top of legacyTops) {
      if (top.folderType === "Root" || carved.has(top.id)) continue;
      if (!labItems.some((it) => it.id === top.id)) continue;
      for (const id of subtreeIds(labItems, top.id)) legacyIds.add(id);
    }
    if (legacyIds.size > 0) {
      for (const id of legacyIds) carved.add(id);
      const coreSet = rootFolderIdsByKey.get("core")!;
      for (const id of legacyIds) coreSet.add(id);
      rootSpaceItems.set("core", [
        ...rootSpaceItems.get("core")!,
        ...labItems.filter((it) => legacyIds.has(it.id)),
      ]);
    }
  }
  for (const [key, items] of rootSpaceItems) rootSpaceItems.set(key, liftOrphans(items));
  const labVisibleBase = carved.size > 0 ? labItems.filter((it) => !carved.has(it.id)) : labItems;

  // Strip managed artifacts from the Lab scope (same as legacy).
  const labVisibleItems = labVisibleBase.filter(
    (it) => it.type !== "agreement" && it.type !== "rubric",
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

  // A root's forms live inside its folders, or sit on the root itself (the
  // filing rule points at the root), which is the space's top level.
  const rootForms = new Map<RootKey, DriveItem[]>();
  for (const [key, folderIds] of rootFolderIdsByKey) {
    const rootId = visibleRootIds.get(key)!;
    rootForms.set(
      key,
      pickScopeForms(folderIds, false, isCore).map((f) =>
        f.parentFolderId === rootId ? { ...f, parentFolderId: null } : f,
      ),
    );
  }
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

      case "process-root": {
        const key = space.rootKey!;
        const rootId = visibleRootIds.get(key);
        if (!rootId) break;
        result.push({
          id: space.key,
          label: space.label,
          iconEmoji: null,
          items: tagFavorites([...(rootSpaceItems.get(key) ?? []), ...(rootForms.get(key) ?? [])], favIds),
          rootFolderId: rootId,
          scopeAudience: ROOT_AUDIENCE[key],
        });
        break;
      }

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
  return result.map((scope) => ({ ...scope, items: withChildCounts(scope.items) }));
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
  preloadedProjectPages,
  preloadedProjectFiles,
}: {
  userSub: string;
  projectId: string;
  projectName: string;
  projectIconEmoji: string | null;
  request: Request;
  /** Rows the caller already fetched in `PROJECT_PAGE_SELECT` / `PROJECT_FILE_SELECT` shape. */
  preloadedProjectPages?: ProjectPageRow[];
  preloadedProjectFiles?: ProjectFileRow[];
}): Promise<DriveTreeScope> {
  const items: DriveItem[] = await loadDriveScope({
    userSub,
    scope: { kind: "Project", projectId },
    canViewForms: false,
    request,
    preloadedProjectPages,
    preloadedProjectFiles,
  });

  return {
    id: `project:${projectId}`,
    label: projectName,
    iconEmoji: projectIconEmoji,
    items: withChildCounts(items),
    scopeAudience: "Project members",
  };
}
