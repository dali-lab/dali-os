import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Modal, ModalHeader, ModalFooter } from "~/components/Modal";

type Candidate = { userId: string; name: string; email: string | null };

// Adds an external mentor to a project column: pick an existing DALI member
// (searched from the staffable pool, excluding this project's own roster) and a
// domain. On success the board refetches and the new card appears.
export function AddExternalMentorModal({
  open,
  onClose,
  cycleId,
  projectId,
  projectName,
  domains,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  cycleId: string;
  projectId: string;
  projectName: string;
  domains: { id: string; name: string }[];
  onAdded: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [domainId, setDomainId] = useState(domains[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Debounced member search (min 2 chars). Skipped once a member is selected.
  useEffect(() => {
    if (selected) return;
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/staffing/external-mentor?cycleId=${encodeURIComponent(cycleId)}&projectId=${encodeURIComponent(projectId)}&q=${encodeURIComponent(query)}`,
          { credentials: "include", signal: ctrl.signal },
        );
        const json = (await res.json().catch(() => ({}))) as { results?: Candidate[] };
        setResults(json.results ?? []);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError("Search failed");
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, selected, cycleId, projectId]);

  const canSubmit = selected && domainId && !busy;

  async function submit() {
    if (!canSubmit || !selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/staffing/external-mentor", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycleId, projectId, domainId, userId: selected.userId }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(d?.error ?? "Couldn't add the mentor. Try again.");
        return;
      }
      onAdded();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="add-external-mentor-title"
      initialFocusRef={searchRef}
      disableEscape={busy}
    >
      <ModalHeader
        titleId="add-external-mentor-title"
        title="Add external mentor"
        subtitle={`Mentors ${projectName}'s team in one domain`}
        onClose={onClose}
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Member</span>
          {selected ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2 py-1.5">
              <div className="min-w-0">
                <div className="text-sm text-foreground truncate">{selected.name}</div>
                {selected.email && (
                  <div className="text-[11px] text-muted-foreground truncate">{selected.email}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  setQ("");
                }}
                aria-label="Clear selected member"
                className="flex-shrink-0 text-muted-foreground hover:text-foreground rounded p-0.5 hover:bg-muted"
              >
                <X className="w-4 h-4" aria-hidden />
              </button>
            </div>
          ) : (
            <>
              <input
                ref={searchRef}
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search members by name or email…"
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              />
              {(loading || results.length > 0 || q.trim().length >= 2) && (
                <div className="mt-1 max-h-56 overflow-y-auto flex flex-col gap-0.5 rounded-md border border-border bg-card p-1">
                  {loading && <p className="text-xs text-muted-foreground px-1 py-1">Searching…</p>}
                  {!loading && q.trim().length >= 2 && results.length === 0 && (
                    <p className="text-xs text-muted-foreground px-1 py-1">No members found.</p>
                  )}
                  {results.map((r) => (
                    <button
                      key={r.userId}
                      type="button"
                      onClick={() => setSelected(r)}
                      className="text-left px-2 py-1.5 rounded hover:bg-muted flex flex-col"
                    >
                      <span className="text-sm text-foreground">{r.name}</span>
                      {r.email && <span className="text-[11px] text-muted-foreground">{r.email}</span>}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Domain</span>
          <select
            value={domainId}
            onChange={(e) => setDomainId(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          >
            {domains.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <ModalFooter onCancel={onClose}>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="px-3 py-1.5 text-sm rounded-lg bg-accent-coral text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add mentor"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
