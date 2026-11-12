export const ROOT_DELETE_ERROR = "This is a Drive root and can't be deleted";
export const ROOT_MOVE_ERROR = "Drive roots can't be moved";
export const ROOT_SCOPE_ERROR = "A Drive root stays shared with a group that includes Core";
export const ROOT_PUBLIC_ERROR = "A Drive root can't be shared publicly";

export const SYSTEM_FOLDER_MOVE_ERROR = "System folders stay in their drive";

export type RootRef = { id: string; title: string };

/** The nearest Root in a chain (starting page first, then its ancestors), or null. */
export function nearestRoot(
  chain: ReadonlyArray<{ id: string; title?: string | null; folderType?: string | null }>,
): RootRef | null {
  const hit = chain.find((p) => p.folderType === "Root");
  return hit ? { id: hit.id, title: hit.title || "Drive" } : null;
}

/** Anything filed under a typed root stays under that same root. */
export function rootBoundMoveError(from: RootRef | null, to: RootRef | null): string | null {
  if (!from || from.id === to?.id) return null;
  return `${from.title} items stay in ${from.title}`;
}

export function isRoot(page: { folderType?: string | null }): boolean {
  return page.folderType === "Root";
}

/** Spread into a trash update so an archived folder stops being a receiver and a restore returns a plain folder. */
export const CLEARED_FOLDER_TYPE = { folderType: null, processType: null, processId: null } as const;
