import { useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";

type Person = { id: string; firstName: string; lastName: string };

type Pair = {
  id: string;
  mentor: Person;
  mentee: Person;
  domain: { id: string; code: string; displayName: string };
  term: { id: string; code: string };
};

type NoteRow = {
  id: string;
  weekOf: string;
  mentor: Person;
  mentee: Person;
  project: { id: string; name: string };
  domain: { id: string; code: string; displayName: string };
};

type PairsResponse = { pairs: Pair[] };
type NotesResponse = { notes: NoteRow[] };

function fullName(u: Person) {
  return `${u.firstName} ${u.lastName}`.trim();
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface Props {
  projectId: string;
  currentTermId: string | null;
}

// Mentorship view on a project page. Lists confirmed pairings for the current
// term (derived from ProjectAssignment by staffing finalize) and the project's
// recent notes. Visible to lab mentors + Core only — gated server-side via
// the project loader's canViewMentorshipTab. Note/pair APIs further scope
// non-Core mentors to their own domains.
export function ProjectMentorshipTab({ projectId, currentTermId }: Props) {
  const pairsFetcher = useFetcher<PairsResponse>();
  const notesFetcher = useFetcher<NotesResponse>();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded) return;
    const termQ = currentTermId ? `&termId=${currentTermId}` : "";
    pairsFetcher.load(`/api/mentorship/pairs?projectId=${projectId}${termQ}`);
    notesFetcher.load(`/api/mentorship/notes?projectId=${projectId}`);
    setLoaded(true);
    // Loaders are idempotent; intentionally one-shot per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pairs = pairsFetcher.data?.pairs ?? [];
  const notes = notesFetcher.data?.notes ?? [];

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
      <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
        <h2 className="font-heading font-semibold text-foreground">
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
                    <li
                      key={mentee.id}
                      className="py-2 flex items-center justify-between text-sm"
                    >
                      <span className="font-medium text-foreground">
                        {fullName(mentee)}
                      </span>
                      <span className="text-muted-foreground">
                        Mentor: {mentors.map(fullName).join(", ")}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-heading font-semibold text-foreground">
            Recent notes
          </h2>
          <Link
            to={`/mentorship/browse?projectId=${projectId}`}
            className="text-sm text-accent-coral hover:underline"
          >
            Browse all
          </Link>
        </div>
        {notesFetcher.state !== "idle" && notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No notes written for this project yet.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {notes.slice(0, 10).map((n) => (
              <li
                key={n.id}
                className="py-2 flex items-center justify-between gap-3"
              >
                <div className="flex flex-col">
                  <span className="font-medium text-foreground">
                    {fullName(n.mentor)} → {fullName(n.mentee)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {n.domain.code} · week of {fmt(n.weekOf)}
                  </span>
                </div>
                <Link
                  to={`/mentorship/notes/${n.id}`}
                  className="text-sm text-accent-coral hover:underline"
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
