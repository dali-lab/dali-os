import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Modal } from "~/components/Modal";
import { useDialog } from "~/components/ui/dialog";
import { Tooltip, InfoTip } from "~/components/ui/floating";
import { relativeTime } from "~/lib/relative-time";

interface Author {
  id: string;
  name: string;
}

interface VersionListItem {
  id: string;
  createdAt: string;
  plainTextPreview: string;
  authors: Author[];
}

interface VersionDetail {
  id: string;
  createdAt: string;
  plainText: string;
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

export function VersionHistoryPanel({ documentName, onClose }: VersionHistoryPanelProps) {
  const dialog = useDialog();
  const [versions, setVersions] = useState<VersionListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VersionDetail | null>(null);
  const [restoring, setRestoring] = useState(false);
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
              <InfoTip content="Snapshots are saved automatically every ~30 seconds while the document is being edited. Restoring a version replaces the current content for all viewers." />
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
            {versions?.map((v) => {
              const isSelected = v.id === selectedId;
              return (
                <Tooltip
                  key={v.id}
                  content={new Date(v.createdAt).toLocaleString()}
                  placement="right"
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(v.id)}
                    className={`w-full text-left px-4 py-3 border-b border-border hover:bg-muted/50 ${
                      isSelected ? "bg-accent-coral/5 hover:bg-accent-coral/5" : ""
                    }`}
                  >
                    <div className="text-xs font-medium text-foreground">
                      {relativeTime(v.createdAt)}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {authorLabel(v.authors)}
                    </div>
                    {v.plainTextPreview && (
                      <div className="text-xs text-muted-foreground mt-1 line-clamp-2 whitespace-pre-wrap">
                        {v.plainTextPreview}
                      </div>
                    )}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </div>

        {/* Right: preview + restore */}
        <div className="flex-1 flex flex-col">
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
              <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                <div>
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
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-accent-coral rounded hover:bg-accent-coral/90 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {restoring ? "Restoring..." : "Restore this version"}
                    </button>
                  </span>
                </Tooltip>
              </div>
              <div className="flex-1 overflow-y-auto p-6 whitespace-pre-wrap text-sm text-foreground font-mono leading-relaxed">
                {detail.plainText || (
                  <span className="text-muted-foreground/70 italic">(empty)</span>
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
