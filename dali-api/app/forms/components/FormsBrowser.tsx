import { useEffect, useMemo, useState } from "react";
import { Link, useFetcher, useNavigate } from "react-router";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Folder, FolderUp, FileText, MoreVertical } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { Modal, ModalHeader, ModalFooter } from "~/components/Modal";
import type { FormCard, FolderCard, FormRef } from "~/forms/lib/forms-data";
import {
  flattenFolderTree,
  descendantSetOf,
  folderPathMap,
  type FolderOption,
} from "~/forms/lib/folder-tree.shared";

function errorOf(data: unknown): string | null {
  if (data && typeof data === "object" && "error" in data) {
    const e = (data as { error: unknown }).error;
    return typeof e === "string" ? e : null;
  }
  return null;
}

type Dialog =
  | {
      kind: "prompt";
      title: string;
      label: string;
      initial: string;
      confirmLabel: string;
      submit: (name: string) => Record<string, string>;
    }
  | {
      kind: "confirm";
      title: string;
      message: string;
      confirmLabel: string;
      submit: Record<string, string>;
    };

type MoveSubject = {
  type: "form" | "folder";
  id: string;
  name: string;
  // Where the subject currently lives (its containing folder, null = top
  // level) — the picker disables and annotates this row. Grid cards live at
  // the browsed level; search results carry their own location.
  locationId: string | null;
};
type DragItem = { type: "form" | "folder"; id: string };

