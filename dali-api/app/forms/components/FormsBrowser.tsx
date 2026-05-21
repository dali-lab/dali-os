import { useState } from "react";
import { Link, useFetcher } from "react-router";
import { Folder, FileText, MoreVertical } from "lucide-react";
import type { FormCard, FolderCard } from "~/forms/lib/forms-data";

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

export function FormsBrowser({
  folderId,
  folders,
  forms,
}: {
  // The folder this view is showing (null = top level). New forms/folders
  // are created in this folder.
  folderId: string | null;
  folders: FolderCard[];
  forms: FormCard[];
}) {
  const fetcher = useFetcher();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [query, setQuery] = useState("");

  const busy = fetcher.state !== "idle";
  const error = errorOf(fetcher.data);

  const q = query.trim().toLowerCase();
  const visibleFolders = q
    ? folders.filter((d) => d.name.toLowerCase().includes(q))
    : folders;
  const visibleForms = q
    ? forms.filter((f) => f.name.toLowerCase().includes(q))
    : forms;

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
  function renameForm(f: FormCard) {
    setDialog({
      kind: "prompt",
      title: "Rename form",
      label: "Form name",
      initial: f.name,
      confirmLabel: "Rename",
      submit: (name) => ({ intent: "rename-form", id: f.id, name }),
    });
  }
  function deleteForm(f: FormCard) {
    setDialog({
      kind: "confirm",
      title: "Delete form",
      message: `Delete "${f.name}"? This can't be undone.`,
      confirmLabel: "Delete",
      submit: { intent: "delete-form", id: f.id },
    });
  }
  function renameFolder(d: FolderCard) {
    setDialog({
      kind: "prompt",
      title: "Rename folder",
      label: "Folder name",
      initial: d.name,
      confirmLabel: "Rename",
      submit: (name) => ({ intent: "rename-folder", id: d.id, name }),
    });
  }
  function deleteFolder(d: FolderCard) {
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

  const empty = folders.length === 0 && forms.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search forms and folders"
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
        <button
          type="button"
          disabled={busy}
          onClick={createForm}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors disabled:opacity-60"
        >
          + New form
        </button>
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {empty ? (
        <div className="border border-dashed border-border rounded-lg p-10 text-center text-sm text-muted-foreground">
          Nothing here yet. Create a form or a folder to get started.
        </div>
      ) : visibleFolders.length === 0 && visibleForms.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-10 text-center text-sm text-muted-foreground">
          No forms or folders match "{query.trim()}".
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visibleFolders.map((d) => (
            <FolderCardView
              key={d.id}
              folder={d}
              busy={busy}
              onRename={() => renameFolder(d)}
              onDelete={() => deleteFolder(d)}
            />
          ))}
          {visibleForms.map((f) => (
            <FormCardView
              key={f.id}
              form={f}
              busy={busy}
              onRename={() => renameForm(f)}
              onDelete={() => deleteForm(f)}
            />
          ))}
        </div>
      )}

      {dialog && (
        <FormsDialog
          dialog={dialog}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={submitDialog}
        />
      )}
    </div>
  );
}

function CardMenu({
  busy,
  onRename,
  onDelete,
}: {
  busy: boolean;
  onRename: () => void;
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
  onRename,
  onDelete,
}: {
  folder: FolderCard;
  busy: boolean;
  onRename: () => void;
  onDelete: () => void;
}) {
  const childCount = folder.formCount + folder.folderCount;
  return (
    <Link
      to={`/forms/${folder.id}`}
      className="group flex items-start gap-3 bg-accent-coral/5 border-2 border-accent-coral/30 rounded-lg p-4 hover:border-accent-coral/70 hover:bg-accent-coral/10 hover:shadow-sm transition-all"
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
      <CardMenu busy={busy} onRename={onRename} onDelete={onDelete} />
    </Link>
  );
}

function FormCardView({
  form,
  busy,
  onRename,
  onDelete,
}: {
  form: FormCard;
  busy: boolean;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group flex items-start gap-3 bg-card border border-border rounded-lg p-4 hover:border-accent-coral/60 hover:shadow-sm transition-all">
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
      <CardMenu busy={busy} onRename={onRename} onDelete={onDelete} />
    </div>
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
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-card border border-border rounded-lg w-full max-w-sm p-5 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-heading text-lg font-bold text-foreground">
            {dialog.title}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground text-lg leading-none"
          >
            ✕
          </button>
        </div>

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

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm border border-border rounded-md text-foreground hover:bg-muted/40 transition-colors"
          >
            Cancel
          </button>
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
        </div>
      </div>
    </div>
  );
}
