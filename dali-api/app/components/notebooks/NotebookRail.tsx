import { useEffect, useId, useState } from "react";
import { Link, useNavigate, useRevalidator } from "react-router";
import { BookOpen, FilePlus, FileText, MoreHorizontal, Plus } from "lucide-react";
import { Modal, ModalHeader } from "~/components/Modal";
import { modalCardClass, useOsChrome } from "~/components/os-chrome";
import { buttonClasses } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import { Combobox, Menu, Select } from "~/components/ui/floating";
import { useToast } from "~/components/ui/toast";
import { NotebookPicker } from "~/components/notebooks/NotebookPicker";
import { useNoteTemplates } from "~/components/notebooks/use-note-templates";
import {
  detachRequest,
  notebookRequest,
  removeFromNotebookRequest,
  renameRequest,
  sendJson,
  type JsonRequest,
} from "~/components/notebooks/notebook-requests";
import { useOpenMeetingNote } from "~/calendar/components/AddMeetingNoteModal";
import { cn } from "~/lib/cn";

export type NotebookTab = { id: string; label: string; meeting: string | null; isNote: boolean };

export type NotebookView = {
  id: string;
  title: string;
  canEdit: boolean;
  workspaceType: string;
  workspaceId: string | null;
  /** The folder the notebook sits in; null at the top of its workspace. */
  folderId: string | null;
  templateId: string | null;
  projectId: string | null;
  /** The next meeting occurrence without a note, for the series that files here. */
  nextNote: { meetingId: string; occurrenceStart: string } | null;
  tabs: NotebookTab[];
};

/** Runs a notebook request, then toasts any failure or hands back to `onDone`. */
function useNotebookRequest() {
  const toast = useToast();
  return async (req: JsonRequest, onDone?: () => void) => {
    const res = await sendJson(req);
    if (!res.ok) {
      toast.error(res.error ?? "Something went wrong");
      return false;
    }
    onDone?.();
    return true;
  };
}

type Panel = "add-document" | "merge" | "template" | null;

/** The Add and ⋯ menus plus the dialogs they open; shared by the tab rail and
 *  the single-note chip. */
function NotebookControls({ notebook }: { notebook: NotebookView }) {
  const dialog = useDialog();
  const toast = useToast();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const run = useNotebookRequest();
  const [panel, setPanel] = useState<Panel>(null);
  const nextNote = useOpenMeetingNote({
    meetingId: notebook.nextNote?.meetingId ?? "",
    occurrenceStart: notebook.nextNote?.occurrenceStart ?? "",
    actionPath: "/calendar",
  });
  useEffect(() => {
    if (nextNote.error) toast.error(nextNote.error);
  }, [nextNote.error, toast]);

  if (!notebook.canEdit) return null;

  async function dissolve() {
    const ok = await dialog.confirm({
      title: "Dissolve this notebook?",
      description: "Each note becomes a plain document in the folder the notebook is in, and the notebook goes away.",
      confirmLabel: "Dissolve",
      tone: "destructive",
    });
    if (ok) await run(notebookRequest(notebook.id, { intent: "dissolve" }), () => revalidator.revalidate());
  }

  async function trash() {
    const ok = await dialog.confirm({
      title: "Move this notebook to Trash?",
      description: "The notebook and all of its notes go to Trash.",
      confirmLabel: "Move to Trash",
      tone: "destructive",
    });
    if (ok) {
      await run(notebookRequest(notebook.id, { intent: "trash" }), () => {
        toast.success("Notebook moved to Trash");
        navigate("/drive");
      });
    }
  }

  return (
    <>
      <div className="flex items-center gap-1">
        <Menu
          ariaLabel="Add to notebook"
          trigger={
            <button type="button" className={buttonClasses("secondary", "xs")}>
              <Plus className="h-3.5 w-3.5" aria-hidden /> Add
            </button>
          }
        >
          {notebook.nextNote && (
            <Menu.Item
              icon={<FilePlus className="h-3.5 w-3.5" />}
              disabled={nextNote.pending}
              onSelect={nextNote.open}
            >
              Note for the next meeting
            </Menu.Item>
          )}
          <Menu.Item icon={<FileText className="h-3.5 w-3.5" />} onSelect={() => setPanel("add-document")}>
            Existing document…
          </Menu.Item>
        </Menu>
        <Menu
          align="right"
          ariaLabel="Notebook options"
          trigger={
            <button type="button" aria-label="Notebook options" className={buttonClasses("ghost", "xs")}>
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </button>
          }
        >
          <Menu.Item onSelect={() => setPanel("template")}>Set template…</Menu.Item>
          <Menu.Item onSelect={() => setPanel("merge")}>Merge into…</Menu.Item>
          <Menu.Item onSelect={() => void dissolve()}>Dissolve</Menu.Item>
          <Menu.Separator />
          <Menu.Item destructive onSelect={() => void trash()}>
            Move to Trash
          </Menu.Item>
        </Menu>
      </div>

      {panel === "add-document" && (
        <AddDocumentModal
          notebookId={notebook.id}
          onClose={() => setPanel(null)}
          onAdded={() => {
            setPanel(null);
            revalidator.revalidate();
          }}
        />
      )}
      {panel === "template" && (
        <SetTemplateModal
          notebook={notebook}
          onClose={() => setPanel(null)}
          onSaved={() => {
            setPanel(null);
            toast.success("Template updated");
            revalidator.revalidate();
          }}
        />
      )}
      {panel === "merge" && (
        <NotebookPicker
          open
          heading="Merge into"
          excludeId={notebook.id}
          projectId={notebook.projectId}
          onClose={() => setPanel(null)}
          onPick={async (target) => {
            setPanel(null);
            const ok = await dialog.confirm({
              title: `Merge into “${target.title}”?`,
              description: "Every note moves there and this notebook goes away. Meetings that file here will file there.",
              confirmLabel: "Merge",
            });
            if (ok) {
              await run(notebookRequest(notebook.id, { intent: "merge-into", targetId: target.id }), () => {
                toast.success(`Merged into ${target.title}`);
                navigate(`/documents/${target.id}`);
              });
            }
          }}
        />
      )}
    </>
  );
}