export function FormsBrowser({
  folderId,
  parentId,
  folders,
  forms,
  allFolders,
  allForms,
}: {
  // The folder this view is showing (null = top level). New forms/folders
  // are created in this folder.
  folderId: string | null;
  // Parent of the current folder (null at top level, or when the current
  // folder sits at the root). Drop target for the "move up" zone.
  parentId: string | null;
  folders: FolderCard[];
  forms: FormCard[];
  // Every folder/form in the tree, for the "Move to…" picker and the
  // cross-depth search.
  allFolders: FolderOption[];
  allForms: FormRef[];
}) {
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [move, setMove] = useState<MoveSubject | null>(null);
  const [dragging, setDragging] = useState<DragItem | null>(null);
  const [query, setQuery] = useState("");

  // duplicate-form returns the new copy's id — jump straight to its editor
  // so the user lands in the seeded draft instead of hunting for the card.
  const duplicatedId =
    fetcher.data && typeof fetcher.data === "object" && "formId" in fetcher.data
      ? (fetcher.data as { formId?: string }).formId
      : undefined;
  useEffect(() => {
    if (duplicatedId) navigate(`/forms/edit/${duplicatedId}`);
  }, [duplicatedId, navigate]);

  // 6px activation distance disambiguates click (navigate) from drag on the
  // Link cards — same pattern as KanbanBoard.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const busy = fetcher.state !== "idle";
  const error = errorOf(fetcher.data);

  // A non-empty query searches the WHOLE tree (allFolders/allForms), not just
  // the browsed level; results replace the grid and show each hit's location.
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const pathById = useMemo(() => folderPathMap(allFolders), [allFolders]);
  const locationOf = (containerId: string | null) =>
    containerId ? (pathById.get(containerId) ?? "…") : "Top level";
  const folderResults = searching
    ? allFolders.filter((d) => d.name.toLowerCase().includes(q))
    : [];
  const formResults = searching
    ? allForms.filter((f) => f.name.toLowerCase().includes(q))
    : [];

  function createForm() {
    setDialog({
      kind: "prompt",
      title: "New form",
      label: "Form name",
      initial: "",
      confirmLabel: "Create",
      submit: (name) => ({
        intent: "create-form",
        name,
        folderId: folderId ?? "",
      }),
    });
  }
  function createFolder() {
    setDialog({
      kind: "prompt",
      title: "New folder",
      label: "Folder name",
      initial: "",
      confirmLabel: "Create",
      submit: (name) => ({
        intent: "create-folder",
        name,
        parentId: folderId ?? "",
      }),
    });
  }
  function renameForm(f: { id: string; name: string }) {
    setDialog({
      kind: "prompt",
      title: "Rename form",
      label: "Form name",
      initial: f.name,
      confirmLabel: "Rename",
      submit: (name) => ({ intent: "rename-form", id: f.id, name }),
    });
  }
  function deleteForm(f: { id: string; name: string }) {
    setDialog({
      kind: "confirm",
      title: "Delete form",
      message: `Delete "${f.name}"? This can't be undone.`,
      confirmLabel: "Delete",
      submit: { intent: "delete-form", id: f.id },
    });
  }
  function renameFolder(d: { id: string; name: string }) {
    setDialog({
      kind: "prompt",
      title: "Rename folder",
      label: "Folder name",
      initial: d.name,
      confirmLabel: "Rename",
      submit: (name) => ({ intent: "rename-folder", id: d.id, name }),
    });
  }
  function deleteFolder(d: { id: string; name: string }) {
    setDialog({
      kind: "confirm",
      title: "Delete folder",
      message: `Delete folder "${d.name}"? Its forms and subfolders move to the top level.`,
      confirmLabel: "Delete",
      submit: { intent: "delete-folder", id: d.id },
    });
  }
  function submitDialog(name?: string) {
    if (!dialog) return;
    if (dialog.kind === "prompt") {
      const trimmed = (name ?? "").trim();
      if (!trimmed) return;
      fetcher.submit(dialog.submit(trimmed), { method: "post" });
    } else {
      fetcher.submit(dialog.submit, { method: "post" });
    }
    setDialog(null);
  }

  function duplicateForm(f: { id: string }) {
    fetcher.submit(
      { intent: "duplicate-form", id: f.id },
      { method: "post" },
    );
  }

  function submitMove(item: DragItem, destinationId: string | null) {
    if (item.type === "form") {
      fetcher.submit(
        { intent: "move-form", id: item.id, folderId: destinationId ?? "" },
        { method: "post" },
      );
    } else {
      fetcher.submit(
        { intent: "move-folder", id: item.id, parentId: destinationId ?? "" },
        { method: "post" },
      );
    }
  }

  function handleDragStart(event: DragStartEvent) {
    setDragging((event.active.data.current as DragItem | undefined) ?? null);
  }
  function handleDragEnd(event: DragEndEvent) {
    setDragging(null);
    const item = event.active.data.current as DragItem | undefined;
    const dest = event.over?.data.current as
      | { folderId: string | null }
      | undefined;
    if (!item || !event.over || dest === undefined) return;
    if (item.type === "folder" && dest.folderId === item.id) return;
    submitMove(item, dest.folderId);
  }

  const parentName =
    parentId === null
      ? null
      : (allFolders.find((f) => f.id === parentId)?.name ?? "parent folder");

  const empty = folders.length === 0 && forms.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search all forms and folders"
          className="flex-1 min-w-[200px] max-w-sm px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        />
        <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={createFolder}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-muted text-foreground border border-border hover:bg-muted/70 transition-colors disabled:opacity-60"
        >
          + New folder
        </button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={busy}
          onClick={createForm}
        >
          + New form
        </Button>
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {searching ? (
        folderResults.length === 0 && formResults.length === 0 ? (
          <div className="border border-dashed border-border rounded-lg p-10 text-center text-sm text-muted-foreground">
            No forms or folders match "{query.trim()}" anywhere.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {folderResults.map((d) => (
              <Link
                key={d.id}
                to={`/forms/${d.id}`}
                className="group flex items-center gap-3 bg-card border border-border rounded-lg px-4 py-3 hover:border-accent-coral/60 hover:shadow-sm transition-all"
              >
                <Folder className="w-5 h-5 text-accent-coral fill-accent-coral/20 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground truncate">
                    {d.name}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {locationOf(d.parentId)}
                  </div>
                </div>
                <CardMenu
                  busy={busy}
                  onRename={() => renameFolder(d)}
                  onMove={() =>
                    setMove({
                      type: "folder",
                      id: d.id,
                      name: d.name,
                      locationId: d.parentId,
                    })
                  }
                  onDelete={() => deleteFolder(d)}
                />
              </Link>
            ))}
            {formResults.map((f) => (
              <div
                key={f.id}
                className="group flex items-center gap-3 bg-card border border-border rounded-lg px-4 py-3 hover:border-accent-coral/60 hover:shadow-sm transition-all"
              >
                <Link
                  to={`/forms/edit/${f.id}`}
                  className="flex items-center gap-3 min-w-0 flex-1"
                >
                  <FileText className="w-5 h-5 text-muted-foreground group-hover:text-accent-coral transition-colors shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-foreground truncate">
                      {f.name}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {locationOf(f.folderId)}
                    </div>
                  </div>
                </Link>
                <CardMenu
                  busy={busy}
                  onRename={() => renameForm(f)}
                  onMove={() =>
                    setMove({
                      type: "form",
                      id: f.id,
                      name: f.name,
                      locationId: f.folderId,
                    })
                  }
                  onDuplicate={() => duplicateForm(f)}
                  onDelete={() => deleteForm(f)}
                />
              </div>
            ))}
          </div>
        )
      ) : empty ? (
        <div className="border border-dashed border-border rounded-lg p-10 text-center text-sm text-muted-foreground">
          Nothing here yet. Create a form or a folder to get started.
        </div>
      ) : (
        // Fixed id keeps dnd-kit's generated ids stable across SSR/client.
        <DndContext
          id="forms-browser"
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setDragging(null)}
        >
          {folderId !== null && dragging !== null && (
            <MoveUpDropZone
              targetFolderId={parentId}
              label={
                parentName ? `Move to "${parentName}"` : "Move to top level"
              }
            />
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {folders.map((d) => (
              <FolderCardView
                key={d.id}
                folder={d}
                busy={busy}
                dropDisabled={
                  dragging?.type === "folder" && dragging.id === d.id
                }
                onRename={() => renameFolder(d)}
                onDelete={() => deleteFolder(d)}
                onMove={() =>
                  setMove({
                    type: "folder",
                    id: d.id,
                    name: d.name,
                    locationId: folderId,
                  })
                }
              />
            ))}
            {forms.map((f) => (
              <FormCardView
                key={f.id}
                form={f}
                busy={busy}
                onRename={() => renameForm(f)}
                onDelete={() => deleteForm(f)}
                onMove={() =>
                  setMove({
                    type: "form",
                    id: f.id,
                    name: f.name,
                    locationId: folderId,
                  })
                }
                onDuplicate={() => duplicateForm(f)}
              />
            ))}
          </div>
        </DndContext>
      )}

      {dialog && (
        <FormsDialog
          dialog={dialog}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={submitDialog}
        />
      )}

      {move && (
        <MoveDialog
          subject={move}
          allFolders={allFolders}
          currentLocationId={move.locationId}
          busy={busy}
          onCancel={() => setMove(null)}
          onMove={(destinationId) => {
            submitMove(move, destinationId);
            setMove(null);
          }}
        />
      )}
    </div>
  );
}

