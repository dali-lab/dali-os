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
import { Handshake, MoreHorizontal, Pencil, Trash2, Download, FolderInput, Star, FolderOpen, Share2, SlidersHorizontal } from "lucide-react";
import type { DriveItem } from "~/drive/lib/drive.server";
import { Menu } from "~/components/ui/floating";
import { menuEntries, type MenuEntry } from "~/components/drive/item-menu";
import { isPageFolder } from "~/components/drive/receiver-options";
import { OpenBesideButton, OpenBesideMenuItem } from "./beside";
import type { RowActions } from "./row-types";

// Menu.Item nodes shared by the row "⋯" dropdown and the right-click menu.
export function itemMenuItems(
  item: DriveItem,
  actions: RowActions,
  onOpen: () => void,
  onToggleFavorite?: (item: DriveItem) => void,
  onTogglePartnerVisible?: (item: DriveItem, next: boolean) => void,
): ReactNode {
  const entries = menuEntries(item, {
    share: !!actions.onShare,
    favorite: !!onToggleFavorite,
    partner: !!onTogglePartnerVisible,
    readOnly: !!actions.readOnly,
  });
  const has = (entry: MenuEntry) => entries.includes(entry);
  const canRename = has("rename");
  const canMove = has("move");
  const canDelete = has("delete");
  const canFavorite = has("favorite");
  const canShare = has("share");
  const canTogglePartner = has("partner");
  // Partner visibility toggle: applies to docs and files in project-scoped Drive.
  // partnerVisible lives on the doc/file variant — access it via cast to avoid
  // widening the union type unnecessarily.
  const itemPartnerVisible = (item as { partnerVisible?: boolean | null }).partnerVisible ?? false;
  if (entries.length === 1 && canDelete) {
    return (
      <Menu.Item icon={<Trash2 className="h-3.5 w-3.5" />} onSelect={() => actions.onDelete(item)}>
        Delete
      </Menu.Item>
    );
  }
  return (
    <>
      <Menu.Item icon={<FolderOpen className="h-3.5 w-3.5" />} onSelect={onOpen}>
        Open
      </Menu.Item>
      <OpenBesideMenuItem item={item} />
      {has("download") && actions.onDownload && (
        <Menu.Item icon={<Download className="h-3.5 w-3.5" />} onSelect={() => actions.onDownload!(item)}>
          Download
        </Menu.Item>
      )}
      {canFavorite && onToggleFavorite && (
        <Menu.Item
          icon={<Star className={`h-3.5 w-3.5 ${item.favorited ? "fill-current text-os-accent" : ""}`} />}
          onSelect={() => onToggleFavorite(item)}
        >
          {item.favorited ? "Remove from favorites" : "Add to favorites"}
        </Menu.Item>
      )}
      {canShare && (
        <Menu.Item icon={<Share2 className="h-3.5 w-3.5" />} onSelect={() => actions.onShare!(item)}>
          Share…
        </Menu.Item>
      )}
      {canTogglePartner && (
        <Menu.Item
          icon={<Handshake className={`h-3.5 w-3.5 ${itemPartnerVisible ? "text-accent-teal" : ""}`} />}
          onSelect={() => onTogglePartnerVisible!(item, !itemPartnerVisible)}
        >
          {itemPartnerVisible ? "Stop sharing with partner" : "Share with partner"}
        </Menu.Item>
      )}
      {item.type === "folder" && isPageFolder(item) && actions.onFolderSettings && actions.canFolderSettings?.(item) && (
        <Menu.Item icon={<SlidersHorizontal className="h-3.5 w-3.5" />} onSelect={() => actions.onFolderSettings!(item)}>
          Folder settings…
        </Menu.Item>
      )}
      {(canRename || canMove) && <Menu.Separator />}
      {canRename && (
        <Menu.Item icon={<Pencil className="h-3.5 w-3.5" />} onSelect={() => actions.onRename(item)}>
          Rename
        </Menu.Item>
      )}
      {canMove && (
        <Menu.Item icon={<FolderInput className="h-3.5 w-3.5" />} onSelect={() => actions.onRequestMove(item)}>
          Move to…
        </Menu.Item>
      )}
      {canDelete && (
        <>
          <Menu.Separator />
          <Menu.Item icon={<Trash2 className="h-3.5 w-3.5" />} onSelect={() => actions.onDelete(item)}>
            Delete
          </Menu.Item>
        </>
      )}
    </>
  );
}

export function RowActionsMenu({
  item,
  actions,
  onOpen,
  onToggleFavorite,
  onTogglePartnerVisible,
}: {
  item: DriveItem;
  actions: RowActions;
  onOpen: () => void;
  onToggleFavorite?: (item: DriveItem) => void;
  onTogglePartnerVisible?: (item: DriveItem, next: boolean) => void;
}) {
  return (
    <>
    <OpenBesideButton item={item} />
    <Menu
      align="right"
      ariaLabel="Item actions"
      trigger={
        <button
          type="button"
          data-testid={`drive-item-actions-${item.id}`}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted/60 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      }
    >
      {itemMenuItems(item, actions, onOpen, onToggleFavorite, onTogglePartnerVisible)}
    </Menu>
    </>
  );
}
