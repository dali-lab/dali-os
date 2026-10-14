import type { PickerDrive, PickerFolder } from "~/components/drive/FolderPicker";

/** The slice of a Drive scope the picker needs. Structural so this module stays
 *  client-safe: `DriveTreeScope` (drive-scopes.server) satisfies it. */
export type PickerScope = {
  id: string;
  label: string;
  iconEmoji: string | null;
  rootFolderId?: string | null;
  scopeAudience?: string | null;
  items: {
    type: string;
    id: string;
    title: string;
    iconEmoji?: string | null;
    parentFolderId: string | null;
    folderType?: string | null;
  }[];
};

/** A project or offering row of the Projects and Education drives, not a user's folder. */
export function isSyntheticFolder(f: Pick<PickerFolder, "driveId" | "parentId">): boolean {
  return f.parentId === null && (f.driveId === "projects" || f.driveId === "education");
}

export type PickerRows = { drives: PickerDrive[]; folders: PickerFolder[] };

/** Scope-to-picker mapping shared by the Drive hub (from its loader) and
 *  `/api/drive/destinations`, so every surface offers the same destinations.
 *  A scope's top-level folders get `parentId: null` whatever the DB parent is
 *  (the root folder for Core, Hiring and Mentorship), and each folder carries
 *  its direct child count. */
export function buildPickerRows(scopes: PickerScope[]): PickerRows {
  const drives: PickerDrive[] = scopes.map((s) => ({
    id: s.id,
    label: s.id === "lab" ? "Lab" : s.label,
    iconEmoji: s.iconEmoji,
    audience: s.scopeAudience ?? null,
    rootFolderId: s.rootFolderId ?? null,
  }));
  const folders: PickerFolder[] = [];
  for (const s of scopes) {
    const rootId = s.rootFolderId ?? null;
    const childCount = new Map<string, number>();
    for (const it of s.items) {
      if (it.parentFolderId === null) continue;
      childCount.set(it.parentFolderId, (childCount.get(it.parentFolderId) ?? 0) + 1);
    }
    for (const f of s.items) {
      if (f.type !== "folder") continue;
      folders.push({
        id: f.id,
        driveId: s.id,
        parentId: (f.parentFolderId ?? null) === rootId ? null : f.parentFolderId,
        title: f.title,
        iconEmoji: f.iconEmoji ?? null,
        itemCount: childCount.get(f.id) ?? 0,
        folderType: f.folderType ?? null,
      });
    }
  }
  return { drives, folders };
}

/** Keeps the drives whose id passes `keep`, with their folders. */
export function pickDrives(rows: PickerRows, keep: (driveId: string) => boolean): PickerRows {
  const drives = rows.drives.filter((d) => keep(d.id));
  const ids = new Set(drives.map((d) => d.id));
  return { drives, folders: rows.folders.filter((f) => ids.has(f.driveId)) };
}

/** Narrows rows to what the viewer may write to. A folder that survives but
 *  whose parent did not moves to its drive's top level, so it still renders. */
export function keepWritable(
  rows: PickerRows,
  writable: { driveIds: Set<string>; folderIds: Set<string> },
): PickerRows {
  const drives = rows.drives.filter((d) => writable.driveIds.has(d.id));
  const driveIds = new Set(drives.map((d) => d.id));
  const kept = rows.folders.filter((f) => driveIds.has(f.driveId) && writable.folderIds.has(f.id));
  const keptIds = new Set(kept.map((f) => f.id));
  return {
    drives,
    folders: kept.map((f) =>
      f.parentId !== null && !keptIds.has(f.parentId) ? { ...f, parentId: null } : f,
    ),
  };
}

/** Case-insensitive substring match on a folder's title or its path
 *  (drive / ancestors / title). Returns the matching folders and their drives
 *  only. */
export function searchRows(rows: PickerRows, query: string): PickerRows {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  const driveById = new Map(rows.drives.map((d) => [d.id, d]));
  const folderById = new Map(rows.folders.map((f) => [f.id, f]));
  const pathOf = (f: PickerFolder): string => {
    const parts: string[] = [];
    const seen = new Set<string>();
    let cur: PickerFolder | undefined = f;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      parts.unshift(cur.title);
      cur = cur.parentId ? folderById.get(cur.parentId) : undefined;
    }
    parts.unshift(driveById.get(f.driveId)?.label ?? "");
    return parts.join(" / ");
  };
  const folders = rows.folders.filter(
    (f) => f.title.toLowerCase().includes(q) || pathOf(f).toLowerCase().includes(q),
  );
  const driveIds = new Set(folders.map((f) => f.driveId));
  return { drives: rows.drives.filter((d) => driveIds.has(d.id)), folders };
}

/** What the pages being moved pin down: the typed roots they live under and the
 *  workspaces of their system folders. More than one of either leaves nowhere. */
export type MoveConstraint = {
  rootFolderIds: string[];
  workspaces: { type: "Lab" | "Project" | "EducationOffering" | "Member"; id: string | null }[];
};

function topLevelAncestor(folder: PickerFolder, byId: Map<string, PickerFolder>): PickerFolder {
  let cur = folder;
  const seen = new Set<string>();
  while (cur.parentId && byId.has(cur.parentId) && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = byId.get(cur.parentId)!;
  }
  return cur;
}

/** Drops the drives and folders a move would be refused into, so the picker never offers them. */
export function applyMoveConstraint(rows: PickerRows, constraint: MoveConstraint): PickerRows {
  const { rootFolderIds, workspaces } = constraint;
  if (rootFolderIds.length === 0 && workspaces.length === 0) return rows;
  let keepDrive = (d: PickerDrive) => true;
  let keepFolder = (f: PickerFolder, byId: Map<string, PickerFolder>) => true;
  if (rootFolderIds.length > 0) {
    const only = rootFolderIds.length === 1 ? rootFolderIds[0] : null;
    keepDrive = (d) => only !== null && d.rootFolderId === only;
  }
  if (workspaces.length > 0) {
    const ws = workspaces.length === 1 ? workspaces[0] : null;
    const rootKeep = keepDrive;
    keepDrive = (d) => {
      if (!rootKeep(d) || !ws) return false;
      if (ws.type === "Lab") return d.id === "lab" || !!d.rootFolderId;
      if (ws.type === "Project") return d.id === "projects";
      if (ws.type === "EducationOffering") return d.id === "education";
      return false;
    };
    keepFolder = (f, byId) =>
      !ws || ws.type === "Lab" || ws.type === "Member" || topLevelAncestor(f, byId).id === ws.id;
  }
  const drives = rows.drives.filter(keepDrive);
  const ids = new Set(drives.map((d) => d.id));
  const byId = new Map(rows.folders.map((f) => [f.id, f]));
  return {
    drives,
    folders: rows.folders.filter((f) => ids.has(f.driveId) && keepFolder(f, byId)),
  };
}
