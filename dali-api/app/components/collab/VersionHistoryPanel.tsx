import { useCallback, useEffect, useRef, useState } from "react";
import { X, Tag, Pencil, Check, X as XIcon } from "lucide-react";
import { Modal } from "~/components/Modal";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { Tooltip, InfoTip } from "~/components/ui/floating";
import { relativeTime } from "~/lib/relative-time";

interface Author {
  id: string;
  name: string;
}

interface VersionListItem {
  id: string;
  createdAt: string;
  label: string | null;
  plainTextPreview: string;
  authors: Author[];
}

interface VersionDetail {
  id: string;
  createdAt: string;
  label: string | null;
  plainText: string;
  html: string;
  authors: Author[];
}

interface VersionHistoryPanelProps {
  documentName: string;
  onClose: () => void;
}

const POLL_INTERVAL_MS = 30_000;

function authorLabel(authors: Author[]): string {
  if (authors.length === 0) return "Unknown editor";
  if (authors.length === 1) return authors[0]!.name;
  if (authors.length === 2) return `${authors[0]!.name} & ${authors[1]!.name}`;
  return `${authors[0]!.name} & ${authors.length - 1} others`;
}

// Inline label editor shown when the user clicks the pencil/tag button on a
// version row. Submits on Enter or the checkmark; cancels on Escape or the X.
function InlineLabelEditor({
  initialValue,
  onSave,
  onCancel,
}: {
  initialValue: string;
  onSave: (label: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onSave(value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="flex items-center gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Name this version…"
        maxLength={200}
        className="flex-1 text-xs border border-border rounded px-1.5 py-0.5 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-accent-coral/50 min-w-0"
      />
      <button
        type="button"
        onClick={() => onSave(value)}
        className="text-green-600 hover:text-green-700 rounded p-0.5 hover:bg-muted"
        aria-label="Save name"
      >
        <Check className="w-3 h-3" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="text-muted-foreground hover:text-foreground rounded p-0.5 hover:bg-muted"
        aria-label="Cancel"
      >
        <XIcon className="w-3 h-3" aria-hidden />
      </button>
    </div>
  );
}

export function VersionHistoryPanel({ documentName, onClose }: VersionHistoryPanelProps) {
  const dialog = useDialog();
  const toast = useToast();
  const [versions, setVersions] = useState<VersionListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VersionDetail | null>(null);
  const [restoring, setRestoring] = useState(false);
  // Track which version row is being inline-edited (null = none).
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchList = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/collab/versions?name=${encodeURIComponent(documentName)}`,
        { credentials: "same-origin" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as VersionListItem[];
      setVersions(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history");
    }
  }, [documentName]);

  // Initial load + light polling so newly-written snapshots show up while
  // the panel is open.
  useEffect(() => {
    fetchList();
    const t = setInterval(fetchList, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [fetchList]);

  // Fetch full content when a version is selected. Aborts any in-flight
  // request when the selection changes so out-of-order responses can't
  // overwrite the current preview.
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setDetail(null);
    fetch(`/api/collab/versions/${selectedId}`, {
      credentials: "same-origin",
      signal: ctrl.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: VersionDetail) => setDetail(d))
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => ctrl.abort();
  }, [selectedId]);

  const handleRestore = useCallback(async () => {
    if (!selectedId) return;
    if (
      !(await dialog.confirm({
        title: "Restore this version?",
        description: "This will replace the current content for all viewers.",
        confirmLabel: "Restore",
      }))
    ) {
      return;
    }
    setRestoring(true);
    try {
      const res = await fetch(`/api/collab/versions/${selectedId}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "restore" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setRestoring(false);
    }
  }, [selectedId, onClose, dialog]);

  // POST label to the server, then refresh the list and detail (if selected).
  const handleSaveLabel = useCallback(
    async (versionId: string, label: string) => {
      setEditingLabelId(null);
      try {
        const res = await fetch(`/api/collab/versions/${versionId}`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intent: "name", label }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { label: saved } = (await res.json()) as { label: string | null };
        // Optimistically update the list so the UI reflects the change
        // without waiting for the next poll cycle.
        setVersions((prev) =>
          prev
            ? prev.map((v) => (v.id === versionId ? { ...v, label: saved } : v))
            : prev,
        );
        if (detail?.id === versionId) {
          setDetail((prev) => (prev ? { ...prev, label: saved } : prev));
        }
        toast.success(saved ? "Version named." : "Name cleared.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save name");
      }
    },
    [detail, toast],
  );

  // Split versions into named (pinned) and auto sections for the list.
  const namedVersions = versions?.filter((v) => v.label !== null) ?? [];
  const autoVersions = versions?.filter((v) => v.label === null) ?? [];

  function renderVersionRow(v: VersionListItem) {
    const isSelected = v.id === selectedId;
    const isEditingLabel = editingLabelId === v.id;

    return (
      <Tooltip
        key={v.id}
        content={new Date(v.createdAt).toLocaleString()}
        placement="right"
      >
        <div
          className={`w-full text-left px-4 py-3 border-b border-border hover:bg-muted/50 cursor-pointer group ${
            isSelected ? "bg-accent-coral/5 hover:bg-accent-coral/5" : ""
          }`}
          onClick={() => {
            if (!isEditingLabel) setSelectedId(v.id);
          }}
        >
          <div className="flex items-start justify-between gap-1">
            <div className="flex-1 min-w-0">
              {v.label && (
                <div className="text-xs font-semibold text-accent-coral flex items-center gap-1 mb-0.5 truncate">
                  <Tag className="w-3 h-3 shrink-0" aria-hidden />
                  {v.label}
                </div>
              )}
              <div className="text-xs font-medium text-foreground">
                {relativeTime(v.createdAt)}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {authorLabel(v.authors)}
              </div>
            </div>
            {/* Label edit button — visible on hover or when this row is selected */}
            <Tooltip content={v.label ? "Rename version" : "Name this version"} placement="right">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingLabelId(isEditingLabel ? null : v.id);
                }}
                className={`shrink-0 p-0.5 rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity ${
                  isEditingLabel || v.label ? "opacity-100" : ""
                } ${isSelected ? "opacity-100" : ""}`}
                aria-label={v.label ? "Rename version" : "Name this version"}
              >
                <Pencil className="w-3 h-3" aria-hidden />
              </button>
            </Tooltip>
          </div>
          {isEditingLabel ? (
            <InlineLabelEditor
              initialValue={v.label ?? ""}
              onSave={(label) => handleSaveLabel(v.id, label)}
              onCancel={() => setEditingLabelId(null)}
            />
          ) : (
            v.plainTextPreview && (
              <div className="text-xs text-muted-foreground mt-1 line-clamp-2 whitespace-pre-wrap">
                {v.plainTextPreview}
              </div>
            )
          )}
        </div>
      </Tooltip>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="version-history-title"
      disableEscape={restoring}
      containerClassName="bg-card rounded-xl shadow-2xl border border-border w-[min(900px,92vw)] h-[min(640px,86vh)] flex overflow-hidden"
    >
      <>
        {/* Left: version list */}
        <div className="w-72 border-r border-border flex flex-col">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-muted/50">
            <h2 id="version-history-title" className="text-sm font-semibold text-foreground inline-flex items-center gap-1">
              Version history
              <InfoTip content="Snapshots are saved automatically every ~30 seconds while the document is being edited. Restoring a version replaces the current content for all viewers. Name a version to pin it." />
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground/70 hover:text-foreground rounded p-1 hover:bg-muted"
              aria-label="Close"
            >
              <X className="w-5 h-5" aria-hidden />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {versions === null && !error && (
              <div className="p-4 text-sm text-muted-foreground">Loading...</div>
            )}
            {versions !== null && versions.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground">
                No saved versions yet. Edits are snapshotted every ~30 seconds.
              </div>
            )}
            {/* Named / pinned versions section */}
            {namedVersions.length > 0 && (
              <>
                <div className="px-4 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30 border-b border-border">
                  Named versions
                </div>
                {namedVersions.map(renderVersionRow)}
              </>
            )}
            {/* Auto-snapshots section */}
            {autoVersions.length > 0 && (
              <>
                {namedVersions.length > 0 && (
                  <div className="px-4 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30 border-b border-border">
                    Auto-saved
                  </div>
                )}
                {autoVersions.map(renderVersionRow)}
              </>
            )}
          </div>
        </div>

        {/* Right: preview + restore */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedId === null ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground/70">
              Select a version to preview.
            </div>
          ) : detail === null ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground/70">
              Loading...
            </div>
          ) : (
            <>
              <div className="px-6 py-4 border-b border-border flex items-center justify-between gap-4 shrink-0">
                <div className="min-w-0">
                  {detail.label && (
                    <div className="text-xs font-semibold text-accent-coral flex items-center gap-1 mb-0.5">
                      <Tag className="w-3 h-3 shrink-0" aria-hidden />
                      {detail.label}
                    </div>
                  )}
                  <div className="text-sm font-semibold text-foreground">
                    {new Date(detail.createdAt).toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {authorLabel(detail.authors)}
                  </div>
                </div>
                <Tooltip
                  content={restoring ? "Restore in progress — please wait." : undefined}
                  variant="rich"
                >
                  <span>
                    <button
                      type="button"
                      onClick={handleRestore}
                      disabled={restoring}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-accent-coral rounded hover:bg-accent-coral/90 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                    >
                      {restoring ? "Restoring..." : "Restore this version"}
                    </button>
                  </span>
                </Tooltip>
              </div>
              {/* Rich HTML preview — uses blocknote/prose container for on-brand
                  rendering; falls back to monospace plainText if html is empty. */}
              <div className="flex-1 overflow-y-auto p-6">
                {detail.html ? (
                  <div
                    className="bn-container prose prose-sm max-w-none text-foreground"
                    // The html is server-generated from trusted Y.Doc state — not
                    // user-typed freeform input — so XSS risk is equivalent to
                    // the existing export/preview paths.
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: detail.html }}
                  />
                ) : detail.plainText ? (
                  <div className="whitespace-pre-wrap text-sm text-foreground font-mono leading-relaxed">
                    {detail.plainText}
                  </div>
                ) : (
                  <span className="text-muted-foreground/70 italic text-sm">(empty)</span>
                )}
              </div>
            </>
          )}
          {error && (
            <div className="px-6 py-2 text-xs text-red-600 border-t border-red-100 bg-red-50">
              {error}
            </div>
          )}
        </div>
      </>
    </Modal>
  );
}
