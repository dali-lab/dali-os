import type { DriveItem } from "~/lib/drive.server";

/**
 * Fill in `itemCount` on folders and `tabCount` on notebooks from the items a
 * scope already holds. Counting what is in hand means the number is what the
 * viewer can actually see in the folder, and costs no query.
 */
export function withChildCounts(items: DriveItem[]): DriveItem[] {
  const childCount = new Map<string, number>();
  for (const item of items) {
    if (item.parentFolderId) {
      childCount.set(item.parentFolderId, (childCount.get(item.parentFolderId) ?? 0) + 1);
    }
  }
  return items.map((item) => {
    if (item.type === "folder") return { ...item, itemCount: childCount.get(item.id) ?? 0 };
    if (item.type === "doc" && item.isNotebook) return { ...item, tabCount: childCount.get(item.id) ?? 0 };
    return item;
  });
}