// Full-width drop target shown above the grid while a drag is in flight
// inside a folder — the breadcrumb trail lives in the global chrome (outside
// this DndContext), so moving up needs its own in-page target.
function MoveUpDropZone({
  targetFolderId,
  label,
}: {
  targetFolderId: string | null;
  label: string;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: "move-up",
    data: { folderId: targetFolderId },
  });
  return (
    <div
      ref={setNodeRef}
      className={`flex items-center justify-center gap-2 border border-dashed rounded-lg px-4 py-3 text-sm transition-colors ${
        isOver
          ? "ring-2 ring-accent-coral/40 border-accent-coral/60 text-foreground"
          : "border-border text-muted-foreground"
      }`}
    >
      <FolderUp className="w-4 h-4" />
      {label}
    </div>
  );
}

function CardMenu({
  busy,
  onRename,
  onMove,
  onDuplicate,
  onDelete,
}: {
  busy: boolean;
  onRename: () => void;
  onMove: () => void;
  // Forms only — duplicating a folder (deep copy) isn't supported.
  onDuplicate?: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label="Actions"
        disabled={busy}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }}
          />
          <div
            className="absolute right-0 top-7 z-50 w-44 bg-card border border-border rounded-md shadow-lg p-1 flex flex-col text-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={(e) => {
                // This menu lives inside a navigating <Link>; without these
                // the click bubbles to the Link and routes into the folder,
                // unmounting the page before the dialog can act.
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                onRename();
              }}
              className="text-left px-2 py-1.5 rounded hover:bg-muted/50 text-foreground"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                onMove();
              }}
              className="text-left px-2 py-1.5 rounded hover:bg-muted/50 text-foreground"
            >
              Move to…
            </button>
            {onDuplicate && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setOpen(false);
                  onDuplicate();
                }}
                className="text-left px-2 py-1.5 rounded hover:bg-muted/50 text-foreground"
              >
                Duplicate
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                onDelete();
              }}
              className="text-left px-2 py-1.5 rounded hover:bg-destructive/10 text-destructive"
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function FolderCardView({
  folder,
  busy,
  dropDisabled,
  onRename,
  onDelete,
  onMove,
}: {
  folder: FolderCard;
  busy: boolean;
  // True while this folder itself is being dragged: no self-drop highlight,
  // no self-drop request.
  dropDisabled: boolean;
  onRename: () => void;
  onDelete: () => void;
  onMove: () => void;
}) {
  const drag = useDraggable({
    id: `folder:${folder.id}`,
    data: { type: "folder", id: folder.id },
    disabled: busy,
  });
  const drop = useDroppable({
    id: `folder-drop:${folder.id}`,
    data: { folderId: folder.id },
    disabled: dropDisabled,
  });
  const childCount = folder.formCount + folder.folderCount;
  return (
    <Link
      to={`/forms/${folder.id}`}
      ref={(node) => {
        drag.setNodeRef(node);
        drop.setNodeRef(node);
      }}
      // Only the listeners: spreading dnd-kit's attributes would put
      // role="button" on the anchor. Drag stays pointer-driven (no keyboard
      // sensor is configured), matching the other boards.
      {...drag.listeners}
      style={
        drag.transform
          ? {
              transform: `translate3d(${drag.transform.x}px, ${drag.transform.y}px, 0)`,
              zIndex: 50,
            }
          : undefined
      }
      className={`group flex items-start gap-3 bg-card border border-border rounded-lg p-4 hover:border-accent-coral/60 hover:shadow-sm transition-all ${
        drop.isOver ? "ring-2 ring-accent-coral/40" : ""
      }`}
    >
      <div className="mt-0.5 text-accent-coral">
        <Folder className="w-6 h-6 fill-accent-coral/20" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-foreground truncate">
          {folder.name}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {childCount === 0
            ? "Empty folder"
            : [
                folder.folderCount > 0 &&
                  `${folder.folderCount} folder${folder.folderCount === 1 ? "" : "s"}`,
                folder.formCount > 0 &&
                  `${folder.formCount} form${folder.formCount === 1 ? "" : "s"}`,
              ]
                .filter(Boolean)
                .join(" · ")}
        </div>
      </div>
      {/* Inside a Link: menu stops propagation so clicks don't navigate. */}
      <CardMenu
        busy={busy}
        onRename={onRename}
        onMove={onMove}
        onDelete={onDelete}
      />
    </Link>
  );
}

