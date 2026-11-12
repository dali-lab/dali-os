// DriveBrowser — the unified Drive's browser, in three views over one model.
//
// VIEWS: Miller columns (the default, Finder-style), list and grid. Search
//   results are a flat list. All of them share one interaction model: a plain
//   click selects, cmd/ctrl-click toggles, shift-click extends, a rubber-band
//   drag selects, a double-click opens (a folder is entered), and one keyboard
//   handler drives every view.
//
// Also here: type filter, search, drag-and-drop internal move, drag-to-upload,
//   favorites, rename, move, delete, bulk actions, context menu, breadcrumb, sort.

import { type ReactNode } from "react";
import { ClipboardList, FileSignature, FileText, Presentation, Shapes, ClipboardCheck, NotebookPen } from "lucide-react";
import type { DriveItem } from "~/drive/lib/drive.server";
import { categorize } from "~/lib/file-type";
import { iconForCategory } from "~/lib/file-icon";
import type { DriveTreeScope } from "~/drive/lib/drive-scopes.server";
import { Tooltip } from "~/components/ui/floating";
import { scopeIconFor } from "~/components/drive/scope-icon";
import { driveScopeLabel } from "~/components/drive/location";
import { CORAL_FOLDER, glyphLabel, pickGlyph, type ItemGlyph } from "~/components/drive/glyphs";
import { FolderGlyph, GlyphBadge } from "~/components/drive/FolderGlyph";


export type IconSize = "sm" | "lg" | "xl";

export function itemIcon(item: DriveItem, size: IconSize = "sm") {
  return glyphIcon(pickGlyph(item), item, size);
}

export function glyphIcon(glyph: ItemGlyph, item: DriveItem, size: IconSize): ReactNode {
  const cls = size === "xl" ? "w-10 h-10" : size === "lg" ? "w-8 h-8" : "w-4 h-4";
  const markCls = size === "xl" ? "w-3.5 h-3.5" : size === "lg" ? "w-3 h-3" : "w-2.5 h-2.5";
  const emojiCls = `${cls} flex items-center justify-center leading-none shrink-0 ${
    size === "xl" ? "text-3xl" : size === "lg" ? "text-2xl" : "text-sm"
  }`;
  switch (glyph.kind) {
    case "emoji":
      return <span className={emojiCls}>{glyph.emoji}</span>;
    case "folder":
      return <FolderGlyph glyph={glyph} className={cls} markClassName={markCls} />;
    case "notebook": {
      const notebook = <NotebookPen className={`${cls} ${CORAL_FOLDER} shrink-0`} />;
      if (!glyph.tabs) return notebook;
      return (
        <GlyphBadge
          badge={
            <span
              data-testid="notebook-tab-count"
              className={`min-w-3.5 px-0.5 text-center font-semibold leading-3.5 tabular-nums text-muted-foreground ${
                size === "sm" ? "text-[9px]" : "text-[10px]"
              }`}
            >
              {glyph.tabs}
            </span>
          }
        >
          {notebook}
        </GlyphBadge>
      );
    }
    case "file": {
      const Icon = iconForCategory(categorize({ fileName: item.title || "" }));
      return <Icon className={`${cls} text-muted-foreground shrink-0`} />;
    }
    case "form":
      return <ClipboardList className={`${cls} text-muted-foreground shrink-0`} />;
    case "agreement":
      return <FileSignature className={`${cls} text-muted-foreground shrink-0`} />;
    case "rubric":
      return <ClipboardCheck className={`${cls} text-muted-foreground shrink-0`} />;
    case "whiteboard":
      return <Shapes className={`${cls} text-muted-foreground shrink-0`} />;
    case "slides":
      return <Presentation className={`${cls} text-muted-foreground shrink-0`} />;
    case "doc":
      return <FileText className={`${cls} text-muted-foreground shrink-0`} />;
  }
}

/** The row glyph with a hover label saying what the item is and who can see it. */
export function ItemGlyphTip({ item, size }: { item: DriveItem; size?: IconSize }) {
  const label = glyphLabel(pickGlyph(item), {
    audienceLabel: "audience" in item ? item.audience?.label : undefined,
    tabCount: item.type === "doc" ? item.tabCount : undefined,
    itemType: item.type,
    title: item.title,
  });
  return (
    <Tooltip content={label} variant="label" placement="top">
      <span aria-hidden data-testid="item-glyph" className="inline-flex shrink-0">
        {itemIcon(item, size)}
      </span>
    </Tooltip>
  );
}

export function scopeIcon(scope: DriveTreeScope, size: IconSize = "sm") {
  return scopeIconFor(scope, size);
}

export function scopeLabel(scope: DriveTreeScope): string {
  return driveScopeLabel(scope);
}

/** The synthetic "projects" / "education" headers: dropping on one is ambiguous (which project?), so only the projects inside take drops. */
export function isGroupScope(scopeId: string): boolean {
  return scopeId === "projects" || scopeId === "education";
}
