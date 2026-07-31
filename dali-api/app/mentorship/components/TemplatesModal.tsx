import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  FileText,
  Loader2,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Modal } from "~/components/Modal";
import { Tooltip } from "~/components/ui/IconButton";
import { RichTextEditor } from "~/components/RichTextEditor";

// Template management, moved out of the (removed) Templates subtab into a modal
// launched from the Mentorship notes subtab. Core-only — the caller gates the
// launch button, and the API re-checks Core on every mutation.
//
// Master-detail: the left rail lists templates (default pinned with a star),
// the right pane edits the selected one. The modal owns its own data — it fetches
// the list on open and each template's rich-text body on selection — so the host
// route's loader stays focused on notes.

type TemplateListItem = {
  id: string;
  name: string;
  isDefault: boolean;
};

const TITLE_ID = "mentorship-templates-modal-title";

export function TemplatesModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [templates, setTemplates] = useState<TemplateListItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async (): Promise<TemplateListItem[]> => {
    const res = await fetch("/api/mentorship/templates");
    if (!res.ok) return [];
    const data = (await res.json()) as { templates: TemplateListItem[] };
    setTemplates(data.templates);
    return data.templates;
  }, []);

  useEffect(() => {
    if (!open) return;
    setTemplates(null);
    setSelectedId(null);
    void loadList();
  }, [open, loadList]);

  async function createTemplate() {
    setBusy(true);
    try {
      const res = await fetch("/api/mentorship/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Untitled template",
          isDefault: (templates?.length ?? 0) === 0,
        }),
      });
      if (!res.ok) return;
      const { id } = (await res.json()) as { id: string };
      await loadList();
      setSelectedId(id);
    } finally {
      setBusy(false);
    }
  }

  async function makeDefault(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/mentorship/templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      await loadList();
    } finally {
      setBusy(false);
    }
  }

  async function deleteTemplate(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/mentorship/templates/${id}`, { method: "DELETE" });
      const next = await loadList();
      if (selectedId === id) {
        setSelectedId(null);
      } else if (selectedId && !next.some((t) => t.id === selectedId)) {
        setSelectedId(null);
      }
    } finally {
      setBusy(false);
    }
  }

  // Keep the rail label in sync as the editor renames, without a round-trip.
  function renameInList(id: string, name: string) {
    setTemplates((prev) =>
      prev ? prev.map((t) => (t.id === id ? { ...t, name } : t)) : prev,
    );
  }

  const selected = templates?.find((t) => t.id === selectedId) ?? null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={TITLE_ID}
      disableEscape={busy}
      containerClassName="bg-card rounded-2xl shadow-brand-2 w-full max-w-3xl h-[80vh] max-h-[calc(100vh-3rem)] my-auto flex flex-col overflow-hidden"
    >
      <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-border">
        <div>
          <h2
            id={TITLE_ID}
            className="font-heading text-lg font-bold text-foreground"
          >
            Note templates
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Every new mentor note starts from a template. The default is applied
            automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-muted-foreground/70 hover:text-foreground rounded p-1 hover:bg-muted"
        >
          <X className="w-5 h-5" aria-hidden />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div
          className={`w-full sm:w-60 shrink-0 flex-col border-border sm:border-r ${
            selectedId ? "hidden sm:flex" : "flex"
          }`}
        >
          <div className="p-3 border-b border-border">
            <button
              type="button"
              onClick={createTemplate}
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-accent-coral text-white text-sm hover:opacity-90 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" aria-hidden />
              New template
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2">
            {templates === null ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
              </div>
            ) : templates.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                No templates yet. The first one you create becomes the default.
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {templates.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      aria-current={selectedId === t.id}
                      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-left text-sm ${
                        selectedId === t.id
                          ? "bg-accent-coral/10 text-foreground"
                          : "text-foreground/80 hover:bg-muted"
                      }`}
                    >
                      {t.isDefault ? (
                        <Star
                          className="w-3.5 h-3.5 shrink-0 text-accent-coral fill-current"
                          aria-label="Default"
                        />
                      ) : (
                        <span className="w-3.5 shrink-0" aria-hidden />
                      )}
                      <span className="truncate">{t.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div
          className={`flex-1 min-w-0 flex-col ${
            selectedId ? "flex" : "hidden sm:flex"
          }`}
        >
          {selected ? (
            <TemplateDetail
              key={selected.id}
              id={selected.id}
              isDefault={selected.isDefault}
              busy={busy}
              onBack={() => setSelectedId(null)}
              onRename={(name) => renameInList(selected.id, name)}
              onMakeDefault={() => makeDefault(selected.id)}
              onDelete={() => deleteTemplate(selected.id)}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center">
              <FileText
                className="w-8 h-8 text-muted-foreground/50"
                aria-hidden
              />
              <p className="text-sm text-muted-foreground">
                Select a template to edit, or create a new one.
              </p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

function TemplateDetail({
  id,
  isDefault,
  busy,
  onBack,
  onRename,
  onMakeDefault,
  onDelete,
}: {
  id: string;
  isDefault: boolean;
  busy: boolean;
  onBack: () => void;
  onRename: (name: string) => void;
  onMakeDefault: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState("");
  const [content, setContent] = useState<unknown>(null);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const timer = useRef<number | null>(null);
  const skipNextSave = useRef(true);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    fetch(`/api/mentorship/templates/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((tpl: { name: string; contentJson: unknown } | null) => {
        if (cancelled || !tpl) return;
        skipNextSave.current = true;
        setName(tpl.name);
        setContent(tpl.contentJson);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Debounced autosave, mirroring the note editor. The hydration render is
  // skipped so opening a template never writes it straight back.
  useEffect(() => {
    if (!loaded) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setStatus("saving");
      try {
        const res = await fetch(`/api/mentorship/templates/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, contentJson: content }),
        });
        if (!res.ok) throw new Error("save failed");
        setStatus("saved");
      } catch {
        setStatus("error");
      }
    }, 800);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [name, content, loaded, id]);

  if (!loaded) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-2 px-4 sm:px-5 py-3 border-b border-border">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to templates"
          className="sm:hidden text-muted-foreground hover:text-foreground rounded p-1 hover:bg-muted"
        >
          <ChevronLeft className="w-5 h-5" aria-hidden />
        </button>
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            onRename(e.target.value);
          }}
          aria-label="Template name"
          placeholder="Template name"
          className="flex-1 min-w-0 font-heading text-base font-semibold text-foreground bg-transparent border-b border-transparent focus:outline-none focus:border-accent-coral"
        />
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {status === "saving"
            ? "Saving…"
            : status === "saved"
            ? "Saved"
            : status === "error"
            ? "Couldn't save"
            : ""}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5">
        <RichTextEditor
          value={content}
          onChange={setContent}
          enableImages
          placeholder="Sections, prompts, and headings the mentor fills in each week…"
          className="min-h-[12rem]"
        />
      </div>

      <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-t border-border">
        {isDefault ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Star
              className="w-3.5 h-3.5 text-accent-coral fill-current"
              aria-hidden
            />
            Applied to every new note
          </span>
        ) : (
          <button
            type="button"
            onClick={onMakeDefault}
            disabled={busy}
            className="text-sm text-accent-coral hover:underline disabled:opacity-50"
          >
            Make default
          </button>
        )}

        {confirmingDelete ? (
          <span className="inline-flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Delete this template?</span>
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              className="text-accent-coral hover:underline disabled:opacity-50"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </span>
        ) : (
          <Tooltip label="Delete">
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              aria-label="Delete"
              className="inline-flex items-center justify-center p-1.5 text-sm text-muted-foreground hover:text-accent-coral"
            >
              <Trash2 className="w-4 h-4" aria-hidden />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
