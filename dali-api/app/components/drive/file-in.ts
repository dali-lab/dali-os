import type { DriveItem } from "~/lib/drive.server";
import type { Destination } from "~/components/drive/FolderPicker";
import { locationOf, type ItemLocation } from "~/components/drive/location";
import type { DriveTreeScope } from "~/lib/drive-scopes.server";
import { resolveMoveTarget } from "~/components/drive/move-target";
import { destinationKey, type MultiResult } from "~/components/drive/picker-multi";
import type { PickerRows } from "~/components/drive/picker-rows";

/** Where a page lives or is filed, as `GET /api/pages/:id/shortcuts` reports it. */
export type PagePlace = {
  workspaceType: "Lab" | "Project" | "EducationOffering" | "Member";
  workspaceId: string | null;
  folderId: string | null;
  path: Array<{ id: string; title: string }>;
};
export type ShortcutPlace = PagePlace & { shortcutId: string };
export type Placements = { primary: PagePlace; shortcuts: ShortcutPlace[] };

/** A destination as the shortcut endpoints take it. */
export type ServerDest = {
  workspaceType: "Lab" | "Project" | "EducationOffering";
  workspaceId: string | null;
  parentPageId: string | null;
};

/** The items "File in…" and "Add shortcut to…" apply to: a doc, notebook, whiteboard or folder that is a real page (not a project or offering's stand-in folder) outside My Drive. */
export function canFileIn(item: DriveItem, scopeId: string, scopeItems: DriveItem[]): boolean {
  if (scopeId === "mine") return false;
  if (item.type === "doc") return true;
  if (item.type !== "folder") return false;
  const syntheticTop =
    (scopeId === "projects" || scopeId === "education") &&
    scopeItems.some((it) => it.id === item.id && it.parentFolderId === null);
  return !syntheticTop;
}

/** The picker destination a place corresponds to, or null when the picker doesn't offer it. */
export function destinationForPlace(place: PagePlace, rows: PickerRows): Destination | null {
  if (place.workspaceType === "Member") return null;
  if (place.folderId) {
    const rootOf = rows.drives.find((d) => d.rootFolderId === place.folderId);
    if (rootOf) return { driveId: rootOf.id, folderId: null };
    const folder = rows.folders.find((f) => f.id === place.folderId);
    return folder ? { driveId: folder.driveId, folderId: folder.id } : null;
  }
  if (place.workspaceType === "Lab") {
    return rows.drives.some((d) => d.id === "lab") ? { driveId: "lab", folderId: null } : null;
  }
  const driveId = place.workspaceType === "Project" ? "projects" : "education";
  const workspace = rows.folders.find((f) => f.driveId === driveId && f.id === place.workspaceId);
  return workspace ? { driveId, folderId: workspace.id } : null;
}

export function toServerDest(dest: Destination, rows: PickerRows): ServerDest | null {
  const target = resolveMoveTarget(dest, rows);
  if (!target) return null;
  return { workspaceType: target.workspaceType, workspaceId: target.workspaceId, parentPageId: target.parentPageId };
}

export type PlacePlan = {
  /** The body for `POST /api/pages/:id/place`; null when a chosen destination can't be filed into. */
  payload: { destinations: ServerDest[]; primaryIndex: number } | null;
  primaryChanged: boolean;
  /** Shortcuts the request will add: every chosen destination but the primary and the ones already filed. */
  added: number;
};

/**
 * What a multi-mode confirm asks the server to do. Locked destinations (shortcuts
 * that already exist) are left out of the request, so the server only sees new work.
 */