function AddDocumentModal({
  notebookId,
  onClose,
  onAdded,
}: {
  notebookId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const titleId = useId();
  const toast = useToast();
  const run = useNotebookRequest();
  const [options, setOptions] = useState<{ value: string; label: string; description?: string }[]>([]);

  async function search(query: string) {
    if (query.trim().length < 2) return;
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, { credentials: "include" });
      if (!res.ok) return;
      const json = (await res.json()) as {
        results: { type: string; id: string; title: string; subtitle?: string }[];
      };
      setOptions(
        json.results
          .filter((r) => r.type === "document")
          .map((r) => ({ value: r.id, label: r.title || "Untitled", description: r.subtitle })),
      );
    } catch {
      toast.error("Search failed");
    }
  }

  return (
    <Modal open onClose={onClose} labelledBy={titleId} containerClassName={modalCardClass("max-w-md")}>
      <ModalHeader titleId={titleId} title="Add an existing document" onClose={onClose} />
      <Combobox
        value=""
        options={options}
        ariaLabel="Search documents"
        placeholder="Search documents you can edit"
        emptyLabel="Type at least two letters to search"
        onQueryChange={(q) => void search(q)}
        onChange={(pageId) => void run(notebookRequest(notebookId, { intent: "add-page", pageId }), onAdded)}
      />
      <p className="mt-3 text-xs text-muted-foreground">
        The document keeps its content and becomes a tab of this notebook.
      </p>
    </Modal>
  );
}

function SetTemplateModal({
  notebook,
  onClose,
  onSaved,
}: {
  notebook: NotebookView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const titleId = useId();
  const run = useNotebookRequest();
  const { templates } = useNoteTemplates({ projectId: notebook.projectId });
  const [templateId, setTemplateId] = useState(notebook.templateId ?? "");
  const [saving, setSaving] = useState(false);

  return (
    <Modal open onClose={onClose} labelledBy={titleId} containerClassName={modalCardClass("max-w-md")}>
      <ModalHeader titleId={titleId} title="Notebook template" onClose={onClose} />
      <p className="mb-3 text-sm text-muted-foreground">New notes in this notebook start from this template.</p>
      <Select
        value={templateId}
        onChange={setTemplateId}
        ariaLabel="Notebook template"
        options={[{ value: "", label: "Default template" }, ...templates.map((t) => ({ value: t.id, label: t.title }))]}
      />
      <div className="mt-6 flex items-center justify-end gap-2">
        <button type="button" onClick={onClose} className={buttonClasses("ghost", "sm")}>
          Cancel
        </button>
        <button
          type="button"
          disabled={saving}
          className={buttonClasses("primary", "sm")}
          onClick={async () => {
            setSaving(true);
            const ok = await run(
              notebookRequest(notebook.id, { intent: "set-template", templatePageId: templateId || null }),
              onSaved,
            );
            if (!ok) setSaving(false);
          }}
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

function NotebookTitle({ notebook }: { notebook: NotebookView }) {
  const revalidator = useRevalidator();
  const run = useNotebookRequest();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notebook.title);

  useEffect(() => setDraft(notebook.title), [notebook.title]);

  async function commit() {
    setEditing(false);
    const next = draft.trim();
    if (!next || next === notebook.title) {
      setDraft(notebook.title);
      return;
    }
    const ok = await run(renameRequest(notebook.id, next), () => revalidator.revalidate());
    if (!ok) setDraft(notebook.title);
  }

  if (!notebook.canEdit) {
    return <p className="truncate px-2 text-sm font-semibold text-foreground">{notebook.title}</p>;
  }
  if (editing) {
    return (
      <input
        autoFocus
        aria-label="Notebook name"
        value={draft}
        maxLength={200}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(notebook.title);
            setEditing(false);
          }
        }}
        className="w-full min-w-0 rounded-md border border-border bg-background px-2 py-1 text-sm font-semibold text-foreground focus:border-accent-coral focus:outline-none"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Rename notebook"
      className="min-w-0 truncate rounded-md px-2 py-1 text-left text-sm font-semibold text-foreground transition-colors hover:bg-os-container"
    >
      {notebook.title}
    </button>
  );
}

