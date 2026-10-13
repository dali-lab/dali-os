export type LocatableItem = { id: string; title: string; parentFolderId: string | null };
export type LocatableScope = { id: string; label: string; items: LocatableItem[] };

export function crumbsFor(
  items: LocatableItem[],
  folderId: string | null,
): { id: string; title: string }[] {
  const byId = new Map(items.map((it) => [it.id, it]));
  const chain: { id: string; title: string }[] = [];
  let cursor = folderId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = byId.get(cursor);
    if (!node) break;
    chain.unshift({ id: node.id, title: node.title || "Untitled" });
    cursor = node.parentFolderId;
  }
  return chain;
}

export type ItemLocation = {
  scopeId: string;
  scopeLabel: string;
  /** The folder the item sits in; null when it sits at the space's top level. */
  folderId: string | null;
  /** Viewable ancestors from the space down to the containing folder. */
  folders: { id: string; title: string }[];
  /** `Space › Folder › …`, for search text and tooltips. */
  path: string;
};

export function locationOf(scope: LocatableScope, parentFolderId: string | null): ItemLocation {
  const folders = crumbsFor(scope.items, parentFolderId);
  return {
    scopeId: scope.id,
    scopeLabel: scope.label,
    folderId: folders.length ? folders[folders.length - 1].id : null,
    folders,
    path: [scope.label, ...folders.map((c) => c.title)].join(" › "),
  };
}

/** Where a folder lives, for items (the Trash) that only know their parent's id. */
export function locateFolder(scopes: LocatableScope[], folderId: string | null): ItemLocation | null {
  if (!folderId) return null;
  const scope = scopes.find((s) => s.items.some((i) => i.id === folderId));
  return scope ? locationOf(scope, folderId) : null;
}

/** Where an item lives, when the space holding it is loaded. */
export function locateItem(scopes: LocatableScope[], item: LocatableItem): ItemLocation | null {
  const scope = scopes.find((s) => s.items.some((i) => i.id === item.id));
  return scope ? locationOf(scope, item.parentFolderId) : null;
}