export function planPlacement({
  result,
  rows,
  currentPrimary,
  locked,
}: {
  result: MultiResult;
  rows: PickerRows;
  currentPrimary: Destination;
  locked: Destination[];
}): PlacePlan {
  const lockedKeys = new Set(locked.map(destinationKey));
  const chosenPrimary = result.destinations[result.primaryIndex];
  const send = result.destinations.filter((d) => d === chosenPrimary || !lockedKeys.has(destinationKey(d)));
  const destinations = send.map((d) => toServerDest(d, rows));
  const primaryChanged = destinationKey(chosenPrimary) !== destinationKey(currentPrimary);
  const added = send.filter((d) => d !== chosenPrimary).length;
  if (destinations.some((d) => d === null)) return { payload: null, primaryChanged, added };
  return {
    payload: { destinations: destinations as ServerDest[], primaryIndex: send.indexOf(chosenPrimary) },
    primaryChanged,
    added,
  };
}

/** The toast after filing: what was added, which location is primary, and how many grants were declined. */
export function placeToast({
  added,
  declined,
  primaryPath,
}: {
  added: number;
  declined: number;
  primaryPath: string;
}): string {
  const parts: string[] = [];
  if (added > 0) parts.push(`${added} location${added === 1 ? "" : "s"} added.`);
  parts.push(`Primary: ${primaryPath}.`);
  if (declined > 0) parts.push(`${declined} could not be shared; ask the owner.`);
  return parts.join(" ");
}

/** The toast after a single shortcut was added or already there. */
export function shortcutToast({
  created,
  grantDeclined,
  folderLabel,
}: {
  created: boolean;
  grantDeclined: boolean;
  folderLabel: string;
}): string {
  if (!created) return `There is already a shortcut in ${folderLabel}.`;
  return grantDeclined
    ? `Shortcut added to ${folderLabel}. It could not be shared; ask the owner.`
    : `Shortcut added to ${folderLabel}.`;
}

export const SHORTCUT_REMOVED_TOAST = "Shortcut removed. The original is untouched.";

/** The toast after a bulk delete: shortcuts alone say the originals are untouched. */
export function bulkDeletedToast(items: Array<{ type: string }>): string {
  const count = items.length;
  if (count > 0 && items.every((i) => i.type === "shortcut")) {
    return count === 1 ? SHORTCUT_REMOVED_TOAST : `${count} shortcuts removed. The originals are untouched.`;
  }
  return `Deleted ${count}`;
}

const WORKSPACE_LABEL: Record<PagePlace["workspaceType"], string> = {
  Lab: "Lab",
  Project: "Project",
  EducationOffering: "Offering",
  Member: "My Drive",
};

/** The folder path of a place as one line, or its workspace when it sits at the top level. */
export function placeLabel(place: PagePlace): string {
  if (place.path.length === 0) return WORKSPACE_LABEL[place.workspaceType];
  return place.path.map((p) => p.title || "Untitled folder").join(" / ");
}

/** How a row renders a shortcut: dimmed when the viewer can't open the original, with a chip when it is in the trash. */
export function shortcutRowState(item: DriveItem): { dimmed: boolean; inTrash: boolean } {
  if (item.type !== "shortcut") return { dimmed: false, inTrash: false };
  return { dimmed: !item.canOpen, inTrash: item.originalInTrash };
}

/** Where a shortcut's original sits among the scopes already loaded; null when it isn't in any of them. */
export function locateTarget(scopes: DriveTreeScope[], targetId: string): ItemLocation | null {
  for (const scope of scopes) {
    const target = scope.items.find((it) => it.id === targetId);
    if (target) return locationOf(scope, target.parentFolderId);
  }
  return null;
}

/** Where opening a shortcut to a folder goes in the Drive; null when the shortcut leads elsewhere (a page) or the folder isn't among the loaded scopes. */
export function folderShortcutTarget(
  scopes: DriveTreeScope[],
  item: DriveItem,
): { scopeId: string; folderId: string } | null {
  if (item.type !== "shortcut" || item.targetType !== "folder" || !item.canOpen) return null;
  const owner = scopes.find((s) => s.items.some((it) => it.id === item.targetId));
  return owner ? { scopeId: owner.id, folderId: item.targetId } : null;
}