function TabMenu({ notebook, tab }: { notebook: NotebookView; tab: NotebookTab }) {
  const dialog = useDialog();
  const toast = useToast();
  const revalidator = useRevalidator();
  const run = useNotebookRequest();

  async function detach() {
    const ok = await dialog.confirm({
      title: "Detach from the meeting?",
      description: `“${tab.label}” becomes a plain document in the folder this notebook is in. It leaves the notebook and is no longer that meeting's note.`,
      confirmLabel: "Detach",
    });
    if (ok) await run(detachRequest(tab.id), () => revalidator.revalidate());
  }

  async function remove() {
    const ok = await dialog.confirm({
      title: "Remove from the notebook?",
      description: `“${tab.label}” moves to the folder this notebook is in.`,
      confirmLabel: "Remove",
    });
    if (ok) {
      await run(removeFromNotebookRequest(tab.id, notebook), () => {
        toast.success("Removed from the notebook");
        revalidator.revalidate();
      });
    }
  }

  return (
    <Menu
      align="right"
      ariaLabel={`Options for ${tab.label}`}
      trigger={
        <button
          type="button"
          aria-label={`Options for ${tab.label}`}
          className="rounded-md p-1 text-os-grey transition-opacity hover:bg-os-container hover:text-foreground focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </button>
      }
    >
      {tab.isNote && <Menu.Item onSelect={() => void detach()}>Detach from meeting</Menu.Item>}
      <Menu.Item onSelect={() => void remove()}>Remove from notebook</Menu.Item>
    </Menu>
  );
}

// A notebook's notes as side tabs, the way a Google Doc lists its tabs: one
// document in the Drive, one tab per meeting.
export function NotebookRail({ notebook, currentId }: { notebook: NotebookView; currentId: string }) {
  const { card } = useOsChrome();
  return (
    <nav
      aria-label={notebook.title}
      className={cn(card, "flex min-w-0 shrink-0 flex-col gap-2 p-3 lg:sticky lg:top-4 lg:w-56")}
    >
      <NotebookTitle notebook={notebook} />
      <NotebookControls notebook={notebook} />
      <ul className="flex gap-1 overflow-x-auto lg:max-h-[70vh] lg:flex-col lg:overflow-y-auto">
        {notebook.tabs.map((tab) => {
          const current = tab.id === currentId;
          return (
            <li key={tab.id} className="group relative flex shrink-0 items-center gap-1">
              <Link
                to={`/documents/${tab.id}`}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "block min-w-0 flex-1 rounded-os-item px-2 py-1.5 text-sm transition-colors",
                  current
                    ? "bg-os-accent/15 text-os-accent"
                    : "text-os-grey hover:bg-os-container hover:text-foreground",
                )}
              >
                <span className="block truncate">{tab.label}</span>
                {tab.meeting && <span className="block truncate text-xs">{tab.meeting}</span>}
              </Link>
              {notebook.canEdit && <TabMenu notebook={notebook} tab={tab} />}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** One-note notebooks hide the rail, so this chip is where "add to existing" is
 *  discovered: it names the notebook and carries the same Add and ⋯ menus. */
export function NotebookChip({ notebook }: { notebook: NotebookView }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-os-grey" data-testid="notebook-chip">
      <BookOpen className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">
        In notebook <span className="font-medium text-foreground">{notebook.title}</span>
      </span>
      <NotebookControls notebook={notebook} />
    </div>
  );
}