function FormCardView({
  form,
  busy,
  onRename,
  onDelete,
  onMove,
  onDuplicate,
}: {
  form: FormCard;
  busy: boolean;
  onRename: () => void;
  onDelete: () => void;
  onMove: () => void;
  onDuplicate: () => void;
}) {
  const drag = useDraggable({
    id: `form:${form.id}`,
    data: { type: "form", id: form.id },
    disabled: busy,
  });
  return (
    <div
      ref={drag.setNodeRef}
      {...drag.listeners}
      style={
        drag.transform
          ? {
              transform: `translate3d(${drag.transform.x}px, ${drag.transform.y}px, 0)`,
              zIndex: 50,
            }
          : undefined
      }
      className="group flex items-start gap-3 bg-card border border-border rounded-lg p-4 hover:border-accent-coral/60 hover:shadow-sm transition-all"
    >
      <Link
        to={`/forms/edit/${form.id}`}
        className="flex items-start gap-3 min-w-0 flex-1 text-left"
      >
        <div className="mt-0.5 text-muted-foreground group-hover:text-accent-coral transition-colors">
          <FileText className="w-6 h-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground truncate">
            {form.name}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {form.versionCount === 0
              ? "No questions yet"
              : `${form.versionCount} version${form.versionCount === 1 ? "" : "s"}`}
          </div>
        </div>
      </Link>
      <CardMenu
        busy={busy}
        onRename={onRename}
        onMove={onMove}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />
    </div>
  );
}

