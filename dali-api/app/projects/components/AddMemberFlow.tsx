import { useEffect, useMemo, useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { ChevronLeft, UserPlus, X } from "lucide-react";
import { useOsChrome } from "~/components/os-chrome";
import { OS_SURFACE_CLASS, filterPillClass } from "~/components/ui/floating/styles";
import { Select } from "~/components/ui/floating";
import { ProjectIcon } from "~/components/ProjectIcon";
import { cn } from "~/lib/cn";
import type { Assignment, MemberInput } from "../lib/staffing-board";

type ProjectOption = { id: string; name: string; iconEmoji?: string | null };

// A person the flow can act on. `onBoard` decides which destinations make sense:
// on-board members (their bid/eligibility is loaded) can be staffed onto a
// project directly; off-board people are added to the board first.
type Person = { userId: string; name: string; email: string | null; onBoard: boolean };

// The single "Add member" entry point for the staffing board. Replaces the old
// trio (board-wide add, per-project "+", per-project external-mentor icon): pick
// a person once, then pick where they go. Which destinations appear depends on
// whether the person is already on the board — that's what makes the intent
// unambiguous, rather than three lookalike buttons.
export function AddMemberFlow({
  cycleId,
  projects,
  members,
  assignments,
  domains,
  onStaffToProject,
  onExternalMentorAdded,
}: {
  cycleId: string;
  projects: ProjectOption[];
  members: MemberInput[];
  assignments: Assignment[];
  domains: { id: string; name: string }[];
  /** Staff an already-on-board member onto a project (resolves domains client-side). */
  onStaffToProject: (userId: string, projectId: string) => void;
  /** Refetch external mentors after one is added. */
  onExternalMentorAdded: () => void;
}) {
  const { os } = useOsChrome();
  const revalidator = useRevalidator();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [serverResults, setServerResults] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Person | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // External-mentor sub-form (a project + domain for the selected person).
  const [mentorMode, setMentorMode] = useState(false);
  const [mentorProjectId, setMentorProjectId] = useState("");
  const [mentorDomainId, setMentorDomainId] = useState("");

  const containerRef = useRef<HTMLDivElement>(null);

  // Fresh start each time the popover closes.
  useEffect(() => {
    if (open) return;
    setQ("");
    setServerResults([]);
    setSelected(null);
    setError(null);
    setBusy(false);
    setMentorMode(false);
    setMentorProjectId("");
    setMentorDomainId("");
  }, [open]);

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

  // On-board matches — instant client filter, token-AND over name + email.
  const localResults = useMemo<Person[]>(() => {
    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    return members
      .filter((m) => {
        const hay = `${m.firstName} ${m.lastName} ${m.email ?? ""}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      })
      .slice(0, 10)
      .map((m) => ({
        userId: m.userId,
        name: `${m.firstName} ${m.lastName}`.trim(),
        email: m.email,
        onBoard: true,
      }));
  }, [members, q]);

  // Off-board roster matches — debounced server search (the endpoint already
  // excludes anyone on the board, so these never overlap the local results).
  useEffect(() => {
    if (!open || selected) return;
    const query = q.trim();
    if (query.length < 2) {
      setServerResults([]);
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
          results?: { userId: string; name: string; email: string | null }[];
        };
        setServerResults((json.results ?? []).map((r) => ({ ...r, onBoard: false })));
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
  }, [q, open, selected, cycleId]);

  const results = useMemo<Person[]>(() => {
    const seen = new Set(localResults.map((p) => p.userId));
    return [...localResults, ...serverResults.filter((p) => !seen.has(p.userId))];
  }, [localResults, serverResults]);

  // Projects the selected on-board member is already staffed on — hidden from
  // the "staff on a project" list so we never offer a no-op.
  const availableProjects = useMemo(() => {
    if (!selected) return projects;
    const assigned = new Set(
      assignments.filter((a) => a.userId === selected.userId).map((a) => a.projectId),
    );
    return projects.filter((p) => !assigned.has(p.id));
  }, [projects, assignments, selected]);

  async function addToBoard() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/staffing/board-member", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycleId, userId: selected.userId }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? `Add failed: ${res.status}`);
        return;
      }
      revalidator.revalidate();
      setOpen(false);
    } catch {
      setError("Add failed");
    } finally {
      setBusy(false);
    }
  }

  function staffOn(projectId: string) {
    if (!selected) return;
    onStaffToProject(selected.userId, projectId);
    setOpen(false);
  }

  async function addExternalMentor() {
    if (!selected || !mentorProjectId || !mentorDomainId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/staffing/external-mentor", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cycleId,
          projectId: mentorProjectId,
          domainId: mentorDomainId,
          userId: selected.userId,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(d?.error ?? "Couldn't add the mentor. Try again.");
        return;
      }
      onExternalMentorAdded();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  const inputClass = cn(
    "w-full text-sm px-2 py-1.5 border border-border bg-background text-foreground focus:outline-none focus:ring-2",
    os ? "rounded-os-item focus:ring-os-accent/40" : "rounded-md focus:ring-accent-coral/30",
  );
  const selectClass =
    "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40";

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "focus:outline-none focus:ring-2",
          os
            ? cn(filterPillClass(true), "focus:ring-os-accent/40")
            : "inline-flex items-center gap-1.5 text-sm px-2.5 py-1 border border-border rounded-md bg-background text-foreground hover:bg-muted focus:ring-accent-coral/30",
        )}
      >
        <UserPlus className="w-4 h-4" />
        Add member
      </button>

      {open && (
        <div
          className={cn(
            "absolute right-0 mt-1 w-80 z-50 p-2",
            os ? OS_SURFACE_CLASS : "bg-card border border-border rounded-md shadow-lg",
          )}
        >
          {!selected ? (
            // ── Step 1: pick a person ──────────────────────────────────────
            <>
              <input
                autoFocus
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search members by name or email…"
                className={inputClass}
              />
              {error && <p className="text-xs text-destructive mt-1.5">{error}</p>}
              <div className="mt-2 max-h-64 overflow-y-auto flex flex-col gap-0.5">
                {loading && localResults.length === 0 && (
                  <p className="text-xs text-muted-foreground px-1 py-1">Searching…</p>
                )}
                {!loading && q.trim().length >= 2 && results.length === 0 && !error && (
                  <p className="text-xs text-muted-foreground px-1 py-1">No members found.</p>
                )}
                {results.map((person) => (
                  <button
                    key={person.userId}
                    type="button"
                    onClick={() => setSelected(person)}
                    className="text-left px-2 py-1.5 rounded hover:bg-muted flex flex-col gap-0.5"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="text-sm text-foreground">{person.name}</span>
                      <BoardBadge onBoard={person.onBoard} os={os} />
                    </span>
                    {person.email && (
                      <span className="text-[11px] text-muted-foreground">{person.email}</span>
                    )}
                  </button>
                ))}
              </div>
            </>
          ) : (
            // ── Step 2: pick a destination ─────────────────────────────────
            <>
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  setMentorMode(false);
                  setError(null);
                }}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2"
              >
                <ChevronLeft className="w-3.5 h-3.5" aria-hidden />
                <span className="text-sm text-foreground font-medium">{selected.name}</span>
                <BoardBadge onBoard={selected.onBoard} os={os} />
              </button>

              {!mentorMode ? (
                <div className="flex flex-col gap-2">
                  {selected.onBoard ? (
                    <section>
                      <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                        Staff on a project
                      </h4>
                      {availableProjects.length === 0 ? (
                        <p className="text-xs text-muted-foreground px-1">
                          Already staffed on every project.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {availableProjects.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => staffOn(p.id)}
                              className={cn(
                                "inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded border border-border hover:bg-muted transition-colors",
                                os ? "bg-os-well" : "bg-background",
                              )}
                            >
                              <ProjectIcon iconEmoji={p.iconEmoji} />
                              <span className="truncate max-w-[10rem]">{p.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </section>
                  ) : (
                    <section className="flex flex-col gap-2">
                      <p className="text-xs text-muted-foreground">
                        {selected.name} hasn&apos;t bid this cycle. Add them to the board — they land
                        in Unassigned, ready to staff onto a project.
                      </p>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={addToBoard}
                        className={cn(
                          "self-start disabled:opacity-50",
                          os
                            ? "os-btn-primary"
                            : "px-3 py-1.5 text-sm rounded-lg bg-accent-coral text-white hover:opacity-90",
                        )}
                      >
                        {busy ? "Adding…" : "Add to board"}
                      </button>
                    </section>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setMentorMode(true);
                      setMentorProjectId(projects[0]?.id ?? "");
                      setMentorDomainId(domains[0]?.id ?? "");
                    }}
                    className="self-start text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                  >
                    …or add as external mentor
                  </button>
                </div>
              ) : (
                // External-mentor sub-form.
                <section className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                      Add as external mentor
                    </h4>
                    <button
                      type="button"
                      onClick={() => setMentorMode(false)}
                      aria-label="Back"
                      className="text-muted-foreground hover:text-foreground rounded p-0.5 hover:bg-muted"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden />
                    </button>
                  </div>
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-muted-foreground">Project</span>
                    <Select
                      ariaLabel="Project to mentor"
                      value={mentorProjectId}
                      onChange={(v) => setMentorProjectId(v)}
                      options={projects.map((p) => ({ value: p.id, label: p.name }))}
                      buttonClassName={selectClass}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-muted-foreground">Domain</span>
                    <Select
                      ariaLabel="Mentoring domain"
                      value={mentorDomainId}
                      onChange={(v) => setMentorDomainId(v)}
                      options={domains.map((d) => ({ value: d.id, label: d.name }))}
                      buttonClassName={selectClass}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!mentorProjectId || !mentorDomainId || busy}
                    onClick={addExternalMentor}
                    className={cn(
                      "self-end disabled:opacity-50",
                      os
                        ? "os-btn-primary"
                        : "px-3 py-1.5 text-sm rounded-lg bg-accent-coral text-white hover:opacity-90",
                    )}
                  >
                    {busy ? "Adding…" : "Add mentor"}
                  </button>
                </section>
              )}

              {error && <p className="text-xs text-destructive mt-1.5">{error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function BoardBadge({ onBoard, os }: { onBoard: boolean; os: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded",
        onBoard
          ? os
            ? "bg-os-accent/15 text-os-accent"
            : "bg-accent-teal/15 text-accent-teal"
          : "bg-muted text-muted-foreground",
      )}
    >
      {onBoard ? "On board" : "Not on board"}
    </span>
  );
}
