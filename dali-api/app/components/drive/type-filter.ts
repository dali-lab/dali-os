import type { DriveItem } from "~/lib/drive.server";

export type DriveTypeFilter = "all" | "doc" | "notebook" | "whiteboard" | "file" | "form" | "agreement" | "rubric";

export const DRIVE_TYPE_FILTERS: readonly DriveTypeFilter[] = [
  "all",
  "doc",
  "notebook",
  "whiteboard",
  "file",
  "form",
  "agreement",
  "rubric",
];

export function parseTypeFilter(raw: string | null | undefined): DriveTypeFilter {
  return raw && (DRIVE_TYPE_FILTERS as readonly string[]).includes(raw) ? (raw as DriveTypeFilter) : "all";
}

/** Whether an item is of the filtered type. Documents are plain docs only; notebooks and whiteboards have their own filters. */
export function matchesTypeFilter(item: DriveItem, filter: DriveTypeFilter): boolean {
  if (filter === "all") return true;
  if (item.type !== "doc") return item.type === filter;
  if (item.isNotebook) return filter === "notebook";
  if (item.isWhiteboard) return filter === "whiteboard";
  return filter === "doc";
}

/** The listing keeps folders visible under every filter, so the tree stays navigable. */
export function listedUnderFilter(item: DriveItem, filter: DriveTypeFilter): boolean {
  return item.type === "folder" || matchesTypeFilter(item, filter);
}
