import type { AudienceKind } from "~/lib/page-audience";
import type { ShortcutTargetType } from "~/lib/shortcut-targets";

export const CORAL_FOLDER = "text-accent-coral/80";
const TEAL_FOLDER = "text-accent-teal/80";
const MUTED_FOLDER = "text-muted-foreground";

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

export type PlainGlyphSource = {
  type: "folder" | "doc" | "file" | "form" | "agreement" | "rubric";
  iconEmoji?: string | null;
  folderType?: string | null;
  audience?: { kind: AudienceKind } | null;
  isWhiteboard?: boolean;
  isNotebook?: boolean;
  tabCount?: number;
};

export type ShortcutGlyphSource = {
  type: "shortcut";
  targetType: ShortcutTargetType;
  /** False when the viewer can't open the original. */
  canOpen?: boolean;
  originalInTrash?: boolean;
};

export type GlyphSource = PlainGlyphSource | ShortcutGlyphSource;

export type ItemGlyph =
  | { kind: "emoji"; emoji: string }
  | { kind: "folder"; tint: string; mark: "calendar" | "tag" | null }
  | { kind: "notebook"; tabs: string | null }
  | { kind: "whiteboard" }
  | { kind: "doc" }
  | { kind: "file" }
  | { kind: "form" }
  | { kind: "agreement" }
  | { kind: "rubric" }
  | { kind: "shortcut"; target: ItemGlyph; locked: boolean };

export function pickGlyph(item: GlyphSource): ItemGlyph {
  if (item.type === "shortcut") {
    return {
      kind: "shortcut",
      target: pickShortcutTarget(item.targetType),
      locked: item.canOpen === false && !item.originalInTrash,
    };
  }
  if (item.type === "doc" && item.isNotebook) return { kind: "notebook", tabs: tabBadge(item.tabCount) };
  if (item.type === "folder" || item.type === "doc") {
    if (item.iconEmoji) return { kind: "emoji", emoji: item.iconEmoji };
  }
  switch (item.type) {
    case "folder": {
      const type = item.folderType;
      const mark = type === "Meetings" ? "calendar" : type && type !== "Root" ? "tag" : null;
      return { kind: "folder", tint: folderTintClass(item.audience), mark };
    }
    case "doc":
      return item.isWhiteboard ? { kind: "whiteboard" } : { kind: "doc" };
    default:
      return { kind: item.type };
  }
}

function pickShortcutTarget(targetType: ShortcutTargetType): ItemGlyph {
  switch (targetType) {
    case "folder":
      return pickGlyph({ type: "folder" });
    case "notebook":
      return pickGlyph({ type: "doc", isNotebook: true });
    case "whiteboard":
      return pickGlyph({ type: "doc", isWhiteboard: true });
    case "doc":
      return pickGlyph({ type: "doc" });
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

const SHORTCUT_TARGET_NOUN: Partial<Record<ItemGlyph["kind"], string>> = {
  folder: "a folder",
  notebook: "a notebook",
  whiteboard: "a whiteboard",
};

/** Hover text for a row glyph: what the item is and, for folders, who can see it. */
export function glyphLabel(
  glyph: ItemGlyph,
  ctx: {
    audienceLabel?: string | null;
    tabCount?: number;
    originalInTrash?: boolean;
    /** The item's own type; only needed to name an emoji glyph, which hides it. */
    itemType?: string;
  } = {},
): string {
  const folder = (name: string) => (ctx.audienceLabel ? `${name} · ${ctx.audienceLabel}` : name);
  switch (glyph.kind) {
    case "emoji":
      return ctx.itemType === "folder" ? folder("Folder") : "Document";
    case "folder":
      return folder(glyph.mark === "calendar" ? "Meetings folder · new notebooks file here" : "Folder");
    case "notebook": {
      const tabs = ctx.tabCount ?? 0;
      return `Notebook · ${tabs < 1 ? "no tabs" : `${tabs} ${tabs === 1 ? "tab" : "tabs"}`}`;
    }
    case "shortcut": {
      const label = `Shortcut to ${SHORTCUT_TARGET_NOUN[glyph.target.kind] ?? "a document"}`;
      if (ctx.originalInTrash) return `${label} · original in trash`;
      return glyph.locked ? `${label} · you can't open the original` : label;
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
