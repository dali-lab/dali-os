// Pure helpers over the flat FormFolder list for the "Move to…" picker.
// Client-safe by convention (.shared.ts): no server imports here — the
// browser renders the tree and disables invalid targets; the server's
// isDescendantOrSelf() check in forms-data.ts stays authoritative.

export type FolderOption = { id: string; name: string; parentId: string | null };
export type FolderTreeRow = { id: string; name: string; depth: number };

// Depth-first flattening of the folder forest. Siblings keep input order
// (the loader name-sorts). A folder whose parentId isn't in the list is
// treated as a root so it never disappears from the picker; a visited set
// plus a final sweep keep even cyclic data (impossible server-side, but
// defensive) from hanging or dropping rows.
export function flattenFolderTree(folders: FolderOption[]): FolderTreeRow[] {
  const known = new Set(folders.map((f) => f.id));
  const children = new Map<string | null, FolderOption[]>();
  for (const f of folders) {
    const key = f.parentId !== null && known.has(f.parentId) ? f.parentId : null;
    const list = children.get(key);
    if (list) list.push(f);
    else children.set(key, [f]);
  }

  const rows: FolderTreeRow[] = [];
  const visited = new Set<string>();
  function walk(parentId: string | null, depth: number) {
    for (const f of children.get(parentId) ?? []) {
      if (visited.has(f.id)) continue;
      visited.add(f.id);
      rows.push({ id: f.id, name: f.name, depth });
      walk(f.id, depth + 1);
    }
  }
  walk(null, 0);
  for (const f of folders) {
    if (!visited.has(f.id)) rows.push({ id: f.id, name: f.name, depth: 0 });
  }
  return rows;
}

// Full display path ("Parent / Child / Grandchild") for every folder, keyed
// by id. Search results show an item's location with this; an orphaned or
// cyclic parent chain (impossible server-side, defensive here) just truncates
// to the reachable prefix.
export function folderPathMap(folders: FolderOption[]): Map<string, string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const paths = new Map<string, string>();
  function pathOf(id: string, seen: Set<string>): string {
    const cached = paths.get(id);
    if (cached !== undefined) return cached;
    const f = byId.get(id);
    if (!f) return "";
    let path = f.name;
    if (f.parentId && byId.has(f.parentId) && !seen.has(f.parentId)) {
      seen.add(f.parentId);
      const parentPath = pathOf(f.parentId, seen);
      if (parentPath) path = `${parentPath} / ${f.name}`;
    }
    paths.set(id, path);
    return path;
  }
  for (const f of folders) pathOf(f.id, new Set([f.id]));
  return paths;
}

// The folder itself plus every folder beneath it — the set of invalid move
// destinations when moving `folderId`.
export function descendantSetOf(
  folders: FolderOption[],
  folderId: string,
): Set<string> {
  const children = new Map<string, string[]>();
  for (const f of folders) {
    if (f.parentId === null) continue;
    const list = children.get(f.parentId);
    if (list) list.push(f.id);
    else children.set(f.parentId, [f.id]);
  }
  const result = new Set<string>([folderId]);
  const queue = [folderId];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    for (const child of children.get(cur) ?? []) {
      if (result.has(child)) continue;
      result.add(child);
      queue.push(child);
    }
  }
  return result;
}
