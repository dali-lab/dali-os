import { useEffect } from "react";
import { useFetcher } from "react-router";
import { Select } from "~/components/ui/floating/Select";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { Folder, ExternalLink, Plus, X, AlertTriangle } from "lucide-react";

// The "Drive folders" settings section: lists a process's folder bindings (see
// app/lib/bindings.server.ts) and lets a manager repoint / create / clear each.
// Self-contained — it loads its own data from /api/folder-bindings via a
// fetcher, so mounting it is a one-liner in any settings surface (no page-loader
// plumbing). "Binding" here = which folder auto-files land in; a folder's ACCESS
// is a separate control (open the folder → Share).

type ProcessType = "Project" | "EducationOffering" | "HiringCycle" | "Core";

type Row = {
  purpose: string;
  label: string;
  folderPageId: string | null;
  folderTitle: string | null;
  missing: boolean;
};
type Candidate = { id: string; title: string };
type LoaderData = { processType: string; processId: string; rows: Row[]; candidates: Candidate[] };

const NOUN: Record<ProcessType, string> = {
  Project: "project",
  EducationOffering: "offering",
  HiringCycle: "hiring cycle",
  Core: "Core area",
};

export function DriveFolderBindings({
  processType,
  processId = "",
  className,
}: {
  processType: ProcessType;
  processId?: string;
  className?: string;
}) {
  const enabled = useFeatureFlag("drive-folder-bindings");
  const data = useFetcher<LoaderData>();
  const mut = useFetcher<{ ok?: boolean; error?: string }>();

  // Load on mount, and reload after each successful mutation so rows reflect the
  // new binding immediately. Skips entirely while the flag is off.
  useEffect(() => {
    if (!enabled) return;
    const params = new URLSearchParams({ processType, processId });
    data.load(`/api/folder-bindings?${params.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, processType, processId, mut.data]);

  if (!enabled) return null;

  const submit = (payload: Record<string, unknown>) =>
    mut.submit(
      { processType, processId, ...payload },
      { method: "POST", encType: "application/json", action: "/api/folder-bindings" },
    );

  const rows = data.data?.rows ?? [];
  const candidates = data.data?.candidates ?? [];
  const busy = mut.state !== "idle";

  return (
    <div className={className ?? "border-t border-border pt-5 mt-2"}>
      <h3 className="text-sm font-semibold text-gray-900">Drive folders</h3>
      <p className="mt-1 text-xs text-gray-500">
        Where this {NOUN[processType]}&rsquo;s items are auto-filed.
      </p>

      {data.state === "loading" && !data.data ? (
        <p className="mt-3 text-xs text-gray-400">Loading…</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {rows.map((row) => (
            <li key={row.purpose} className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-gray-700">{row.label}</span>
              <div className="flex flex-wrap items-center gap-2">
                {row.folderPageId ? (
                  <a
                    href={`/documents/${row.folderPageId}`}
                    className="inline-flex items-center gap-1.5 rounded-md bg-gray-50 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                  >
                    <Folder className="h-3.5 w-3.5 text-gray-400" />
                    {row.folderTitle ?? "Folder"}
                    <ExternalLink className="h-3 w-3 text-gray-400" />
                  </a>
                ) : row.missing ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-amber-600">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Folder was deleted
                  </span>
                ) : (
                  <span className="text-xs text-gray-400">— not set —</span>
                )}

                <div className="ml-auto flex items-center gap-1.5">
                  {busy && <span className="text-xs text-gray-400">Saving…</span>}
                  {candidates.length > 0 && (
                    <Select
                      value=""
                      options={[
                        { value: "", label: row.folderPageId ? "Change…" : "Choose existing…" },
                        ...candidates.map((c) => ({ value: c.id, label: c.title })),
                      ]}
                      onChange={(v) =>
                        v && submit({ purpose: row.purpose, intent: "set", folderPageId: v })
                      }
                    />
                  )}
                  {/* Create a fresh folder only when nothing is bound — avoids the
                      old "Replace" button silently spawning a new empty folder. */}
                  {!row.folderPageId && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => submit({ purpose: row.purpose, intent: "create" })}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <Plus className="h-3 w-3" />
                      Create folder
                    </button>
                  )}
                  {(row.folderPageId || row.missing) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => submit({ purpose: row.purpose, intent: "clear" })}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <X className="h-3 w-3" />
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {mut.data?.error && <p className="mt-2 text-xs text-red-600">{mut.data.error}</p>}
    </div>
  );
}
