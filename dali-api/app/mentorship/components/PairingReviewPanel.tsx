import { useCallback, useEffect, useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Select } from "~/components/ui/floating";
import { cn } from "~/lib/cn";
import {
  isMentorMember,
  memberName,
  useRoster,
  usePairMutations,
} from "./pair-editing";

type Person = { id: string; firstName: string; lastName: string };

type Pair = {
  id: string;
  manual: boolean;
  mentor: Person;
  mentee: Person;
  domain: { id: string; code: string; displayName: string };
};

type PairsResponse = { pairs: Pair[] };

// Empty value = the "Unpaired" option, which removes the mentee's pairing.
const UNPAIRED = "";

function fullName(u: Person) {
  return `${u.firstName} ${u.lastName}`.trim();
}

// Core review + edit of one project's mentorship pairings for a term. Lists
// every mentee in each staffed domain (paired or not) with a single mentor
// picker, so Core can rebalance the one-to-one auto assignment before it's
// locked in. Shown right after staffing finalize (pass the cycleId so role
// overrides + external mentors are in the pool) and reused in each project's
// Mentorship tab (no cycleId — post-cycle editing). Every write is Core-gated
// and tagged manual server-side, so it survives a re-finalize.
export function PairingReviewPanel({
  projectId,
  termId,
  cycleId,
  onChanged,
  className,
}: {
  projectId: string;
  termId: string;
  cycleId?: string;
  onChanged?: () => void;
  className?: string;
}) {
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const pairsUrl = `/api/mentorship/pairs?projectId=${encodeURIComponent(
    projectId,
  )}&termId=${encodeURIComponent(termId)}`;

  const loadPairs = useCallback(() => {
    return fetch(pairsUrl, { credentials: "include" })
      .then((r) => (r.ok ? (r.json() as Promise<PairsResponse>) : { pairs: [] }))
      .then((d) => setPairs(d.pairs ?? []))
      .catch(() => setPairs([]))
      .finally(() => setLoadedOnce(true));
  }, [pairsUrl]);

  useEffect(() => {
    void loadPairs();
  }, [loadPairs]);

  const afterWrite = useCallback(() => {
    void loadPairs();
    onChanged?.();
  }, [loadPairs, onChanged]);

  const { roster, loading: rosterLoading } = useRoster(
    projectId,
    termId,
    true,
    cycleId,
  );
  const { reassign, addPair, removePair, busy } = usePairMutations(afterWrite);

  // One group per staffed domain: its mentors, its mentees (roster mentees plus
  // any already-paired mentee not on the roster), the current pairing per
  // mentee, and each mentor's live mentee count for balancing.
  const groups = useMemo(() => {
    return roster.domains
      .map((domain) => {
        const domainPairs = pairs.filter((p) => p.domain.id === domain.id);
        const mentors = roster.members.filter(
          (m) => m.domainId === domain.id && isMentorMember(m),
        );
        const pairByMentee = new Map<string, Pair>();
        const load = new Map<string, number>();
        for (const p of domainPairs) {
          pairByMentee.set(p.mentee.id, p);
          load.set(p.mentor.id, (load.get(p.mentor.id) ?? 0) + 1);
        }

        const menteeMap = new Map<string, Person>();
        for (const m of roster.members) {
          if (m.domainId === domain.id && !isMentorMember(m)) {
            menteeMap.set(m.id, {
              id: m.id,
              firstName: m.firstName,
              lastName: m.lastName,
            });
          }
        }
        for (const p of domainPairs) {
          if (!menteeMap.has(p.mentee.id)) menteeMap.set(p.mentee.id, p.mentee);
        }
        const mentees = [...menteeMap.values()].sort((a, b) =>
          `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`),
        );

        return { domain, mentors, mentees, pairByMentee, load };
      })
      .filter((g) => g.mentees.length > 0);
  }, [roster, pairs]);

  function mentorOptions(
    group: (typeof groups)[number],
    current: Pair | undefined,
  ) {
    const opts = group.mentors.map((m) => ({
      value: m.id,
      label: `${memberName(m)}${m.external ? " (external)" : ""} · ${
        group.load.get(m.id) ?? 0
      }`,
    }));
    // Keep the current mentor selectable even if they're no longer classified a
    // mentor (e.g. a role flipped after the pair was made).
    if (current && !group.mentors.some((m) => m.id === current.mentor.id)) {
      opts.unshift({ value: current.mentor.id, label: fullName(current.mentor) });
    }
    return [{ value: UNPAIRED, label: "Unpaired" }, ...opts];
  }

  function onSelect(
    group: (typeof groups)[number],
    mentee: Person,
    current: Pair | undefined,
    value: string,
  ) {
    if (value === UNPAIRED) {
      if (current) removePair(current.id);
      return;
    }
    if (!current) {
      addPair({
        menteeUserId: mentee.id,
        mentorUserId: value,
        projectId,
        termId,
        domainId: group.domain.id,
      });
      return;
    }
    if (current.mentor.id !== value) reassign(current.id, value);
  }

  const loading = !loadedOnce || rosterLoading;

  if (loading && groups.length === 0) {
    return <p className="text-sm text-muted-foreground">Loading pairings…</p>;
  }

  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No staffed members to pair for this project and term.
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {groups.map((group) => {
        const noMentor = group.mentors.length === 0 && group.mentees.length > 0;
        return (
          <div key={group.domain.id} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-muted-foreground">
              {group.domain.displayName} ({group.domain.code})
            </h3>
            {noMentor && (
              <p className="flex items-center gap-1.5 text-xs text-accent-yellow">
                <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
                No mentor in this domain. Flag one on the board or staff a P3.
              </p>
            )}
            <ul className="divide-y divide-border">
              {group.mentees.map((mentee) => {
                const current = group.pairByMentee.get(mentee.id);
                return (
                  <li
                    key={mentee.id}
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate font-medium text-foreground">
                      {fullName(mentee)}
                    </span>
                    <div className="flex items-center gap-2">
                      {current?.manual && (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          manual
                        </span>
                      )}
                      <Select
                        ariaLabel={`${fullName(mentee)}'s mentor`}
                        value={current?.mentor.id ?? UNPAIRED}
                        onChange={(v) => onSelect(group, mentee, current, v)}
                        options={mentorOptions(group, current)}
                        buttonClassName="min-w-[12rem] text-xs"
                        disabled={busy || group.mentors.length === 0}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
