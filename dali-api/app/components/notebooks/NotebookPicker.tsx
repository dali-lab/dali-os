import { useEffect, useId, useRef, useState } from "react";
import { Modal, ModalHeader } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import { buttonClasses } from "~/components/ui/Button";
import { SearchInput } from "~/components/ui/SearchInput";
import { notebookQueryString, notebookStats, type PickedNotebook } from "~/components/notebooks/notebook-picker";

type NotebookRow = PickedNotebook & { tabCount: number; lastNoteAt: string | null; suggested: boolean };

export type { PickedNotebook };

/**
 * Pick one notebook the viewer can edit: suggested ones (this series' default,
 * one that holds its notes, one in the project, one for the same guests) first,
 * then the rest by most recent note.
 */
export function NotebookPicker({
  open,
  onClose,
  onPick,
  onNewInstead,
  projectId,
  meetingId,
  heading = "Add to a notebook",
  excludeId,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (notebook: PickedNotebook) => void;
  /** Offers the "New notebook instead" footer button when given. */
  onNewInstead?: () => void;
  projectId?: string | null;
  meetingId?: string | null;
  heading?: string;
  /** A notebook that can't be picked (the one being merged away). */
  excludeId?: string;
}) {
  const titleId = useId();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<NotebookRow[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStatus("loading");
    const timer = setTimeout(async () => {
      try {
        const qs = notebookQueryString(query, { projectId, meetingId });
        const res = await fetch(`/api/notebooks${qs ? `?${qs}` : ""}`, { credentials: "include" });
        if (!res.ok) throw new Error("Request failed");
        const json = (await res.json()) as { notebooks: NotebookRow[] };
        if (cancelled) return;
        setRows(json.notebooks);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }, query ? 200 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, projectId, meetingId]);

  const offered = rows.filter((r) => r.id !== excludeId);
  const suggested = offered.filter((r) => r.suggested);
  const recent = offered.filter((r) => !r.suggested);

  return (
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
        {status === "loading" && rows.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading notebooks</p>
        )}
        {status === "error" && (
          <p className="px-3 py-6 text-center text-sm text-red-600">Couldn't load notebooks. Close this and try again.</p>
        )}
        {status === "ready" && offered.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {query.trim() ? "No notebooks match." : "You have no notebooks yet."}
          </p>
        )}
        <NotebookGroup label="Suggested" rows={suggested} onPick={onPick} />
        <NotebookGroup label="Recent" rows={recent} onPick={onPick} />
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        {onNewInstead ? (
          <button type="button" onClick={onNewInstead} className={buttonClasses("secondary", "sm")}>
            New notebook instead
          </button>
        ) : (
          <span />
        )}
        <button type="button" onClick={onClose} className={buttonClasses("ghost", "sm")}>
          Cancel
        </button>
      </div>
    </Modal>
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
              onClick={() => onPick({ id: row.id, title: row.title, path: row.path })}
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
