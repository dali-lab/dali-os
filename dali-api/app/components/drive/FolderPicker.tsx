import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Folder, Search, X } from "lucide-react";
import { FolderGlyph } from "~/components/drive/FolderGlyph";
import { PINK_FOLDER } from "~/components/drive/glyphs";
import { Modal, ModalHeader } from "~/components/Modal";
import { buttonClasses } from "~/components/ui/Button";
import { modalCardClass } from "~/components/os-chrome";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { DriveScopeIcon } from "~/components/drive/scope-icon";
import { isSyntheticFolder } from "~/components/drive/picker-rows";

// The one folder picker: a hybrid of type-to-filter search and drill-in
// browsing (Google Drive / Notion model), used wherever something is moved or
// filed. It is data-source agnostic: callers pass a normalised flat `folders`
// list (each carrying its `driveId` + `parentId`, where `parentId === null`
// means the drive's top level) plus the `drives` themselves. Rows come from
// `buildPickerRows`: the Drive hub feeds it from its loader, every other
// surface from `useDriveDestinations()`.

export type PickerDrive = {
  id: string;
  label: string;
  iconEmoji?: string | null;
  /** Who can see this drive, e.g. "Core only". Shown under the drive's name so
   *  a move that changes an item's audience says so before you commit to it. */
  audience?: string | null;
  /** The page a drive's top level maps to in the database (the root folder of
   *  Core, Hiring and Mentorship); null for drives whose top level is a bare
   *  workspace. */
  rootFolderId?: string | null;
};

export type PickerFolder = {
  id: string;
  driveId: string;
  /** Parent folder id; null when the folder sits at the drive's top level. */
  parentId: string | null;
  title: string;
  iconEmoji?: string | null;
  /** How many items the folder holds. Shown under its name — a bare list of
   *  folder names says nothing about which one you want, and two folders can
   *  share a title (the Lab drive has two called "Meeting notes"). Omit when
   *  the caller can't count cheaply; the row just loses its subtitle. */
  itemCount?: number;
  /** The folder's `FolderType` (e.g. "Meetings"); null for a plain folder. */
  folderType?: string | null;
};

export type Destination = { driveId: string; folderId: string | null };

function destKey(d: Destination): string {
  return `${d.driveId}\0${d.folderId ?? ""}`;
}

export type Row = { section?: string } & (
  | { kind: "drive"; key: string; driveId: string; label: string; emoji?: string | null; note?: string | null; dest: Destination }
  | { kind: "container"; key: string; label: string; dest: Destination; disabled: boolean }
  | {
      kind: "folder";
      key: string;
      label: string;
      emoji?: string | null;
      note?: string | null;
      dest: Destination;
      hasChildren: boolean;
      disabled: boolean;
      preferred: boolean;
      glyph: FolderGlyphKind;
    }
  | {
      kind: "result";
      key: string;
      label: string;
      path: string;
      dest: Destination;
      disabled: boolean;
      preferred: boolean;
      glyph: FolderGlyphKind;
    }
);

export type FolderGlyphKind = "folder" | "system" | "meetings";

export function folderGlyph(folderType: string | null | undefined, synthetic = false): FolderGlyphKind {
  if (!folderType) return synthetic ? "system" : "folder";
  return folderType === "Meetings" ? "meetings" : "system";
}

export function isPreferred(
  folderType: string | null | undefined,
  preferFolderType: string | null | undefined,
): boolean {
  return !!preferFolderType && folderType === preferFolderType;
}

/** Moves preferred rows ahead of the rest, keeping each group's order. */
export function preferFirst<T extends object>(rows: T[]): T[] {
  const preferred = (r: T) => "preferred" in r && r.preferred === true;
  return [...rows.filter(preferred), ...rows.filter((r) => !preferred(r))];
}

export const RECENT_DEST_KEY = "dali_drive_recent_dest";
export const RECENT_DEST_MAX = 5;

