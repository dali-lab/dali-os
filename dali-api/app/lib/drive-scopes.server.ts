// Server-only helper: loads per-scope DriveItems for the Drive hub's Browse
// lens and applies the form-placement de-dup logic so this code never reaches
// the client bundle (*.server.ts convention enforced by client-bundle-leak test).

import { loadDriveScope, buildLinkedProcessMap } from "~/lib/drive.server";
import type { DriveItem, ProjectPageRow, ProjectFileRow } from "~/lib/drive.server";
import { prisma } from "~/lib/db";
import { isImpersonating, type AuthSuccess } from "~/lib/auth";
import { favoritePageIds } from "~/lib/user-pages.server";
import { withChildCounts } from "~/lib/drive-counts.server";
import { loadSharedWithMe } from "~/lib/drive-shared.server";
import { visibleDriveSpaces } from "~/lib/drive-spaces";
import { getPageAccess } from "~/lib/pageAccess.server";
import { formsUsePageAccess } from "~/forms/lib/form-access.server";
import { ensureAllRoots, findAllRoots, type RootKey } from "~/lib/drive-roots.server";
import type { RoleFlags } from "~/lib/nav-areas";

// Tag each doc/folder/form item with whether the viewer has favorited it (drives
// the inline star). Files/agreements aren't page-favoritable, so they pass
// through untagged. Mutates in place for brevity — the arrays are freshly built.
function tagFavorites(items: DriveItem[], favIds: Set<string>): DriveItem[] {
  return items.map((it) =>
    (it.type === "doc" || it.type === "folder" || it.type === "form") && favIds.has(it.id)
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

async function loadLegacyCoreTops() {
  const coreGroup = await prisma.groupDefinition.findUnique({
    where: { systemKey: "core" },
    select: { id: true },
  });
  if (!coreGroup) return [];
  return prisma.page.findMany({
    where: {
      workspaceType: "Lab",
      workspaceId: null,
      parentPageId: null,
      scopeKind: "Group",
      scopeGroupId: coreGroup.id,
      archivedAt: null,
    },
    select: { id: true, folderType: true },
  });
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
 * Forms are Pages (kind Form) and arrive inside each scope's page load, so a
 * form sits wherever its page does: no cross-scope de-dup is needed. Lab-wide
 * and project/education spaces show them to `canViewForms` viewers; the
 * process-root spaces only to Core. A form whose folder was archived or deleted
 * is lifted to its scope's top level by the loader.
 */
export async function loadDriveScopes({
  auth,
  projectWorkspaces,
  educationWorkspaces,
  canViewForms,
  canManageAgreements,
  isCore,
  request,
}: {
  /** The viewer's already-resolved session; its `user.sub` is the viewer. */
  auth: AuthSuccess;
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
  const userSub = auth.user.sub;

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
  const hidePersonal = isImpersonating(auth);

  const processSpaces = spaces.filter((s) => s.backing === "process-root" && s.rootKey);
  const formsByPageAccess = await formsUsePageAccess(request);
  const needForms = canViewForms || isCore;

  // Signal ②: build process linkages once for the whole load (no per-row queries).
  const linkedProcessMapPending = buildLinkedProcessMap();
  const liveRootsPending = resolveLiveRoots(userSub, isCore);
  // Whether the viewer can open each root only needs the roots, not the Lab load.
  const rootAccessPending = liveRootsPending.then((live) =>
    Promise.all(
      processSpaces.map(async (space) => {
        const key = space.rootKey!;
        const rootId = live.byKey[key];
        if (!rootId) return null;
        const access = await getPageAccess(userSub, rootId, request);
        return access.canView ? { key, rootId } : null;
      }),
    ),
  );
  // Until the reparent job has run, Core-scoped folders still sit at the Lab
  // top level. Looked up speculatively: it needs nothing from the Lab load.
  const legacyTopsPending = isCore ? loadLegacyCoreTops() : Promise.resolve([]);
  const [
    favIds,
    memberItems,
    sharedItems,
    labItems,
    liveRoots,
    rootAccess,
    legacyTops,
    ...scopeItemArrays
  ] = await Promise.all([
    favoritePageIds(userSub),
    hidePersonal
      ? Promise.resolve<DriveItem[]>([])
      : loadDriveScope({ userSub, scope: { kind: "Member" }, formsByPageAccess, request }),
    hidePersonal
      ? Promise.resolve<DriveItem[]>([])
      : loadSharedWithMe({ userSub, request }),
    linkedProcessMapPending.then((linkedProcessMap) =>
      loadDriveScope({
        userSub,
        scope: { kind: "Lab" },
        // Wide enough for the process roots carved out below, which show forms
        // to Core; the General space narrows back to canViewForms.
        canViewForms: needForms,
        formsByPageAccess,
        canManageAgreements: isCore,
        request,
        linkedProcessMap,
      }),
    ),
    liveRootsPending,
    rootAccessPending,
    legacyTopsPending,
    ...projectIds.map((projectId) =>
      linkedProcessMapPending.then((linkedProcessMap) =>
        loadDriveScope({
          userSub,
          scope: { kind: "Project", projectId },
          canViewForms,
          formsByPageAccess,
          request,
          linkedProcessMap,
        }),
      ),
    ),
    ...educationIds.map((offeringId) =>
      linkedProcessMapPending.then((linkedProcessMap) =>
        loadDriveScope({
          userSub,
          scope: { kind: "EducationOffering", offeringId },
          canViewForms,
          formsByPageAccess,
          request,
          linkedProcessMap,
        }),
      ),
    ),
  ]);
  const projectItemArrays = scopeItemArrays.slice(0, projectIds.length);
  const educationItemArrays = scopeItemArrays.slice(projectIds.length);

  // Carve every root's subtree out of the Lab load, whichever process owns it:
  // a Mentorship root must never show as a folder in General, and a viewer who
  // cannot open a root has no space for it either. The root itself is dropped
  // and its children re-rooted to the space's top level.
  const carved = new Set<string>();
  const rootSpaceItems = new Map<RootKey, DriveItem[]>();
  const visibleRootIds = new Map<RootKey, string>();
  for (const rootId of liveRoots.ids) {
    for (const id of subtreeIds(labItems, rootId)) carved.add(id);
  }
  for (const visible of rootAccess) {
    if (!visible) continue;
    const { key, rootId } = visible;
    visibleRootIds.set(key, rootId);
    const inRoot = subtreeIds(labItems, rootId);
    rootSpaceItems.set(
      key,
      labItems
        .filter((it) => inRoot.has(it.id) && it.id !== rootId && (formsByPageAccess || isCore || it.type !== "form"))
        .map((it) => (it.parentFolderId === rootId ? { ...it, parentFolderId: null } : it)),
    );
  }

  if (isCore && visibleRootIds.has("core")) {
    const legacyIds = new Set<string>();
    for (const top of legacyTops) {
      if (top.folderType === "Root" || carved.has(top.id)) continue;
      if (!labItems.some((it) => it.id === top.id)) continue;
      for (const id of subtreeIds(labItems, top.id)) legacyIds.add(id);
    }
    if (legacyIds.size > 0) {
      for (const id of legacyIds) carved.add(id);
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
    (it) => it.type !== "agreement" && it.type !== "rubric" && (formsByPageAccess || canViewForms || it.type !== "form"),
  );

  const filteredLab = labVisibleItems;
  const filteredProjects = projectItemArrays;
  const filteredEducation = educationItemArrays;

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

      case "shared-with-me":
        result.push({
          id: space.key,
          label: space.label,
          iconEmoji: null,
          items: tagFavorites(sharedItems, favIds),
          scopeAudience: "Shared with you",
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
          items: tagFavorites(rootSpaceItems.get(key) ?? [], favIds),
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
