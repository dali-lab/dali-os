import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, X, ArrowUpRight } from "lucide-react";

// The per-card "Mentor" dropdown badge on the staffing board. This card's
// member IS the mentor; the dropdown assigns MENTEES to them. Pairings are
// staged (StagedMentorshipPair) and only go live at finalize, which promotes
// the mentor to P3 if needed. Mentoring someone on another team is the edge
// case — those mentees are hidden behind an "External" checkbox and rendered
// in a distinct colour.

export type MenteeCandidate = {
  userId: string;
  firstName: string;
  lastName: string;
  projectId: string;
  domainId: string;
  level: "P1" | "P2" | "P3";
};

export type MentorPair = {
  id: string;
  menteeUserId: string;
  mentee: { firstName: string; lastName: string };
};

export function MentorBadge({
  cycleId,
  mentorUserId,
  mentorProjectId,
  mentorIsP3,
  pairs,
  candidates,
  onChanged,
}: {
  cycleId: string;
  // This card's member — the mentor.
  mentorUserId: string;
  // The mentor's own project column, to flag cross-team (external) mentees.
  mentorProjectId: string;
  // Whether the mentor is already P3 in the relevant domain(s); drives the
  // "→P3 at finalize" hint on the badge.
  mentorIsP3: boolean;
  pairs: MentorPair[];
  candidates: MenteeCandidate[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [showExternal, setShowExternal] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const isExternal = (c: MenteeCandidate) => c.projectId !== mentorProjectId;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function stage(mentee: MenteeCandidate) {
    setBusy(true);
    try {
      const res = await fetch("/api/staffing/mentorship", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cycleId,
          // The pair belongs to the mentee's project + domain.
          projectId: mentee.projectId,
          domainId: mentee.domainId,
          menteeUserId: mentee.userId,
          mentorUserId,
        }),
      });
      if (res.ok) {
        setQ("");
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  }

  async function unstage(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/staffing/mentorship?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) onChanged();
    } finally {
      setBusy(false);
    }
  }

  const candidateById = new Map(candidates.map((c) => [c.userId, c]));
  const pairedIds = new Set(pairs.map((p) => p.menteeUserId));
  const visible = candidates
    .filter((c) => c.userId !== mentorUserId && !pairedIds.has(c.userId))
    .filter((c) => showExternal || !isExternal(c))
    .filter((c) => `${c.firstName} ${c.lastName}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div ref={rootRef} className="relative flex flex-wrap items-center gap-1">
      {/* Assigned mentee chips — cross-team ones tinted teal. */}
      {pairs.map((p) => {
        const cand = candidateById.get(p.menteeUserId);
        const external = cand ? isExternal(cand) : false;
        return (
          <span
            key={p.id}
            title={external ? "Mentee on another team (external mentorship)" : "Mentee"}
            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium border ${
              external
                ? "bg-accent-teal/15 text-accent-teal border-accent-teal/30"
                : "bg-muted text-muted-foreground border-border"
            }`}
          >
            {external && <ArrowUpRight className="w-2.5 h-2.5" />}
            {p.mentee.firstName} {p.mentee.lastName}
            <button
              type="button"
              disabled={busy}
              onClick={() => void unstage(p.id)}
              aria-label={`Remove mentee ${p.mentee.firstName} ${p.mentee.lastName}`}
              className="hover:text-destructive disabled:opacity-60"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        );
      })}

      {/* Add-mentee trigger; badge doubles as the "Mentor" role marker. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Assign mentee"
        aria-expanded={open}
        title={
          pairs.length > 0 && !mentorIsP3
            ? "Mentor — promoted to P3 at finalize"
            : "Assign a mentee to make this member a mentor"
        }
        className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
          pairs.length > 0
            ? "border-accent-coral/40 bg-accent-coral/10 text-accent-coral"
            : "border-dashed border-border text-muted-foreground hover:text-foreground hover:border-accent-coral/50"
        }`}
      >
        {pairs.length === 0 && <Plus className="w-2.5 h-2.5" />}
        Mentor
        {pairs.length > 0 && !mentorIsP3 && <span className="opacity-80">·→P3</span>}
        <ChevronDown className="w-2.5 h-2.5" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-20 w-56 rounded-md border border-border bg-card shadow-lg">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search mentees…"
            className="w-full px-2 py-1.5 text-xs border-b border-border bg-background focus:outline-none rounded-t-md"
          />
          <label className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-muted-foreground border-b border-border cursor-pointer">
            <input
              type="checkbox"
              checked={showExternal}
              onChange={(e) => setShowExternal(e.target.checked)}
              className="rounded"
            />
            Mentee on another team (external)
          </label>
          <div className="max-h-52 overflow-y-auto p-1">
            {visible.length === 0 ? (
              <p className="px-2 py-2 text-[11px] text-muted-foreground italic">No matches.</p>
            ) : (
              visible.map((c) => {
                const external = isExternal(c);
                return (
                  <button
                    key={c.userId}
                    type="button"
                    disabled={busy}
                    onClick={() => void stage(c)}
                    className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-xs text-left hover:bg-muted disabled:opacity-60"
                  >
                    <span className="min-w-0 flex items-center gap-1 truncate">
                      {external && <ArrowUpRight className="w-3 h-3 text-accent-teal flex-shrink-0" />}
                      <span className="truncate text-foreground">
                        {c.firstName} {c.lastName}
                      </span>
                    </span>
                    <span className="flex-shrink-0 text-[10px] text-muted-foreground">{c.level}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