/** Puts `dest` first, drops its earlier occurrence, keeps the newest five. */
export function rememberDestination(list: Destination[], dest: Destination): Destination[] {
  return [dest, ...list.filter((d) => destKey(d) !== destKey(dest))].slice(0, RECENT_DEST_MAX);
}

export function readRecentDestinations(): Destination[] {
  try {
    const raw = window.localStorage.getItem(RECENT_DEST_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (d): d is Destination =>
          !!d && typeof d.driveId === "string" && (d.folderId === null || typeof d.folderId === "string"),
      )
      .slice(0, RECENT_DEST_MAX);
  } catch {
    return [];
  }
}

export function writeRecentDestination(dest: Destination): void {
  try {
    window.localStorage.setItem(
      RECENT_DEST_KEY,
      JSON.stringify(rememberDestination(readRecentDestinations(), dest)),
    );
  } catch {
    // Storage blocked or full: recents are a convenience.
  }
}

/** Recents that still exist in the loaded rows, in remembered order. */
export function existingRecents(
  recents: Destination[],
  drives: PickerDrive[],
  folders: PickerFolder[],
): Destination[] {
  const driveIds = new Set(drives.map((d) => d.id));
  const folderIds = new Set(folders.map((f) => f.id));
  return recents.filter((d) => driveIds.has(d.driveId) && (d.folderId === null || folderIds.has(d.folderId)));
}

/** Breadcrumb labels for a destination, e.g. ["Lab", "Design", "26F"]. */
export function destinationPath(
  dest: Destination,
  driveById: Map<string, PickerDrive>,
  folderById: Map<string, PickerFolder>,
): string[] {
  const chain: string[] = [];
  let cur = dest.folderId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const f = folderById.get(cur);
    if (!f) break;
    chain.unshift(f.title || "Untitled folder");
    cur = f.parentId;
  }
  return [driveById.get(dest.driveId)?.label ?? "Drive", ...chain];
}

/** The muted second line under a folder row: why it can't be picked, or what's
 *  inside it. The reason wins — a dimmed row with no explanation reads as a
 *  bug, and "3 items" doesn't tell you why you can't click it. */
export function folderNote(
  itemCount: number | undefined,
  reason: string | null,
): string | null {
  if (reason) return reason;
  if (itemCount === undefined) return null;
  return itemCount === 0 ? "Empty" : `${itemCount} item${itemCount === 1 ? "" : "s"}`;
}

/** `${driveId}\0${parentId ?? ""}` → that folder's children, title-sorted, with
 *  folders of `preferFolderType` first. */
export function indexFoldersByParent(
  folders: PickerFolder[],
  preferFolderType?: string | null,
): Map<string, PickerFolder[]> {
  const m = new Map<string, PickerFolder[]>();
  for (const f of folders) {
    const k = `${f.driveId}\0${f.parentId ?? ""}`;
    const arr = m.get(k);
    if (arr) arr.push(f);
    else m.set(k, [f]);
  }
  const rank = (f: PickerFolder) => (isPreferred(f.folderType, preferFolderType) ? 0 : 1);
  for (const arr of m.values()) arr.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
  return m;
}

/**
 * The rows shown while browsing (not searching): the drive list at the top
 * level, otherwise "put it here" plus the current folder's children.
 *
 * Pure, and exported, so the row content is testable — the component applies
 * `initial` in an effect, which never runs under a static render, so going
 * through the component can only ever reach the drive list.
 */
