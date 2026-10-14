export type LocatableItem = {
  id: string;
  title: string;
  parentFolderId: string | null;
  iconEmoji?: string | null;
  folderType?: string | null;
};
export type LocatableScope = { id: string; label: string; items: LocatableItem[] };

export type LocationFolder = {
  id: string;
  title: string;
  iconEmoji?: string | null;
  folderType?: string | null;
  /** A project or offering row of the Projects and Education spaces. */
  synthetic?: boolean;
};

export function crumbsFor(
  items: LocatableItem[],
  folderId: string | null,
  syntheticRoots = false,
): LocationFolder[] {
  const byId = new Map(items.map((it) => [it.id, it]));
  const chain: LocationFolder[] = [];
  let cursor = folderId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = byId.get(cursor);
    if (!node) break;
    chain.unshift({
      id: node.id,
      title: node.title || "Untitled",
      ...(node.iconEmoji ? { iconEmoji: node.iconEmoji } : {}),
      ...(node.folderType ? { folderType: node.folderType } : {}),
      ...(syntheticRoots && node.parentFolderId === null ? { synthetic: true } : {}),
    });
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
  folders: LocationFolder[];
  /** `Space › Folder › …`, for search text and tooltips. */
  path: string;
};

export function locationOf(scope: LocatableScope, parentFolderId: string | null): ItemLocation {
  const folders = crumbsFor(scope.items, parentFolderId, scope.id === "projects" || scope.id === "education");
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
