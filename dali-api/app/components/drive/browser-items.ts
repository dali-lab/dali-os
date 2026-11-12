// DriveBrowser — the unified Drive's browser, in three views over one model.
//
// VIEWS: Miller columns (the default, Finder-style), list and grid. Search
//   results are a flat list. All of them share one interaction model: a plain
//   click selects, cmd/ctrl-click toggles, shift-click extends, a rubber-band
//   drag selects, a double-click opens (a folder is entered), and one keyboard
//   handler drives every view.
//
// Also here: type filter, search, drag-and-drop internal move, drag-to-upload,
//   favorites, rename, move, delete, bulk actions, context menu, breadcrumb, sort.

import type { DriveItem } from "~/drive/lib/drive.server";
import { matchesTypeFilter } from "~/components/drive/type-filter";
import { categorize } from "~/lib/file-type";
import type { DriveTreeScope } from "~/drive/lib/drive-scopes.server";
import { locationOf, type ItemLocation } from "~/components/drive/location";
import type { DriveBrowserProps } from "./DriveBrowser";

export type SortKey = "name" | "modified" | "size" | "shared";

export type SortDir = "asc" | "desc";

export type ViewMode = "columns" | "list" | "grid";

/** Where the browser is pointed: a drive, and a folder inside it. */
export type DriveLocation = { scopeId: string | null; folderId: string | null };

export function childrenAt(items: DriveItem[], folderId: string | null): DriveItem[] {
  return items.filter((it) => it.parentFolderId === folderId);
}

export function kindLabel(item: DriveItem): string {
  switch (item.type) {
    case "folder":
      return "Folder";
    case "doc":
      return item.isNotebook ? `Notebook · ${item.tabCount ?? 0} ${item.tabCount === 1 ? "tab" : "tabs"}` : "Document";
    case "file":
      return "File";
    case "form":
      return "Form";
    case "rubric":
      return "Rubric";
    default:
      return "Agreement";
  }
}

// Quick Look only has something to show for uploaded images and PDFs. Docs,
// forms, folders and the managed kinds have no inline representation — they open
// in their editor — so the preview affordance is hidden for them rather than
// offering a button that just says "no preview."
export function isPreviewable(item: DriveItem): boolean {
  if (item.type !== "file") return false;
  // Drive items carry no content type and their href is the file *page* (not an
  // inline media URL), so Quick Look renders only what an <img>/<iframe> can
  // load from that surface: images and PDFs. Classification is shared; the
  // narrowing to image+pdf is this surface's constraint, not the taxonomy's.
  const cat = categorize({ fileName: item.title || "" });
  return cat === "image" || cat === "pdf";
}

export function formatSize(bytes?: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

export function ms(d: Date): number {
  return new Date(d as unknown as string).getTime();
}

export function sharedAtMs(item: DriveItem): number {
  return item.type === "doc" && item.sharedAt ? ms(item.sharedAt) : 0;
}

// Folders always group first; sort within each group by the chosen key.
export function sortItems(items: DriveItem[], key: SortKey, dir: SortDir): DriveItem[] {
  const cmp = (a: DriveItem, b: DriveItem) => {
    let r = 0;
    if (key === "name") r = (a.title || "").localeCompare(b.title || "");
    else if (key === "modified") r = ms(a.updatedAt) - ms(b.updatedAt);
    else if (key === "shared") r = sharedAtMs(a) - sharedAtMs(b);
    else r = (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0);
    if (r === 0) r = (a.title || "").localeCompare(b.title || "");
    return dir === "asc" ? r : -r;
  };
  const folders = items.filter((i) => i.type === "folder").sort(cmp);
  const rest = items.filter((i) => i.type !== "folder").sort(cmp);
  return [...folders, ...rest];
}

export type SearchHit = { scope: DriveTreeScope; item: DriveItem; path: string; location: ItemLocation };

export function searchAll(
  scopes: DriveTreeScope[],
  q: string,
  typeFilter: DriveBrowserProps["typeFilter"],
  tagFilter?: (item: DriveItem) => boolean,
): SearchHit[] {
  const needle = q.trim().toLowerCase();
  // Tags alone are a valid query: "everything tagged X, anywhere in the Drive"
  // is the thing the old documents hub could answer and the tree can't.
  if (!needle && !tagFilter) return [];
  const hits: SearchHit[] = [];
  for (const scope of scopes) {
    for (const item of scope.items) {
      if (!matchesTypeFilter(item, typeFilter)) continue;
      if (needle && !(item.title || "").toLowerCase().includes(needle)) continue;
      if (tagFilter && !tagFilter(item)) continue;
      const location = locationOf(scope, item.parentFolderId);
      hits.push({ scope, item, path: location.path, location });
    }
  }
  return hits.sort((a, b) => (a.item.title || "").localeCompare(b.item.title || ""));
}

export function folderDescendants(items: DriveItem[], folderId: string): Set<string> {
  const childMap = new Map<string, string[]>();
  for (const it of items) {
    if (it.type !== "folder") continue;
    const p = it.parentFolderId ?? "_root_";
    const list = childMap.get(p);
    if (list) list.push(it.id);
    else childMap.set(p, [it.id]);
  }
  const out = new Set([folderId]);
  const queue = [folderId];
  while (queue.length) {
    const cur = queue.pop()!;
    for (const c of childMap.get(cur) ?? []) if (!out.has(c)) (out.add(c), queue.push(c));
  }
  return out;
}

// ── Icons ────────────────────────────────────────────────────────────────────
