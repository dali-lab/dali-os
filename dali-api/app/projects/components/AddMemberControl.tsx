import { useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { UserPlus } from "lucide-react";

type Candidate = { userId: string; name: string; email: string | null };

// "Add member" search-and-add control for the staffing board. Lets a staffing
// lead place a DALI member who never bid onto the board as an Unassigned card.
// Searches /api/staffing/board-member (debounced); POSTing adds the member and
// revalidates the route so the new card appears.
export function AddMemberControl({ cycleId }: { cycleId: string }) {
  const revalidator = useRevalidator();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Debounced search whenever the query changes (min 2 chars).
  useEffect(() => {
    if (!open) return;
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
          `/api/staffing/board-member?cycleId=${encodeURIComponent(cycleId)}&q=${encodeURIComponent(query)}`,
          { credentials: "include", signal: ctrl.signal },
        );
        const json = (await res.json().catch(() => ({}))) as {
          results?: Candidate[];
          error?: string;
        };
        if (!res.ok) {
          setError(json.error ?? `Search failed: ${res.status}`);
          setResults([]);
        } else {
          setError(null);
          setResults(json.results ?? []);
        }
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
  }, [q, open, cycleId]);

  async function add(userId: string) {
    setAdding(userId);
    setError(null);
    try {
      const res = await fetch("/api/staffing/board-member", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycleId, userId }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? `Add failed: ${res.status}`);
        return;
      }
      // Drop the added member from the local list; refresh the board.
      setResults((prev) => prev.filter((r) => r.userId !== userId));
      revalidator.revalidate();
    } catch {
      setError("Add failed");
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-sm px-2.5 py-1 border border-border rounded-md bg-background text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
      >
        <UserPlus className="w-4 h-4" />
        Add member
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-72 bg-card border border-border rounded-md shadow-lg z-50 p-2">
          <input
            autoFocus
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search members by name or email…"
            className="w-full text-sm px-2 py-1.5 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          />
          {error && <p className="text-xs text-destructive mt-1.5">{error}</p>}
          <div className="mt-2 max-h-64 overflow-y-auto flex flex-col gap-0.5">
            {loading && <p className="text-xs text-muted-foreground px-1 py-1">Searching…</p>}
            {!loading && q.trim().length >= 2 && results.length === 0 && !error && (
              <p className="text-xs text-muted-foreground px-1 py-1">No members found.</p>
            )}
            {results.map((r) => (
              <button
                key={r.userId}
                type="button"
                disabled={adding === r.userId}
                onClick={() => add(r.userId)}
                className="text-left px-2 py-1.5 rounded hover:bg-muted disabled:opacity-50 flex flex-col"
              >
                <span className="text-sm text-foreground">{r.name}</span>
                {r.email && <span className="text-[11px] text-muted-foreground">{r.email}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
