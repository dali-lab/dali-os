// Server-only helper: loads per-scope DriveItems for the Drive hub's Browse
// lens and applies the form-placement de-dup logic so this code never reaches
// the client bundle (*.server.ts convention enforced by client-bundle-leak test).

import { loadDriveScope } from "~/lib/drive.server";
import type { DriveItem } from "~/lib/drive.server";

export type DriveTreeScope = {
  id: string;
  label: string;
  iconEmoji: string | null;
  items: DriveItem[];
};

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
  request,
}: {
  userSub: string;
  projectWorkspaces: WorkspaceOut[];
  canViewForms: boolean;
  request: Request;
}): Promise<DriveTreeScope[]> {
  const projectIds = projectWorkspaces.map((w) => w.key);
  const projectNames = new Map(projectWorkspaces.map((w) => [w.key, w.label]));
  const projectEmojis = new Map(
    projectWorkspaces.map((w) => [w.key, w.projectIconEmoji ?? null]),
  );

  const [labItems, ...projectItemArrays] = await Promise.all([
    loadDriveScope({
      userSub,
      scope: { kind: "Lab" },
      canViewForms,
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

  // Build a folder-id set per scope for the de-dup pass below.
  const labFolderIds = new Set(
    labItems.filter((i) => i.type === "folder").map((i) => i.id),
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

  const filteredLab = filterScopeForms(labItems, labFolderIds, true);
  const filteredProjects = projectItemArrays.map((arr, i) =>
    filterScopeForms(arr, projectFolderIdSets[i], false),
  );

  return [
    { id: "lab", label: "Lab-wide", iconEmoji: null, items: filteredLab },
    ...projectIds.map((id, i) => ({
      id,
      label: projectNames.get(id) ?? "Project",
      iconEmoji: projectEmojis.get(id) ?? null,
      items: filteredProjects[i],
    })),
  ];
}
