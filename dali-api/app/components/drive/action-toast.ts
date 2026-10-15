import type { DriveItem } from "~/lib/drive.server";

/** How long a move or trash toast stays up: long enough to reach for Undo. */
export const ACTION_TOAST_MS = 8000;

const PATH_SEPARATOR = " ▸ ";

export function pathLabel(parts: string[]): string {
  return parts.filter(Boolean).join(PATH_SEPARATOR);
}

export function quoted(title: string | null | undefined): string {
  return `“${title?.trim() || "Untitled"}”`;
}

function countOf(n: number): string {
  return `${n} item${n === 1 ? "" : "s"}`;
}

/** The thing a sentence is about: its title for one item, a count for several. */
function subject(titles: string[]): string {
  return titles.length === 1 ? quoted(titles[0]) : countOf(titles.length);
}

const into = (destination: string | null | undefined) => (destination ? ` to ${destination}` : "");

/**
 * `Moved “X” to Core ▸ Meetings`, `Moved 4 items to Core ▸ Meetings`, or
 * `Moved 3 of 4 items to Core ▸ Meetings` when `attempted` is more than landed.
 * The destination is left off when it isn't known.
 */
export function movedToast({
  titles,
  attempted = titles.length,
  destination,
}: {
  titles: string[];
  attempted?: number;
  destination?: string | null;
}): string {
  if (attempted > titles.length) return `Moved ${titles.length} of ${countOf(attempted)}${into(destination)}`;
  return `Moved ${subject(titles)}${into(destination)}`;
}

/** The toast after trashing. */
export function trashedToast(items: Array<Pick<DriveItem, "title">>): string {
  return `Moved ${subject(items.map((i) => i.title))} to Trash`;
}

/** The confirmation after Undo on a trash toast. */
export function restoredToast(titles: string[]): string {
  return `Restored ${subject(titles)}`;
}

type PathScope = {
  label: string;
  rootFolderId?: string | null;
  items: Array<Pick<DriveItem, "id" | "title" | "parentFolderId">>;
};

/**
 * A destination as a full path, drive first: `Core ▸ Meetings ▸ Weekly`.
 * `folderId` null (or the scope's own root folder) names the drive alone. The
 * walk stops at the drive's root folder, which is not a level the user sees.
 */
export function destinationLabel(scope: PathScope, folderId: string | null): string {
  const byId = new Map(scope.items.map((it) => [it.id, it]));
  const chain: string[] = [];
  const seen = new Set<string>();
  let cursor = folderId;
  while (cursor && cursor !== scope.rootFolderId && !seen.has(cursor)) {
    seen.add(cursor);
    const folder = byId.get(cursor);
    if (!folder) break;
    chain.unshift(folder.title || "Untitled folder");
    cursor = folder.parentFolderId;
  }
  return pathLabel([scope.label, ...chain]);
}