export function buildBrowseRows({
  cwd,
  drives,
  folders,
  childrenByParent,
  isDisabled,
  disabledReason,
  recents = [],
  preferFolderType,
  intoVerb = "Move into",
}: {
  cwd: { driveId: string | null; folderId: string | null };
  drives: PickerDrive[];
  folders: PickerFolder[];
  childrenByParent: Map<string, PickerFolder[]>;
  isDisabled: (dest: Destination) => boolean;
  disabledReason: (dest: Destination) => string | null;
  /** Destinations to list first at the top level; already filtered to ones that exist. */
  recents?: Destination[];
  preferFolderType?: string | null;
  /** Leads the "put it here" row: `Move into "Design"`. */
  intoVerb?: string;
}): Row[] {
  if (cwd.driveId === null) {
    const driveById = new Map(drives.map((d) => [d.id, d]));
    const folderById = new Map(folders.map((f) => [f.id, f]));
    const hasRecents = recents.length > 0;
    const recentRows: Row[] = recents.map((dest) => {
      const path = destinationPath(dest, driveById, folderById);
      const folder = dest.folderId ? folderById.get(dest.folderId) : undefined;
      return {
        kind: "result",
        key: `recent:${destKey(dest)}`,
        label: path[path.length - 1],
        path: path.join(" / "),
        dest,
        disabled: isDisabled(dest),
        preferred: isPreferred(folder?.folderType, preferFolderType),
        glyph: folderGlyph(folder?.folderType, !!folder && isSyntheticFolder(folder)),
        section: "Recent",
      };
    });
    const driveRows: Row[] = drives.map((d) => ({
      kind: "drive",
      key: `drive:${d.id}`,
      driveId: d.id,
      label: d.label,
      emoji: d.iconEmoji,
      // Which drive you pick is the part of a move that changes who can see
      // the item, so each one says its audience rather than only its name.
      note: d.audience ?? null,
      dest: { driveId: d.id, folderId: null },
      ...(hasRecents ? { section: "All drives" } : {}),
    }));
    return [...recentRows, ...driveRows];
  }
  const drive = drives.find((d) => d.id === cwd.driveId);
  const rows: Row[] = [];
  const containerDest: Destination = { driveId: cwd.driveId, folderId: cwd.folderId };
  const containerLabel = cwd.folderId
    ? `${intoVerb} "${folders.find((f) => f.id === cwd.folderId)?.title || "Untitled folder"}"`
    : `Top level of ${drive?.label ?? "drive"}`;
  rows.push({
    kind: "container",
    key: `container:${destKey(containerDest)}`,
    label: containerLabel,
    dest: containerDest,
    disabled: isDisabled(containerDest),
  });
  const kids = childrenByParent.get(`${cwd.driveId}\0${cwd.folderId ?? ""}`) ?? [];
  for (const f of kids) {
    const dest: Destination = { driveId: cwd.driveId, folderId: f.id };
    rows.push({
      kind: "folder",
      key: `folder:${f.id}`,
      label: f.title || "Untitled folder",
      emoji: f.iconEmoji,
      note: folderNote(f.itemCount, disabledReason(dest)),
      dest,
      hasChildren: childrenByParent.has(`${cwd.driveId}\0${f.id}`),
      disabled: isDisabled(dest),
      preferred: isPreferred(f.folderType, preferFolderType),
      glyph: folderGlyph(f.folderType, isSyntheticFolder(f)),
    });
  }
  return rows;
}

export type FolderPickerProps = {
  open: boolean;
  onClose: () => void;
  heading: string;
  drives: PickerDrive[];
  folders: PickerFolder[];
  /** Folder ids that cannot be chosen (e.g. a moved folder's own subtree). */
  disabledFolderIds?: Set<string>;
  /** A single destination to disable (e.g. the item's current location). */
  disabledDest?: Destination | null;
  /** Where to open the browse view. Defaults to the drive list (or the sole drive). */
  initial?: Destination;
  confirmLabel?: string;
  /** Folders of this `FolderType` sort first and get a glyph (e.g. "Meetings"). */
  preferFolderType?: string | null;
  /** Leads the footer line naming the choice: "Move to: Lab / Design". */
  pendingLabel?: string;
  /** Shown when the list has no rows and nothing is being searched for. */
  emptyText?: string;
  /** Leads the "put it here" row inside a folder: `Move into "Design"`. */
  intoVerb?: string;
  onConfirm: (dest: Destination) => void | Promise<void>;
};

