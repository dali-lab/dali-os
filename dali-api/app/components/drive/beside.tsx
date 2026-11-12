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

import { createContext, useContext } from "react";
import { useDroppable } from "@dnd-kit/core";
import { PanelRight } from "lucide-react";
import type { DriveItem } from "~/drive/lib/drive.server";
import { Menu, Tooltip } from "~/components/ui/floating";
import { sidePanelForUrl } from "~/lib/side-panel";
import { isGroupScope } from "./item-icons";

/** A drive as a drop target: dropping items on it re-scopes them. Shared by the columns, the list and the grid. */
export function useScopeDrop(scopeId: string, dragging: boolean) {
  return useDroppable({
    id: `scopedrop::${scopeId}`,
    data: { destScopeId: scopeId },
    disabled: !dragging || isGroupScope(scopeId),
  });
}

export type BesideState = { open: ((item: DriveItem) => void) | null; activeId: string | null };

export const BesideContext = createContext<BesideState>({ open: null, activeId: null });

export function besideTarget(item: DriveItem) {
  return item.type === "doc" ? sidePanelForUrl(item.href) : null;
}

/** How a row opens beside: an opener when it can, and whether it is the document showing in the panel now. */
export function useBeside(item: DriveItem) {
  const { open, activeId } = useContext(BesideContext);
  const target = open ? besideTarget(item) : null;
  return { openBeside: target && open ? () => open(item) : null, active: !!target && activeId === target.id };
}

export function BesideMark({ item }: { item: DriveItem }) {
  const { active } = useBeside(item);
  if (!active) return null;
  return <span className="shrink-0 rounded-full bg-os-container px-2 py-0.5 text-xs font-medium text-os-accent">Open beside</span>;
}

export function OpenBesideButton({ item }: { item: DriveItem }) {
  const { openBeside } = useBeside(item);
  if (!openBeside) return null;
  return (
    <Tooltip content="Open to the side · ⌥ click">
      <button
        type="button"
        aria-label="Open to the side"
        data-testid={`drive-item-beside-${item.id}`}
        onClick={(e) => {
          e.stopPropagation();
          openBeside();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted/60 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
      >
        <PanelRight className="h-4 w-4" />
      </button>
    </Tooltip>
  );
}

export function OpenBesideMenuItem({ item }: { item: DriveItem }) {
  const { openBeside } = useBeside(item);
  if (!openBeside) return null;
  return (
    <Menu.Item icon={<PanelRight className="h-3.5 w-3.5" />} shortcut="⌥ click" onSelect={openBeside}>
      Open to the side
    </Menu.Item>
  );
}
