import type { AudienceKind } from "~/lib/page-audience";
import { RECEIVER_LABELS, type ReceiverFolderType } from "~/lib/drive-receivers";

export const CORAL_FOLDER = "text-accent-coral/80";
const TEAL_FOLDER = "text-accent-teal/80";
const MUTED_FOLDER = "text-muted-foreground";
export const PINK_FOLDER = "text-accent-pink";

/** Folder color follows who can see it; no audience (synthetic folders) keeps the default. */
export function folderTintClass(audience?: { kind: AudienceKind } | null): string {
  switch (audience?.kind) {
    case "private":
      return MUTED_FOLDER;
    case "lab":
    case "public":
      return TEAL_FOLDER;
    default:
      return CORAL_FOLDER;
  }
}

export type GlyphSource = {
  type: "folder" | "doc" | "file" | "form" | "agreement" | "rubric";
  iconEmoji?: string | null;
  folderType?: string | null;
  audience?: { kind: AudienceKind } | null;
  isWhiteboard?: boolean;
  isNotebook?: boolean;
  tabCount?: number;
};

export type ItemGlyph =
  | { kind: "emoji"; emoji: string }
  | { kind: "folder"; tint: string; mark: "calendar" | null; system: boolean; folderType: string | null }
  | { kind: "notebook"; tabs: string | null }
  | { kind: "whiteboard" }
  | { kind: "doc" }
  | { kind: "file" }
  | { kind: "form" }
  | { kind: "agreement" }
  | { kind: "rubric" };

export function pickGlyph(item: GlyphSource): ItemGlyph {
  if (item.type === "doc" && item.isNotebook) return { kind: "notebook", tabs: tabBadge(item.tabCount) };
  if (item.type === "folder" || item.type === "doc") {
    if (item.iconEmoji) return { kind: "emoji", emoji: item.iconEmoji };
  }
  switch (item.type) {
    case "folder": {
      const type = item.folderType ?? null;
      if (type) return { kind: "folder", tint: PINK_FOLDER, mark: type === "Meetings" ? "calendar" : null, system: true, folderType: type };
      return { kind: "folder", tint: folderTintClass(item.audience), mark: null, system: false, folderType: null };
    }
    case "doc":
      return item.isWhiteboard ? { kind: "whiteboard" } : { kind: "doc" };
    default:
      return { kind: item.type };
  }
}

/** Tab count for the notebook glyph's badge; nothing for a notebook with no tabs. */
export function tabBadge(tabCount?: number): string | null {
  if (!tabCount || tabCount < 1) return null;
  return tabCount > 99 ? "99+" : String(tabCount);
}

/** Muted caption after a folder's name. */
export function folderCountLabel(itemCount?: number): string | null {
  if (itemCount === undefined) return null;
  if (itemCount === 0) return "Empty";
  return itemCount === 1 ? "1 item" : `${itemCount} items`;
}

function systemFolderName(glyph: Extract<ItemGlyph, { kind: "folder" }>, title?: string): string {
  const type = glyph.folderType;
  if (!type) return "Folder";
  if (type === "Meetings") return "Meetings folder · new notebooks file here";
  if (type === "Root") return title ? `${title} drive` : "Drive";
  const label = RECEIVER_LABELS[type as ReceiverFolderType];
  return label ? `${label} folder` : "Folder";
}

/** Hover text for a row glyph: what the item is and, for folders, who can see it. */
export function glyphLabel(
  glyph: ItemGlyph,
  ctx: {
    audienceLabel?: string | null;
    tabCount?: number;
    /** The item's own type; only needed to name an emoji glyph, which hides it. */
    itemType?: string;
    /** The item's title; names a drive root's hover text. */
    title?: string;
  } = {},
): string {
  const folder = (name: string) => (ctx.audienceLabel ? `${name} · ${ctx.audienceLabel}` : name);
  switch (glyph.kind) {
    case "emoji":
      return ctx.itemType === "folder" ? folder("Folder") : "Document";
    case "folder":
      return folder(systemFolderName(glyph, ctx.title));
    case "notebook": {
      const tabs = ctx.tabCount ?? 0;
      return `Notebook · ${tabs < 1 ? "no tabs" : `${tabs} ${tabs === 1 ? "tab" : "tabs"}`}`;
    }
    case "whiteboard":
      return "Whiteboard";
    case "doc":
      return "Document";
    case "file":
      return "File";
    case "form":
      return "Form";
    case "agreement":
      return "Agreement";
    case "rubric":
      return "Rubric";
  }
}
