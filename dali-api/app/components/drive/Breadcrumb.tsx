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

import { useDroppable } from "@dnd-kit/core";
import { ChevronRight, MoreHorizontal, HardDrive } from "lucide-react";
import type { DriveTreeScope } from "~/drive/lib/drive-scopes.server";
import { Menu } from "~/components/ui/floating";
import { collapseMiddle } from "~/lib/collapse-middle";
import { DROP_RING } from "./drop-zone";
import { scopeLabel } from "./item-icons";

export function Breadcrumb({
  currentScope,
  folderCrumbs,
  onNavigate,
  dragging,
  showRoot,
}: {
  currentScope: DriveTreeScope | null;
  folderCrumbs: { id: string; title: string }[];
  onNavigate: (scopeId: string | null, folderId: string | null) => void;
  dragging: boolean;
  /** The trail starts at "Drive", which goes back to the list of drives (not in an embedded project tab). */
  showRoot: boolean;
}) {
  // The trail is always mounted at a constant height: appearing/disappearing as
  // you enter and leave a folder was the top source of vertical layout shift
  // (content below jumped by a row + gap). The row now holds its height even at
  // a drive root, where the scope crumb ("My Drive" / "Lab" / the project name)
  // stands in as a stable "you are here" — matching Google Drive, whose
  // breadcrumb is always present.
  const { hidden, tail } = collapseMiddle(folderCrumbs, 0, 2);
  const collapse = hidden.length > 0;
  const shown = collapse ? tail : folderCrumbs;

  return (
    <nav
      aria-label="Breadcrumb"
      data-testid="drive-breadcrumb"
      className="flex flex-wrap items-center gap-2 min-w-0 min-h-[1.75rem] text-base"
    >
      {showRoot && (
        <button
          type="button"
          data-testid="drive-crumb-root"
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(null, null);
          }}
          className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-muted/50 ${
            currentScope ? "text-muted-foreground hover:text-foreground" : "font-medium text-foreground"
          }`}
        >
          <HardDrive className="w-4 h-4 text-os-accent" />
          Drive
        </button>
      )}
      {/* The scope crumb leads the trail and is now always shown while a scope
          is active — at a drive root it is the constant "you are here" that
          keeps this row from collapsing (and shifting the page) as you move in
          and out of folders. */}
      {currentScope && (
        <Crumb
          label={scopeLabel(currentScope)}
          testid="drive-crumb-scope"
          scopeId={currentScope.id}
          destFolderId={null}
          onNavigate={() => onNavigate(currentScope.id, null)}
          dragging={dragging}
          first={!showRoot}
          current={folderCrumbs.length === 0}
        />
      )}
      {collapse && (
        <>
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <Menu
            align="left"
            ariaLabel="Hidden path segments"
            trigger={
              <button
                type="button"
                aria-label="Show hidden path segments"
                className="rounded px-1 py-0.5 text-muted-foreground hover:bg-muted/50"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
            }
          >
            {hidden.map((c) => (
              <Menu.Item key={c.id} onSelect={() => onNavigate(currentScope!.id, c.id)}>
                {c.title}
              </Menu.Item>
            ))}
          </Menu>
        </>
      )}
      {shown.map((c, i) => (
        <Crumb
          key={c.id}
          label={c.title}
          testid={`drive-crumb-${c.id}`}
          scopeId={currentScope!.id}
          destFolderId={c.id}
          onNavigate={() => onNavigate(currentScope!.id, c.id)}
          dragging={dragging}
          current={i === shown.length - 1}
        />
      ))}
    </nav>
  );
}

export function Crumb({
  label,
  testid,
  scopeId,
  destFolderId,
  onNavigate,
  dragging,
  first = false,
  current = false,
}: {
  label: string;
  testid: string;
  scopeId: string;
  destFolderId: string | null;
  onNavigate: () => void;
  dragging: boolean;
  /** Leads the trail (no root crumb before it), so it takes no separator. */
  first?: boolean;
  /** Ends the trail — where you are, so it carries the full ink. */
  current?: boolean;
}) {
  const drop = useDroppable({
    id: `crumb::${scopeId}::${destFolderId ?? "_root_"}`,
    data: { destFolderId, destScopeId: scopeId },
    disabled: !dragging,
  });
  return (
    <>
      {!first && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
      <button
        type="button"
        ref={drop.setNodeRef}
        data-testid={testid}
        onClick={(e) => {
          e.stopPropagation();
          onNavigate();
        }}
        className={`inline-flex items-center rounded-md px-1.5 py-0.5 truncate max-w-[12rem] ${
          drop.isOver
            ? `${DROP_RING} text-os-accent`
            : current
              ? "font-medium text-foreground hover:bg-os-hover"
              : "text-muted-foreground hover:bg-os-hover hover:text-foreground"
        }`}
      >
        {label}
      </button>
    </>
  );
}

// ── Root: the list of drives (list/grid view only) ───────────────────────────
