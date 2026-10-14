import type { DriveItem } from "~/lib/drive.server";

export type MenuEntry =
  | "open"
  | "favorite"
  | "share"
  | "partner"
  | "rename"
  | "move"
  | "file-in"
  | "add-shortcut"
  | "delete";

/** Which actions a row's menu offers, in order. The menu renders exactly these. */
export function menuEntries(
  item: DriveItem,
  caps: { share: boolean; fileIn: boolean; favorite: boolean; partner: boolean; readOnly?: boolean },
): MenuEntry[] {
  // A shortcut the viewer can't open has nothing to do but go.
  if (item.type === "shortcut" && !item.canOpen) return ["delete"];
  const isPage = item.type === "doc" || item.type === "folder";
  const entries: MenuEntry[] = ["open"];
  if ((isPage || item.type === "form") && caps.favorite) entries.push("favorite");
  if (isPage && caps.share) entries.push("share");
  if ((item.type === "doc" || item.type === "file") && caps.partner) entries.push("partner");
  if (!caps.readOnly && (isPage || item.type === "file" || item.type === "form" || item.type === "agreement")) {
    entries.push("rename");
  }
  if (!caps.readOnly && item.type !== "agreement" && item.type !== "rubric") entries.push("move");
  if (caps.fileIn) entries.push("file-in", "add-shortcut");
  if (!caps.readOnly && (isPage || item.type === "file" || item.type === "form" || item.type === "shortcut")) {
    entries.push("delete");
  }
  return entries;
}
