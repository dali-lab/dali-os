import { useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";
import { ChevronRight, Handshake } from "lucide-react";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";

type Person = { id: string; firstName: string; lastName: string };

type Pair = {
  id: string;
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
}

// Mentorship view on a project page. Lists confirmed pairings for the current
// term (derived from ProjectAssignment by staffing finalize), each linking to
// that pairing's notes in the mentorship hub. Visible to lab mentors + Core
// only — gated server-side via the project loader's canViewMentorshipTab. The
// pairs API further scopes non-Core mentors to their own domains.
export function ProjectMentorshipTab({ projectId, currentTermId }: Props) {
  const { panel, panelPad, heading, headingIcon } = useOsChrome();
  const pairsFetcher = useFetcher<PairsResponse>();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded) return;
    const termQ = currentTermId ? `&termId=${currentTermId}` : "";
    pairsFetcher.load(`/api/mentorship/pairs?projectId=${projectId}${termQ}`);
    setLoaded(true);
    // Loaders are idempotent; intentionally one-shot per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pairs = pairsFetcher.data?.pairs ?? [];

  // Group pairs by domain → mentee → mentors[].
  const grouped = new Map<
    string,
    {
      domain: Pair["domain"];
      mentees: Map<string, { mentee: Person; mentors: Person[] }>;
    }
  >();
  for (const p of pairs) {
    const dKey = p.domain.id;
    let dBucket = grouped.get(dKey);
    if (!dBucket) {
      dBucket = { domain: p.domain, mentees: new Map() };
      grouped.set(dKey, dBucket);
    }
    let mBucket = dBucket.mentees.get(p.mentee.id);
    if (!mBucket) {
      mBucket = { mentee: p.mentee, mentors: [] };
      dBucket.mentees.set(p.mentee.id, mBucket);
    }
    mBucket.mentors.push(p.mentor);
  }

  return (
    <div className="flex flex-col gap-4">
      <section className={cn(panel, panelPad, "flex flex-col gap-3")}>
        <h2 className={heading}>
          <Handshake className={headingIcon} aria-hidden />
          Pairings ({pairs.length})
          {currentTermId ? "" : " — no current term"}
        </h2>
        {pairsFetcher.state !== "idle" && pairs.length === 0 ? (
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
                  {[...mentees.values()].map(({ mentee, mentors }) => (
                    <li key={mentee.id}>
                      <Link
                        to={notesHref(
                          projectId,
                          domain.id,
                          currentTermId,
                          mentee,
                        )}
                        title={`Open ${fullName(mentee)}'s mentorship notes`}
                        className="group -mx-2 flex items-center justify-between gap-3 rounded-os-item px-2 py-2 text-sm transition-colors hover:bg-os-container"
                      >
                        <span className="font-medium text-foreground">
                          {fullName(mentee)}
                        </span>
                        <span className="inline-flex items-center gap-1 text-muted-foreground group-hover:text-foreground">
                          Mentor: {mentors.map(fullName).join(", ")}
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
