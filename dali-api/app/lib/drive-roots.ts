export const ROOT_DELETE_ERROR = "This is a Drive root and can't be deleted";
export const ROOT_MOVE_ERROR = "Drive roots can't be moved";
export const ROOT_SCOPE_ERROR = "A Drive root stays shared with a group that includes Core";
export const ROOT_PUBLIC_ERROR = "A Drive root can't be shared publicly";

export function isRoot(page: { folderType?: string | null }): boolean {
  return page.folderType === "Root";
}