export function FolderPicker(props: FolderPickerProps) {
  const tiles = useFeatureFlag("desktop-tabs");
  const {
    open,
    onClose,
    heading,
    drives,
    folders,
    disabledFolderIds,
    disabledDest,
    initial,
    preferFolderType,
    emptyText = "There's nowhere to move this.",
  } = props;
  const confirmLabel = props.confirmLabel ?? "Move";
  const pendingLabel = props.pendingLabel ?? "Move to:";
  const intoVerb = props.intoVerb ?? "Move into";
  const [query, setQuery] = useState("");
  const [cwd, setCwd] = useState<{ driveId: string | null; folderId: string | null }>({
    driveId: null,
    folderId: null,
  });
  const [pending, setPending] = useState<Destination | null>(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const driveById = useMemo(() => new Map(drives.map((d) => [d.id, d])), [drives]);

  const childrenByParent = useMemo(
    () => indexFoldersByParent(folders, preferFolderType),
    [folders, preferFolderType],
  );
  const [recentRaw, setRecentRaw] = useState<Destination[]>([]);
  const recents = useMemo(() => existingRecents(recentRaw, drives, folders), [recentRaw, drives, folders]);

  const folderById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);

  const pathOf = useCallback(
    (dest: Destination): string[] => destinationPath(dest, driveById, folderById),
    [driveById, folderById],
  );

  const isDisabled = useCallback(
    (dest: Destination): boolean => {
      if (dest.folderId && disabledFolderIds?.has(dest.folderId)) return true;
      if (disabledDest && destKey(disabledDest) === destKey(dest)) return true;
      return false;
    },
    [disabledFolderIds, disabledDest],
  );

  /** Why this destination is greyed out, or null if it isn't. */
  const disabledReason = useCallback(
    (dest: Destination): string | null => {
      if (disabledDest && destKey(disabledDest) === destKey(dest)) return "Current location";
      if (dest.folderId && disabledFolderIds?.has(dest.folderId)) return "Can't move a folder into itself";
      return null;
    },
    [disabledFolderIds, disabledDest],
  );

  // Reset to a clean state each time the picker opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setPending(null);
    setActive(0);
    setBusy(false);
    setRecentRaw(readRecentDestinations());
    if (initial) setCwd({ driveId: initial.driveId, folderId: initial.folderId });
    else if (drives.length === 1) setCwd({ driveId: drives[0].id, folderId: null });
    else setCwd({ driveId: null, folderId: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmed = query.trim().toLowerCase();

  // Search results: every non-disabled folder whose title or path matches, plus
  // each drive's top level, annotated with its full path.
  const searchRows = useMemo<Row[]>(() => {
    if (!trimmed) return [];
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    const matches = (hay: string) => tokens.every((t) => hay.includes(t));
    const rows: Row[] = [];
    for (const d of drives) {
      const dest: Destination = { driveId: d.id, folderId: null };
      if (matches(d.label.toLowerCase()))
        rows.push({
          kind: "result",
          key: destKey(dest),
          label: d.label,
          path: d.label,
          dest,
          disabled: isDisabled(dest),
          preferred: false,
          glyph: "folder",
        });
    }
    for (const f of folders) {
      const dest: Destination = { driveId: f.driveId, folderId: f.id };
      const path = pathOf(dest);
      const hay = path.join(" / ").toLowerCase();
      if (matches(hay))
        rows.push({
          kind: "result",
          key: destKey(dest),
          label: f.title || "Untitled folder",
          path: path.join(" / "),
          dest,
          disabled: isDisabled(dest),
          preferred: isPreferred(f.folderType, preferFolderType),
          glyph: folderGlyph(f.folderType, isSyntheticFolder(f)),
        });
    }
    return preferFirst(rows).slice(0, 100);
  }, [trimmed, drives, folders, pathOf, isDisabled, preferFolderType]);

  // Browse rows for the current location.
  const browseRows = useMemo<Row[]>(
    () =>
      buildBrowseRows({
        cwd,
        drives,
        folders,
        childrenByParent,
        isDisabled,
        disabledReason,
        recents,
        preferFolderType,
        intoVerb,
      }),
    [cwd, drives, folders, childrenByParent, isDisabled, disabledReason, recents, preferFolderType, intoVerb],
  );

  const searching = trimmed.length > 0;
  const rows = searching ? searchRows : browseRows;

  useEffect(() => {
    setActive(0);
  }, [cwd, searching]);

  const drillInto = useCallback(
    (driveId: string, folderId: string | null) => {
      setCwd({ driveId, folderId });
      setPending({ driveId, folderId });
    },
    [],
  );

  const goUp = useCallback(() => {
    if (cwd.driveId === null) return;
    if (cwd.folderId === null) {
      // At a drive's top level: step back to the drive list if there is one.
      if (drives.length > 1) setCwd({ driveId: null, folderId: null });
      return;
    }
    const parent = folderById.get(cwd.folderId)?.parentId ?? null;
    setCwd({ driveId: cwd.driveId, folderId: parent });
    setPending({ driveId: cwd.driveId, folderId: parent });
  }, [cwd, drives.length, folderById]);

  const selectRow = useCallback(
    (row: Row) => {
      if (row.kind === "drive") {
        drillInto(row.dest.driveId, null);
        return;
      }
      if (row.disabled) return;
      setPending(row.dest);
    },
    [drillInto],
  );

  const activateRow = useCallback(
    (row: Row) => {
      // Primary click: drives + folders drill in; container/result just select.
      // Never drill into a disabled folder (e.g. a moved folder's own subtree).
      if (row.kind === "drive") drillInto(row.dest.driveId, null);
      else if (row.kind === "folder" && !row.disabled) drillInto(row.dest.driveId, row.dest.folderId);
      else selectRow(row);
    },
    [drillInto, selectRow],
  );

  const canConfirm = !!pending && !isDisabled(pending) && !busy;

  const confirm = useCallback(async () => {
    if (!canConfirm) return;
    setBusy(true);
    try {
      if (pending) {
        await props.onConfirm(pending);
        writeRecentDestination(pending);
      }
    } finally {
      setBusy(false);
    }
  }, [canConfirm, props, pending]);

  const onListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(rows.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowRight" && !searching) {
        const row = rows[active];
        if (row && (row.kind === "drive" || (row.kind === "folder" && row.hasChildren && !row.disabled))) {
          e.preventDefault();
          drillInto(row.dest.driveId, row.kind === "drive" ? null : row.dest.folderId);
        }
      } else if (e.key === "ArrowLeft" && !searching) {
        e.preventDefault();
        goUp();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if ((e.metaKey || e.ctrlKey) && canConfirm) {
          void confirm();
          return;
        }
        const row = rows[active];
        if (row) selectRow(row);
      }
    },
    [rows, active, searching, drillInto, goUp, selectRow, confirm, canConfirm],
  );

  // Keep the active row scrolled into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, rows]);

  const pendingPath = pending ? pathOf(pending).join(" / ") : null;

  const breadcrumb = cwd.driveId !== null ? pathOf({ driveId: cwd.driveId, folderId: cwd.folderId }) : [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="destination-picker-title"
      initialFocusRef={searchRef}
      disableEscape={busy}
      containerClassName={modalCardClass("max-w-md flex flex-col max-h-[80vh]")}
    >
      <ModalHeader titleId="destination-picker-title" title={heading} onClose={onClose} />

      {/* Search */}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onListKeyDown}
          placeholder="Search folders…"
          aria-label="Search destination folders"
          className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-os-accent focus:outline-none"
        />
      </div>

      {/* Breadcrumb (browse mode only) */}
      {!searching && cwd.driveId !== null && (
        <div className="mb-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => setCwd({ driveId: null, folderId: null })}
            disabled={drives.length <= 1}
            className="hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground"
          >
            {drives.length > 1 ? "All drives" : breadcrumb[0]}
          </button>
          {breadcrumb.slice(drives.length > 1 ? 0 : 1).map((seg, i, arr) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3" aria-hidden />
              {i === arr.length - 1 ? (
                <span className="font-medium text-foreground">{seg}</span>
              ) : (
                <span>{seg}</span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* List */}
      <div
        ref={listRef}
        role="listbox"
        aria-label="Destinations"
        aria-activedescendant={rows[active] ? `dest-row-${active}` : undefined}
        tabIndex={0}
        onKeyDown={onListKeyDown}
        className="min-h-[8rem] flex-1 overflow-y-auto rounded-md border border-border"
      >
        {rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {searching ? "No matching folders." : emptyText}
          </p>
        ) : (
          rows.map((row, i) => {
            const selected = row.kind !== "drive" && pending != null && destKey(row.dest) === destKey(pending);
            const showSection = !!row.section && row.section !== rows[i - 1]?.section;
            return (
              <Fragment key={row.key}>
                {showSection && (
                  <p className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {row.section}
                  </p>
                )}
              <div
                id={`dest-row-${i}`}
                data-idx={i}
                role="option"
                aria-selected={selected}
                aria-disabled={"disabled" in row && row.disabled}
                onMouseEnter={() => setActive(i)}
                onClick={() => activateRow(row)}
                className={[
                  "flex cursor-pointer items-center gap-2 px-3 py-2 text-sm",
                  i === active ? "bg-muted/60" : "",
                  selected ? "bg-os-accent/10 text-foreground" : "text-foreground",
                  "disabled" in row && row.disabled ? "cursor-not-allowed opacity-40" : "",
                ].join(" ")}
              >
                {row.kind === "result" ? (
                  <>
                    <RowGlyph kind={row.glyph} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{row.label}</span>
                      <span className="truncate text-xs text-muted-foreground">{row.path}</span>
                    </span>
                  </>
                ) : row.kind === "container" ? (
                  <span className="font-medium">{row.label}</span>
                ) : (
                  <>
                    {row.kind === "drive" ? (
                      <DriveScopeIcon scope={{ id: row.driveId, iconEmoji: row.emoji }} tiles={tiles} />
                    ) : row.emoji ? (
                      <span className="shrink-0" aria-hidden>
                        {row.emoji}
                      </span>
                    ) : (
                      <RowGlyph kind={row.kind === "folder" ? row.glyph : "folder"} />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{row.label}</span>
                      {row.note && (
                        <span className="truncate text-xs text-muted-foreground">{row.note}</span>
                      )}
                    </span>
                    {(row.kind === "drive" || (row.kind === "folder" && row.hasChildren && !row.disabled)) && (
                      <button
                        type="button"
                        aria-label={`Open ${row.label}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          drillInto(row.dest.driveId, row.kind === "drive" ? null : row.dest.folderId);
                        }}
                        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <ChevronRight className="h-4 w-4" aria-hidden />
                      </button>
                    )}
                  </>
                )}
              </div>
              </Fragment>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="mt-4 flex items-center gap-3">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {pendingPath ? (
            <>
              {pendingLabel} <span className="font-medium text-foreground">{pendingPath}</span>
            </>
          ) : (
            "Select a destination"
          )}
        </p>
        <button type="button" onClick={onClose} className={buttonClasses("secondary", "sm")}>
          Cancel
        </button>
        <button
          type="button"
          disabled={!canConfirm}
          onClick={() => void confirm()}
          className={buttonClasses("primary", "sm")}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

function RowGlyph({ kind }: { kind: FolderGlyphKind }) {
  if (kind === "folder") return <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />;
  return (
    <FolderGlyph
      glyph={{ tint: PINK_FOLDER, system: true, mark: kind === "meetings" ? "calendar" : null }}
      className="h-4 w-4"
      markClassName="h-2.5 w-2.5"
    />
  );
}
