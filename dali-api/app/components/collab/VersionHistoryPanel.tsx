import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

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

const RTF = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return RTF.format(-diffSec, "second");
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return RTF.format(-diffMin, "minute");
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return RTF.format(-diffHr, "hour");
  const diffDay = Math.round(diffHr / 24);
  return RTF.format(-diffDay, "day");
}

function authorLabel(authors: Author[]): string {
  if (authors.length === 0) return "Unknown editor";
  if (authors.length === 1) return authors[0]!.name;
  if (authors.length === 2) return `${authors[0]!.name} & ${authors[1]!.name}`;
  return `${authors[0]!.name} & ${authors.length - 1} others`;
}

export function VersionHistoryPanel({ documentName, onClose }: VersionHistoryPanelProps) {
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
      !window.confirm(
        "Restore this version? This will replace the current content for all viewers.",
      )
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
  }, [selectedId, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl border border-gray-200 w-[min(900px,92vw)] h-[min(640px,86vh)] flex overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: version list */}
        <div className="w-72 border-r border-gray-200 flex flex-col">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50">
            <h2 className="text-sm font-semibold text-gray-900">Version history</h2>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {versions === null && !error && (
              <div className="p-4 text-sm text-gray-500">Loading...</div>
            )}
            {versions !== null && versions.length === 0 && (
              <div className="p-4 text-sm text-gray-500">
                No saved versions yet. Edits are snapshotted every ~30 seconds.
              </div>
            )}
            {versions?.map((v) => {
              const isSelected = v.id === selectedId;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelectedId(v.id)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 ${
                    isSelected ? "bg-blue-50 hover:bg-blue-50" : ""
                  }`}
                  title={new Date(v.createdAt).toLocaleString()}
                >
                  <div className="text-xs font-medium text-gray-900">
                    {relativeTime(v.createdAt)}
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    {authorLabel(v.authors)}
                  </div>
                  {v.plainTextPreview && (
                    <div className="text-xs text-gray-600 mt-1 line-clamp-2 whitespace-pre-wrap">
                      {v.plainTextPreview}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: preview + restore */}
        <div className="flex-1 flex flex-col">
          {selectedId === null ? (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
              Select a version to preview.
            </div>
          ) : detail === null ? (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
              Loading...
            </div>
          ) : (
            <>
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-gray-900">
                    {new Date(detail.createdAt).toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {authorLabel(detail.authors)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRestore}
                  disabled={restoring}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {restoring ? "Restoring..." : "Restore this version"}
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 whitespace-pre-wrap text-sm text-gray-800 font-mono leading-relaxed">
                {detail.plainText || (
                  <span className="text-gray-400 italic">(empty)</span>
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
      </div>
    </div>
  );
}
