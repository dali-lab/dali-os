import { LayoutTemplate } from "lucide-react";
import { useState, useCallback, useEffect, useRef, useId } from "react";
import { Modal } from "~/components/Modal";


// Page templates only — email/signing/mentor template systems stay in their
// admin homes. Opens as a modal so it doesn't require a submenu.
// Where a "From template" create lands: whichever scope you're browsing,
// wherever the template itself lives.
export type TemplateTarget = {
  targetWorkspaceType: "Lab" | "Project";
  targetWorkspaceId?: string;
  targetParentPageId?: string;
};

export type TemplateRow = { id: string; title: string; iconEmoji: string | null };

export function TemplatePicker({
  open,
  onClose,
  target,
}: {
  open: boolean;
  onClose: () => void;
  target: TemplateTarget;
}) {
  const titleId = useId();
  const [mineTemplates, setMineTemplates] = useState<TemplateRow[]>([]);
  const [labTemplates, setLabTemplates] = useState<TemplateRow[]>([]);
  const [scopeTemplates, setScopeTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  // Last workspace scope we loaded for, so reopening after a scope change
  // refetches while StrictMode's double-invoke (same key) is deduped.
  const loadedKey = useRef<string | null>(null);

  const scopeProjectId =
    target.targetWorkspaceType === "Project" ? target.targetWorkspaceId ?? null : null;

  const onModalOpen = useCallback(async () => {
    const key = scopeProjectId ?? "lab";
    if (loadedKey.current === key) return;
    loadedKey.current = key;
    setLoading(true);
    setError(null);
    try {
      const load = async (qs: string) => {
        const res = await fetch(`/api/page-templates?${qs}`, { credentials: "include" });
        if (!res.ok) throw new Error("Failed to load templates");
        const data = (await res.json()) as { templates: TemplateRow[] };
        return data.templates;
      };
      const [mine, lab, scope] = await Promise.all([
        load("workspaceType=Member"),
        load("workspaceType=Lab"),
        scopeProjectId ? load(`workspaceType=Project&workspaceId=${scopeProjectId}`) : Promise.resolve([]),
      ]);
      setMineTemplates(mine);
      setLabTemplates(lab);
      setScopeTemplates(scope);
    } catch (err) {
      loadedKey.current = null; // allow a retry on reopen
      setError(err instanceof Error ? err.message : "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, [scopeProjectId]);

  useEffect(() => {
    if (open) void onModalOpen();
  }, [open, onModalOpen]);

  const groups = [
    { label: "Your templates", rows: mineTemplates },
    { label: "This project", rows: scopeTemplates },
    { label: "Lab", rows: labTemplates },
  ].filter((g) => g.rows.length > 0);

  async function selectTemplate(templateId: string) {
    setCreating(templateId);
    try {
      const res = await fetch("/api/page-templates", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templatePageId: templateId, ...target }),
      });
      if (!res.ok) throw new Error("Failed to create from template");
      const { id } = await res.json() as { id: string };
      window.location.assign(`/documents/${id}`);
    } catch {
      setCreating(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId}>
      <h2 id={titleId} className="text-base font-semibold text-foreground mb-4">
        From template
      </h2>
      {loading && (
        <p className="text-sm text-muted-foreground py-6 text-center">Loading templates…</p>
      )}
      {error && (
        <p className="text-sm text-destructive py-2">{error}</p>
      )}
      {!loading && !error && groups.length === 0 && (
        <p className="text-sm text-muted-foreground italic py-4 text-center">
          No page templates are available yet.
        </p>
      )}
      {!loading && groups.length > 0 && (
        <div className="flex flex-col gap-3 max-h-72 overflow-y-auto -mx-1 px-1">
          {groups.map((g) => (
            <TemplateGroup
              key={g.label}
              label={groups.length > 1 ? g.label : null}
              rows={g.rows}
              creating={creating}
              onSelect={selectTemplate}
            />
          ))}
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md hover:bg-muted/40 transition-colors"
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export function TemplateGroup({
  label,
  rows,
  creating,
  onSelect,
}: {
  label: string | null;
  rows: TemplateRow[];
  creating: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <p className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
      )}
      <ul className="flex flex-col gap-1.5">
        {rows.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              disabled={creating !== null}
              onClick={() => void onSelect(t.id)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-muted/60 transition-colors disabled:opacity-50"
            >
              {t.iconEmoji ? (
                <span className="text-base leading-none shrink-0">{t.iconEmoji}</span>
              ) : (
                <LayoutTemplate className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
              <span className="text-sm font-medium text-foreground truncate">
                {t.title || "Untitled template"}
              </span>
              {creating === t.id && (
                <span className="ml-auto text-xs text-muted-foreground shrink-0">Creating…</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── File upload helper ─────────────────────────────────────────────────────────

// The upload flow (presign → PUT S3 → POST /api/drive/files) lives in the shared
// hook so the project-embedded Drive uploads through the exact same path.

// ── Browse scope section ───────────────────────────────────────────────────────

// ── Per-scope actions (create / rename / move / delete) ──────────────────────
//
// Each scope routes its writes to the right endpoint: My Drive → /api/notes
// (personal notes), Lab → /api/lab-documents, Project → /api/projects/:id/
// documents. Files use /api/files/:id; files & forms move via /api/drive/move.
// One factory keeps the branching in a single place, shared by the New menu and
// the row "⋯" menu.
