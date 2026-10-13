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