function MoveDialog({
  subject,
  allFolders,
  currentLocationId,
  busy,
  onCancel,
  onMove,
}: {
  subject: MoveSubject;
  allFolders: FolderOption[];
  // The folder the subject currently lives in (null = top level).
  currentLocationId: string | null;
  busy: boolean;
  onCancel: () => void;
  onMove: (destinationId: string | null) => void;
}) {
  // undefined = nothing picked yet; null = "Top level".
  const [selected, setSelected] = useState<string | null | undefined>(
    undefined,
  );
  const rows = flattenFolderTree(allFolders);
  const blocked =
    subject.type === "folder"
      ? descendantSetOf(allFolders, subject.id)
      : new Set<string>();

  function rowClass(isSelected: boolean, disabled: boolean): string {
    if (disabled) return "text-muted-foreground/60 cursor-not-allowed";
    if (isSelected) return "bg-accent-coral/10 text-accent-coral";
    return "text-foreground hover:bg-muted/50";
  }

  return (
    <Modal
      open
      onClose={onCancel}
      labelledBy="forms-move-title"
      containerClassName="bg-card border border-border rounded-lg w-full max-w-sm p-5 flex flex-col gap-4"
    >
      <>
        <ModalHeader
          titleId="forms-move-title"
          title={`Move "${subject.name}"`}
          onClose={onCancel}
        />

        <div className="max-h-64 overflow-y-auto flex flex-col gap-0.5 text-sm">
          <button
            type="button"
            disabled={currentLocationId === null}
            onClick={() => setSelected(null)}
            className={`flex items-center gap-2 text-left px-2 py-1.5 rounded ${rowClass(
              selected === null,
              currentLocationId === null,
            )}`}
          >
            <FolderUp className="w-4 h-4 shrink-0" />
            <span className="truncate">Top level</span>
            {currentLocationId === null && (
              <span className="ml-auto text-xs text-muted-foreground/70 shrink-0">
                Current location
              </span>
            )}
          </button>
          {rows.map((row) => {
            const isCurrent = row.id === currentLocationId;
            const disabled = blocked.has(row.id) || isCurrent;
            return (
              <button
                key={row.id}
                type="button"
                disabled={disabled}
                onClick={() => setSelected(row.id)}
                style={{ paddingLeft: 8 + row.depth * 16 }}
                className={`flex items-center gap-2 text-left px-2 py-1.5 rounded ${rowClass(
                  selected === row.id,
                  disabled,
                )}`}
              >
                <Folder className="w-4 h-4 shrink-0 fill-accent-coral/10" />
                <span className="truncate">{row.name}</span>
                {isCurrent && (
                  <span className="ml-auto text-xs text-muted-foreground/70 shrink-0">
                    Current location
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <ModalFooter onCancel={onCancel} className="mt-0">
          <button
            type="button"
            disabled={busy || selected === undefined}
            onClick={() => onMove(selected as string | null)}
            className="px-3 py-1.5 text-sm font-medium rounded-md text-white bg-accent-coral hover:bg-accent-coral/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Move
          </button>
        </ModalFooter>
      </>
    </Modal>
  );
}

function FormsDialog({
  dialog,
  busy,
  onCancel,
  onConfirm,
}: {
  dialog: Dialog;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (name?: string) => void;
}) {
  const [name, setName] = useState(
    dialog.kind === "prompt" ? dialog.initial : "",
  );
  const destructive = dialog.kind === "confirm";

  function confirm() {
    onConfirm(dialog.kind === "prompt" ? name : undefined);
  }

  return (
    <Modal
      open
      onClose={onCancel}
      labelledBy="forms-dialog-title"
      containerClassName="bg-card border border-border rounded-lg w-full max-w-sm p-5 flex flex-col gap-4"
    >
      <>
        <ModalHeader
          titleId="forms-dialog-title"
          title={dialog.title}
          onClose={onCancel}
        />

        {dialog.kind === "prompt" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              confirm();
            }}
            className="flex flex-col gap-1 text-xs"
          >
            <label
              className="text-muted-foreground"
              htmlFor="forms-dialog-input"
            >
              {dialog.label}
            </label>
            <input
              id="forms-dialog-input"
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
            />
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">{dialog.message}</p>
        )}

        <ModalFooter onCancel={onCancel} className="mt-0">
          <button
            type="button"
            onClick={confirm}
            disabled={
              busy || (dialog.kind === "prompt" && name.trim().length === 0)
            }
            className={`px-3 py-1.5 text-sm font-medium rounded-md text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
              destructive
                ? "bg-destructive hover:bg-destructive/90"
                : "bg-accent-coral hover:bg-accent-coral/90"
            }`}
          >
            {dialog.confirmLabel}
          </button>
        </ModalFooter>
      </>
    </Modal>
  );
}
