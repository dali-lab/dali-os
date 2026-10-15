import type { Destination } from "~/components/drive/FolderPicker";
import type { PickerRows } from "~/components/drive/picker-rows";

export type MoveTarget = {
  workspaceType: "Lab" | "Project" | "EducationOffering";
  workspaceId: string | null;
  parentPageId: string | null;
  /** What the confirm and toast call the destination. */
  label: string;
  /** Set when the destination is a process root (Core, Hiring, Mentorship). */
  rootDriveId: string | null;
};

export type MoveCurrent = { type: string; id?: string | null };

/** Where a picked destination lands in the database. Core, Hiring and
 *  Mentorship are Lab-workspace pages under their root folder; "Projects" and
 *  "Education" list each workspace as a top-level folder, so a pick there
 *  resolves to that workspace. Null when the pick is not a place a page can go
 *  (My Drive, or the bare Projects / Education list). */
export function resolveMoveTarget(dest: Destination, rows: PickerRows): MoveTarget | null {
  const drive = rows.drives.find((d) => d.id === dest.driveId);
  if (!drive || drive.id === "mine") return null;
  if (drive.id === "projects" || drive.id === "education") {
    if (!dest.folderId) return null;
    const byId = new Map(rows.folders.map((f) => [f.id, f]));
    let top = byId.get(dest.folderId);
    const seen = new Set<string>();
    while (top?.parentId && !seen.has(top.id)) {
      seen.add(top.id);
      top = byId.get(top.parentId);
    }
    if (!top) return null;
    return {
      workspaceType: drive.id === "projects" ? "Project" : "EducationOffering",
      workspaceId: top.id,
      parentPageId: dest.folderId === top.id ? null : dest.folderId,
      label: top.title,
      rootDriveId: null,
    };
  }
  return {
    workspaceType: "Lab",
    workspaceId: null,
    parentPageId: dest.folderId ?? drive.rootFolderId ?? null,
    label: drive.id === "lab" ? "Lab-wide" : drive.label,
    rootDriveId: drive.rootFolderId ? drive.id : null,
  };
}

/** Moving to another workspace, or into a process root, changes who can see the
 *  page. The editor does not know which drive a Lab page is in, so a move into
 *  a root always asks. */
export function needsAudienceConfirm(target: MoveTarget, current: MoveCurrent): boolean {
  if (target.workspaceType !== current.type) return true;
  if ((target.workspaceId ?? null) !== (current.id ?? null)) return true;
  return target.rootDriveId !== null;
}

/** Where the picker opens: the page's current workspace. */
export function moveInitial(current: MoveCurrent, rows: PickerRows): Destination | undefined {
  if (current.type === "Lab") {
    return rows.drives.some((d) => d.id === "lab") ? { driveId: "lab", folderId: null } : undefined;
  }
  const driveId = current.type === "Project" ? "projects" : current.type === "EducationOffering" ? "education" : null;
  if (!driveId || !current.id) return undefined;
  const inRows = rows.folders.some((f) => f.driveId === driveId && f.id === current.id);
  return inRows ? { driveId, folderId: current.id } : undefined;
}

/** The page itself and everything under it, when the page is a folder in
 *  `rows`: moving a folder into its own subtree is rejected by the server. */
export function descendantFolderIds(rows: PickerRows, pageId: string): Set<string> {
  const banned = new Set<string>();
  if (!rows.folders.some((f) => f.id === pageId)) return banned;
  banned.add(pageId);
  // Repeated passes: the flat list isn't in parent-before-child order.
  for (let pass = 0; pass < rows.folders.length; pass++) {
    let grew = false;
    for (const f of rows.folders) {
      if (!banned.has(f.id) && f.parentId && banned.has(f.parentId)) {
        banned.add(f.id);
        grew = true;
      }
    }
    if (!grew) break;
  }
  return banned;
}
