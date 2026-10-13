import type { Destination } from "~/components/drive/FolderPicker";

/** The multi-select picker's chosen destinations, in the order they were picked, and which one is primary. */
export type MultiSelection = {
  items: Destination[];
  /** Key of the primary destination; null only while `items` is empty. */
  primary: string | null;
};

export const EMPTY_SELECTION: MultiSelection = { items: [], primary: null };

export function destinationKey(d: Destination): string {
  return `${d.driveId}\0${d.folderId ?? ""}`;
}

export function isSelected(sel: MultiSelection, dest: Destination): boolean {
  const key = destinationKey(dest);
  return sel.items.some((d) => destinationKey(d) === key);
}

/** The first destination is primary until the user picks another. Duplicates collapse. */
export function selectionFrom(destinations: Destination[], primaryIndex = 0): MultiSelection {
  const items: Destination[] = [];
  const seen = new Set<string>();
  let primary: string | null = null;
  destinations.forEach((d, i) => {
    const key = destinationKey(d);
    if (seen.has(key)) return;
    seen.add(key);
    items.push(d);
    if (i === primaryIndex) primary = key;
  });
  return { items, primary: primary ?? (items[0] ? destinationKey(items[0]) : null) };
}

/** Adds `dest` at the end; the first one added becomes primary. Already selected is a no-op. */
export function addSelection(sel: MultiSelection, dest: Destination): MultiSelection {
  if (isSelected(sel, dest)) return sel;
  return { items: [...sel.items, dest], primary: sel.primary ?? destinationKey(dest) };
}

/**
 * Removing the primary promotes the first remaining destination that `canBePrimary`
 * accepts (any, by default). With none left to promote the selection has no primary,
 * which `toResult` reports as nothing to confirm.
 */
export function removeSelection(
  sel: MultiSelection,
  dest: Destination,
  canBePrimary: (d: Destination) => boolean = () => true,
): MultiSelection {
  const key = destinationKey(dest);
  if (!isSelected(sel, dest)) return sel;
  const items = sel.items.filter((d) => destinationKey(d) !== key);
  if (sel.primary !== key) return { items, primary: sel.primary };
  const next = items.find(canBePrimary);
  return { items, primary: next ? destinationKey(next) : null };
}

export function toggleSelection(sel: MultiSelection, dest: Destination): MultiSelection {
  return isSelected(sel, dest) ? removeSelection(sel, dest) : addSelection(sel, dest);
}

/** Makes an already-selected destination primary. Anything else is a no-op. */
export function setPrimary(sel: MultiSelection, dest: Destination): MultiSelection {
  return isSelected(sel, dest) ? { ...sel, primary: destinationKey(dest) } : sel;
}

export function primaryIndex(sel: MultiSelection): number {
  return sel.primary === null ? -1 : sel.items.findIndex((d) => destinationKey(d) === sel.primary);
}

export function primaryOf(sel: MultiSelection): Destination | null {
  const i = primaryIndex(sel);
  return i < 0 ? null : sel.items[i];
}

/** What a multi-mode picker hands to `onConfirm`. */
export type MultiResult = { destinations: Destination[]; primaryIndex: number };

export function toResult(sel: MultiSelection): MultiResult | null {
  const index = primaryIndex(sel);
  return index < 0 ? null : { destinations: sel.items, primaryIndex: index };
}

/** Destinations already filed: shown as chips, but they can't be removed or made primary from the picker. */
export function isLocked(locked: Destination[] | undefined, dest: Destination): boolean {
  const key = destinationKey(dest);
  return !!locked?.some((d) => destinationKey(d) === key);
}
