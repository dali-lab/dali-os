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



export function useDriveText() {
  return {
    /** Font size for a browser row (.drivepage-node / .drive-file-name: 14px).
     *  A step below the shell's own rows on purpose — a column pane is 200px
     *  wide, and the nav's 16px truncates a filename that reads fine here. */
    row: "text-sm",
    /** Padding + gap shared by list and column item rows so the two views keep
     *  the same line spacing (.drivepage-node: 9px 10px, 10px gap). */
    itemRow: "gap-2.5 px-2.5 py-2",
    /** Secondary metadata beside a row — modified, size, path, kind (12px). */
    meta: "text-xs",
    /** Column headers and other all-caps micro-labels (11px). */
    label: "text-[11px]",
    /** The "Core only" / "Project" row badges. */
    badge: "text-[10px]",
  };
}
