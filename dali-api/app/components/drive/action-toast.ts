import type { DriveItem } from "~/lib/drive.server";

/** How long a move, filing or trash toast stays up: long enough to reach for Undo. */
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

const MAX_NAMED_SHORTCUTS = 2;

function alsoIn(shortcutDestinations: string[]): string {
  if (shortcutDestinations.length === 0) return "";
  const named = shortcutDestinations.slice(0, MAX_NAMED_SHORTCUTS);
  const rest = shortcutDestinations.length - named.length;
  if (rest > 0) return `, also in ${named.join(", ")} and ${rest} more`;
  return `, also in ${named.join(" and ")}`;
}

const declinedSentence = (declined: number) => ` ${declined} could not be shared; ask the owner.`;

/** The toast after "File in…": the primary location, the shortcuts left behind, and any declined grants. */
export function filedToast({
  title,
  destination,
  shortcutDestinations = [],
  declined = 0,
}: {
  title: string;
  destination: string;
  shortcutDestinations?: string[];
  declined?: number;
}): string {
  const base = `Filed ${quoted(title)} in ${destination}${alsoIn(shortcutDestinations)}`;
  return declined > 0 ? `${base}.${declinedSentence(declined)}` : base;
}

/** The toast after "Add shortcut to…", including the case where one was already there. */
export function shortcutToast({
  created,
  title,
  destination,
  grantDeclined = false,
}: {
  created: boolean;
  title: string;
  destination: string;
  grantDeclined?: boolean;
}): string {
  if (!created) return `There is already a shortcut in ${destination}.`;
  const base = `Added a shortcut to ${quoted(title)} in ${destination}`;
  return grantDeclined ? `${base}. It could not be shared; ask the owner.` : base;
}

export const SHORTCUT_REMOVED_TOAST = "Shortcut removed. The original is untouched.";

/** The toast after trashing. Shortcuts alone say the originals are untouched, because nothing went to Trash. */
export function trashedToast(items: Array<Pick<DriveItem, "type" | "title">>): string {
  if (items.length > 0 && items.every((i) => i.type === "shortcut")) {
    return items.length === 1 ? SHORTCUT_REMOVED_TOAST : `${items.length} shortcuts removed. The originals are untouched.`;
  }
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
