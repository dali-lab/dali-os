import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus } from "lucide-react";
import { Modal, ModalHeader } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import { buttonClasses } from "~/components/ui/Button";
import { SearchInput } from "~/components/ui/SearchInput";
import {
  fetchNotebookRows,
  notebookStats,
  type NotebookListState,
  type NotebookRow,
  type PickedNotebook,
} from "~/components/notebooks/notebook-picker";

export type { NotebookRow, PickedNotebook };

/**
 * Pick one notebook the viewer can edit: suggested ones (this series' default,
 * one that holds its notes, one in the project, one for the same guests) first,
 * then the rest by most recent note.
 */
export function NotebookPicker({
  open,
  onClose,
  onPick,
  newRow,
  projectId,
  meetingId,
  space,
  heading = "Add to a notebook",
  excludeId,
  preloaded,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (notebook: PickedNotebook) => void;
  /** A first row that starts a new notebook instead of picking one. */
  newRow?: { label: string; onNew: () => void };
  projectId?: string | null;
  meetingId?: string | null;
  /** Limits the list to notebooks in one workspace. */
  space?: { workspaceType: string; workspaceId: string | null } | null;
  heading?: string;
  /** A notebook that can't be picked (the one being merged away). */
  excludeId?: string;
  /** The list for an empty search, already loaded by the caller; a typed search still fetches. */
  preloaded?: NotebookListState;
}) {
  const titleId = useId();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [fetched, setFetched] = useState<NotebookListState>({ rows: [], status: "loading" });
  const usePreloaded = !!preloaded && query.trim() === "";

  useEffect(() => {
    if (!open || usePreloaded) return;
    let cancelled = false;
    setFetched((f) => ({ ...f, status: "loading" }));
    const timer = setTimeout(async () => {
      try {
        const rows = await fetchNotebookRows(query, { projectId, meetingId, space });
        if (!cancelled) setFetched({ rows, status: "ready" });
      } catch {
        if (!cancelled) setFetched((f) => ({ ...f, status: "error" }));
      }
    }, query ? 200 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, usePreloaded, query, projectId, meetingId, space?.workspaceType, space?.workspaceId]);

  const { rows, status } = usePreloaded ? preloaded : fetched;
  const offered = rows.filter((r) => r.id !== excludeId);
  const suggested = offered.filter((r) => r.suggested);
  const recent = offered.filter((r) => !r.suggested);

  if (typeof document === "undefined") return null;

  return createPortal(
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      initialFocusRef={searchRef}
      containerClassName={modalCardClass("max-w-md flex flex-col max-h-[80vh]")}
    >
      <ModalHeader titleId={titleId} title={heading} onClose={onClose} />
      <SearchInput
        ref={searchRef}
        size="sm"
        containerClassName="mb-3"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search notebooks"
        aria-label="Search notebooks"
      />
      <div className="min-h-[8rem] flex-1 overflow-y-auto rounded-md border border-border">
        {newRow && (
          <button
            type="button"
            onClick={newRow.onNew}
            className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
          >
            <Plus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            {newRow.label}
          </button>
        )}
        {status === "loading" && rows.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading notebooks</p>
        )}
        {status === "error" && (
          <p className="px-3 py-6 text-center text-sm text-destructive">Couldn't load notebooks. Close this and try again.</p>
        )}
        {status === "ready" && offered.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {query.trim() ? "No notebooks match." : "You have no notebooks yet."}
          </p>
        )}
        <NotebookGroup label="Suggested" rows={suggested} onPick={onPick} />
        <NotebookGroup label="Recent" rows={recent} onPick={onPick} />
      </div>
      <div className="mt-4 flex items-center justify-end gap-3">
        <button type="button" onClick={onClose} className={buttonClasses("ghost", "sm")}>
          Cancel
        </button>
      </div>
    </Modal>,
    document.body,
  );
}

function NotebookGroup({
  label,
  rows,
  onPick,
}: {
  label: string;
  rows: NotebookRow[];
  onPick: (notebook: PickedNotebook) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section aria-label={label}>
      <p className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() =>
                onPick({
                  id: row.id,
                  title: row.title,
                  path: row.path,
                  workspaceType: row.workspaceType,
                  workspaceId: row.workspaceId,
                  parentPageId: row.parentPageId,
                })
              }
              className="flex w-full flex-col px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
            >
              <span className="truncate">{row.title}</span>
              <span className="truncate text-xs text-muted-foreground">
                {row.path} · {notebookStats(row)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
