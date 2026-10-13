import type { PageKind } from "~/generated/prisma/client";

export type ShortcutTargetType = "doc" | "folder" | "whiteboard" | "notebook";

export const NO_ACCESS_SHORTCUT_TITLE = "Shortcut (no access)";

export function shortcutTargetType(kind: PageKind): ShortcutTargetType {
  switch (kind) {
    case "Folder":
      return "folder";
    case "Whiteboard":
      return "whiteboard";
    case "Notebook":
      return "notebook";
    default:
      return "doc";
  }
}

export function shortcutTargetHref(kind: PageKind, targetId: string): string {
  return kind === "Whiteboard" ? `/whiteboard/${targetId}` : `/documents/${targetId}`;
}
