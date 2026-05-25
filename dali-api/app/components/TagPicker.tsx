import { useEffect, useRef, useState } from "react";
import { X, Plus, Check } from "lucide-react";

export type DocTag = { id: string; label: string; slug: string; color: string | null };

// Reusable lab-tag editor for a document (Page) or file (ProjectFile). Applied
// tags render as removable chips; a "+ Tag" popover lists the lab-wide active
// set, and Core users can create a new lab tag inline. All writes go through
// /api/doctags{,/apply}; the component keeps optimistic local state and calls
// onChange so the host can refresh counts if it wants.
export function TagPicker({
  targetType,
  targetId,
  applied: appliedProp,
  allTags: allTagsProp,
  canEdit,
  canCreate,
  onChange,
}: {
  targetType: "doc" | "file";
  targetId: string;
  applied: DocTag[];
  allTags: DocTag[];
  canEdit: boolean;
  // Core-only: may create brand-new lab tags from the popover.
  canCreate: boolean;
  onChange?: () => void;
}) {
  const [applied, setApplied] = useState<DocTag[]>(appliedProp);
  const [allTags, setAllTags] = useState<DocTag[]>(allTagsProp);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const popRef = useRef<HTMLDivElement | null>(null);

  // Keep in sync if the host re-renders with fresh server data.
  useEffect(() => setApplied(appliedProp), [appliedProp]);
  useEffect(() => setAllTags(allTagsProp), [allTagsProp]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const appliedIds = new Set(applied.map((t) => t.id));
  const available = allTags.filter((t) => !appliedIds.has(t.id));

  async function apply(tag: DocTag, op: "add" | "remove") {
    setBusy(true);
    setError(null);
    // Optimistic.
    setApplied((cur) =>
      op === "add" ? [...cur, tag].sort((a, b) => a.label.localeCompare(b.label)) : cur.filter((t) => t.id !== tag.id),
    );
    try {
      const res = await fetch("/api/doctags/apply", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType, targetId, tagId: tag.id, op }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Failed");
      }
      onChange?.();
    } catch (e) {
      // Revert on failure.
      setApplied((cur) =>
        op === "add" ? cur.filter((t) => t.id !== tag.id) : [...cur, tag].sort((a, b) => a.label.localeCompare(b.label)),
      );
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function createTag() {
    const label = newLabel.trim();
    if (!label) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/doctags", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const b = (await res.json().catch(() => ({}))) as DocTag & { error?: string };
      if (!res.ok) throw new Error(b.error ?? "Failed to create tag");
      setAllTags((cur) =>
        cur.some((t) => t.id === b.id) ? cur : [...cur, b].sort((a, b2) => a.label.localeCompare(b2.label)),
      );
      setNewLabel("");
      await apply(b, "add");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create tag");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {applied.map((t) => (
        <span
          key={t.id}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-accent-teal/10 text-accent-teal border border-accent-teal/20"
        >
          {t.label}
          {canEdit && (
            <button
              type="button"
              disabled={busy}
              onClick={() => apply(t, "remove")}
              className="hover:text-foreground disabled:opacity-50"
              aria-label={`Remove ${t.label}`}
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </span>
      ))}

      {applied.length === 0 && !canEdit && (
        <span className="text-xs text-muted-foreground italic">No tags</span>
      )}

      {canEdit && (
        <div className="relative" ref={popRef}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
          >
            <Plus className="w-3 h-3" /> Tag
          </button>

          {open && (
            <div className="absolute z-20 mt-1 w-56 max-h-72 overflow-auto rounded-md border border-border bg-card shadow-lg p-1.5">
              {error && (
                <div className="px-2 py-1 text-[11px] text-destructive">{error}</div>
              )}
              {available.length === 0 ? (
                <p className="px-2 py-1 text-xs text-muted-foreground italic">
                  {allTags.length === 0 ? "No lab tags yet." : "All tags applied."}
                </p>
              ) : (
                available.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    disabled={busy}
                    onClick={() => apply(t, "add")}
                    className="w-full text-left px-2 py-1 text-xs rounded hover:bg-muted disabled:opacity-50 flex items-center justify-between"
                  >
                    {t.label}
                    <Check className="w-3 h-3 opacity-0" />
                  </button>
                ))
              )}

              {canCreate && (
                <div className="mt-1 pt-1.5 border-t border-border flex items-center gap-1">
                  <input
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void createTag();
                      }
                    }}
                    placeholder="New lab tag…"
                    className="flex-1 px-2 py-1 text-xs border border-border rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-accent-coral/40"
                  />
                  <button
                    type="button"
                    disabled={busy || !newLabel.trim()}
                    onClick={() => void createTag()}
                    className="px-2 py-1 text-xs rounded bg-accent-coral text-white disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
