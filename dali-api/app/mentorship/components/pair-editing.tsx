import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Select } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";

// Shared client helpers for the Core-only manual pair editor, used inline on the
// Notes grid and on each project's Mentorship tab. All writes go through
// /api/mentorship/pairs (Core-gated, and they set `manual:true` so hand-edits
// survive a staffing re-finalize); candidate people come from
// /api/mentorship/roster, scoped to one project's roster.

export type RosterMember = {
  id: string;
  firstName: string;
  lastName: string;
  domainId: string;
  level: "P1" | "P2" | "P3";
};
export type RosterDomain = { id: string; code: string; displayName: string };
export type RosterData = { domains: RosterDomain[]; members: RosterMember[] };

export function memberName(m: { firstName: string; lastName: string }): string {
  return `${m.firstName} ${m.lastName}`.trim();
}

const EMPTY_ROSTER: RosterData = { domains: [], members: [] };

/**
 * Lazily loads a project's roster (staffed members + domains) for the editor's
 * pickers. Fetches only while `enabled` and both ids are present; clears
 * otherwise. Core-only endpoint — a non-Core caller just gets an empty roster.
 */
export function useRoster(
  projectId: string | null,
  termId: string | null,
  enabled: boolean,
): { roster: RosterData; loading: boolean } {
  const [roster, setRoster] = useState<RosterData>(EMPTY_ROSTER);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !projectId || !termId) {
      setRoster(EMPTY_ROSTER);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(
      `/api/mentorship/roster?projectId=${encodeURIComponent(projectId)}&termId=${encodeURIComponent(termId)}`,
      { credentials: "include" },
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((d: RosterData | null) => {
        if (!cancelled) setRoster(d ?? EMPTY_ROSTER);
      })
      .catch(() => {
        if (!cancelled) setRoster(EMPTY_ROSTER);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, termId, enabled]);

  return { roster, loading };
}

export type AddPairInput = {
  menteeUserId: string;
  mentorUserId: string;
  projectId: string;
  termId: string;
  domainId: string;
};

/**
 * CRUD against /api/mentorship/pairs. `onChanged` is called after a successful
 * write so the caller can refresh its own view (route revalidation on the Notes
 * page, a fetcher reload on the project tab). Each call returns whether it
 * succeeded so callers can keep local UI in step.
 */
export function usePairMutations(onChanged: () => void) {
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (fn: () => Promise<Response>): Promise<boolean> => {
      setBusy(true);
      try {
        const res = await fn();
        if (!res.ok) return false;
        onChanged();
        return true;
      } catch {
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onChanged],
  );

  const addPair = useCallback(
    (body: AddPairInput) =>
      run(() =>
        fetch("/api/mentorship/pairs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        }),
      ),
    [run],
  );

  const reassign = useCallback(
    (id: string, mentorUserId: string) =>
      run(() =>
        fetch("/api/mentorship/pairs", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ id, mentorUserId }),
        }),
      ),
    [run],
  );

  const removePair = useCallback(
    (id: string) =>
      run(() =>
        fetch(`/api/mentorship/pairs?id=${encodeURIComponent(id)}`, {
          method: "DELETE",
          credentials: "include",
        }),
      ),
    [run],
  );

  return { addPair, reassign, removePair, busy };
}

// Members staffed in one domain — the candidate pool for both sides of a pair.
export function membersInDomain(
  roster: RosterData,
  domainId: string,
): RosterMember[] {
  return roster.members.filter((m) => m.domainId === domainId);
}

/**
 * Domain → mentee → mentor pickers plus an Add button. `projectId`/`termId` are
 * fixed by the caller (a project tab, or the Notes page's active project
 * filter); the pool comes from that project's roster.
 */
export function AddPairForm({
  projectId,
  termId,
  roster,
  busy,
  onAdd,
}: {
  projectId: string;
  termId: string;
  roster: RosterData;
  busy: boolean;
  onAdd: (body: AddPairInput) => void;
}) {
  const { os } = useOsChrome();
  const [domainId, setDomainId] = useState("");
  const [menteeId, setMenteeId] = useState("");
  const [mentorId, setMentorId] = useState("");

  const pool = domainId ? membersInDomain(roster, domainId) : [];
  const canAdd = Boolean(domainId && menteeId && mentorId && menteeId !== mentorId);

  function reset() {
    setMenteeId("");
    setMentorId("");
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border p-3">
      <Select
        ariaLabel="Domain"
        value={domainId}
        onChange={(v) => {
          setDomainId(v);
          reset();
        }}
        options={[
          { value: "", label: "Domain…" },
          ...roster.domains.map((d) => ({
            value: d.id,
            label: `${d.displayName} (${d.code})`,
          })),
        ]}
        buttonClassName="min-w-[10rem]"
      />
      <Select
        ariaLabel="Mentee"
        value={menteeId}
        onChange={setMenteeId}
        options={[
          { value: "", label: "Mentee…" },
          ...pool.map((m) => ({ value: m.id, label: memberName(m) })),
        ]}
        buttonClassName="min-w-[10rem]"
      />
      <span className="text-sm text-muted-foreground">mentored by</span>
      <Select
        ariaLabel="Mentor"
        value={mentorId}
        onChange={setMentorId}
        options={[
          { value: "", label: "Mentor…" },
          ...pool.map((m) => ({ value: m.id, label: `${memberName(m)} · ${m.level}` })),
        ]}
        buttonClassName="min-w-[10rem]"
      />
      <button
        type="button"
        disabled={!canAdd || busy}
        onClick={() => {
          onAdd({
            menteeUserId: menteeId,
            mentorUserId: mentorId,
            projectId,
            termId,
            domainId,
          });
          reset();
        }}
        className={cn(
          os
            ? "os-btn-primary"
            : "inline-flex items-center gap-1 px-3 py-1 rounded-md bg-accent-coral text-white text-sm hover:opacity-90",
          "disabled:opacity-50",
        )}
      >
        <Plus className="w-4 h-4" aria-hidden />
        Add pair
      </button>
    </div>
  );
}
