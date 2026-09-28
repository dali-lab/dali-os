import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useFetcher } from "react-router";
import { ChevronRight, Handshake, PencilLine } from "lucide-react";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { PairingReviewPanel } from "./PairingReviewPanel";

type Person = { id: string; firstName: string; lastName: string };

type Pair = {
  id: string;
  manual: boolean;
  mentor: Person;
  mentee: Person;
  domain: { id: string; code: string; displayName: string };
  term: { id: string; code: string };
};

type PairsResponse = { pairs: Pair[] };

function fullName(u: Person) {
  return `${u.firstName} ${u.lastName}`.trim();
}

// A pairing's notes live in the mentorship hub's weekly grid, so a row links
// there pre-filtered to that pairing: project + domain + term narrow the grid,
// and the mentee's name in the hub's people search keeps just their row.
function notesHref(
  projectId: string,
  domainId: string,
  termId: string | null,
  mentee: Person,
) {
  const params = new URLSearchParams({
    projectId,
    domainId,
    q: fullName(mentee),
  });
  if (termId) params.set("termId", termId);
  return `/mentorship/browse?${params.toString()}`;
}

interface Props {
  projectId: string;
  currentTermId: string | null;
  // Core gets the manual pair editor for this project.
  isCore: boolean;
}

// Mentorship view on a project page. Lists confirmed pairings for the current
// term (auto-derived from ProjectAssignment by staffing finalize, one mentor per
// mentee); each row links to that pairing's notes in the mentorship hub. Visible
// to lab mentors + Core only — gated server-side via the project loader's
// canViewMentorshipTab. Core can reassign here via the shared review panel;
// those edits are tagged manual and survive a staffing re-finalize.
export function ProjectMentorshipTab({ projectId, currentTermId, isCore }: Props) {
  const { panel, panelPad, heading, headingIcon } = useOsChrome();
  const pairsFetcher = useFetcher<PairsResponse>();
  const [loaded, setLoaded] = useState(false);

  const pairsUrl = currentTermId
    ? `/api/mentorship/pairs?projectId=${projectId}&termId=${currentTermId}`
    : `/api/mentorship/pairs?projectId=${projectId}`;

  useEffect(() => {
    if (loaded) return;
    pairsFetcher.load(pairsUrl);
    setLoaded(true);
    // Loaders are idempotent; intentionally one-shot per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canManage = isCore && Boolean(currentTermId);
  const [editing, setEditing] = useState(false);

  const reloadPairs = useCallback(() => {
    pairsFetcher.load(pairsUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairsUrl]);

  const pairs = pairsFetcher.data?.pairs ?? [];

  // Group pairs by domain → mentee → pairs[] for the read-only list.
  const grouped = useMemo(() => {
    const m = new Map<
      string,
      {
        domain: Pair["domain"];
        mentees: Map<string, { mentee: Person; pairs: Pair[] }>;
      }
    >();
    for (const p of pairs) {
      let dBucket = m.get(p.domain.id);
      if (!dBucket) {
        dBucket = { domain: p.domain, mentees: new Map() };
        m.set(p.domain.id, dBucket);
      }
      let mBucket = dBucket.mentees.get(p.mentee.id);
      if (!mBucket) {
        mBucket = { mentee: p.mentee, pairs: [] };
        dBucket.mentees.set(p.mentee.id, mBucket);
      }
      mBucket.pairs.push(p);
    }
    return m;
  }, [pairs]);

  const editToggleClass = editing ? "os-btn-primary" : "os-edit-btn";

  return (
    <div className="flex flex-col gap-4">
      <section className={cn(panel, panelPad, "flex flex-col gap-3")}>
        <div className="flex items-center justify-between gap-2">
          <h2 className={heading}>
            <Handshake className={headingIcon} aria-hidden />
            Pairings ({pairs.length})
            {currentTermId ? "" : " — no current term"}
          </h2>
          {canManage && (
            <button
              type="button"
              onClick={() => {
                if (editing) reloadPairs();
                setEditing((v) => !v);
              }}
              aria-pressed={editing}
              className={editToggleClass}
            >
              <PencilLine className="w-4 h-4" aria-hidden />
              {editing ? "Done" : "Edit"}
            </button>
          )}
        </div>

        {editing && canManage && currentTermId ? (
          <PairingReviewPanel
            projectId={projectId}
            termId={currentTermId}
            onChanged={reloadPairs}
          />
        ) : pairsFetcher.state !== "idle" && pairs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : pairs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No pairings yet for this project. Pairings are derived automatically
            when staffing is finalized.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {[...grouped.values()].map(({ domain, mentees }) => (
              <div key={domain.id} className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-muted-foreground">
                  {domain.displayName} ({domain.code})
                </h3>
                <ul className="divide-y divide-border">
                  {[...mentees.values()].map(({ mentee, pairs: menteePairs }) => (
                    <li key={mentee.id}>
                      <Link
                        to={notesHref(projectId, domain.id, currentTermId, mentee)}
                        title={`Open ${fullName(mentee)}'s mentorship notes`}
                        className="group -mx-2 flex items-center justify-between gap-3 rounded-os-item px-2 py-2 text-sm transition-colors hover:bg-os-container"
                      >
                        <span className="font-medium text-foreground">
                          {fullName(mentee)}
                        </span>
                        <span className="inline-flex items-center gap-1 text-muted-foreground group-hover:text-foreground">
                          Mentor:{" "}
                          {menteePairs.map((p) => fullName(p.mentor)).join(", ")}
                          <ChevronRight className="h-4 w-4" aria-hidden />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
