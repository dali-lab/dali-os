import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useFetcher } from "react-router";
import { Handshake, FileText, PencilLine, Trash2 } from "lucide-react";
import { useOsChrome } from "~/components/os-chrome";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { useDialog } from "~/components/ui/dialog";
import { Select } from "~/components/ui/floating";
import { cn } from "~/lib/cn";
import {
  AddPairForm,
  memberName,
  usePairMutations,
  useRoster,
} from "./pair-editing";

type Person = { id: string; firstName: string; lastName: string };

type Pair = {
  id: string;
  manual: boolean;
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
  // Core gets the (flag-gated) manual pair editor for this project.
  isCore: boolean;
}

// Mentorship view on a project page. Lists confirmed pairings for the current
// term (auto-derived from ProjectAssignment by staffing finalize) and the
// project's recent notes. Visible to lab mentors + Core only — gated
// server-side via the project loader's canViewMentorshipTab. With the
// mentorship-manage flag, Core can hand-add / reassign / remove pairs here;
// those edits are tagged manual and survive a staffing re-finalize.
export function ProjectMentorshipTab({ projectId, currentTermId, isCore }: Props) {
  const { os, panel, panelPad, heading, headingIcon } = useOsChrome();
  const pairsFetcher = useFetcher<PairsResponse>();
  const notesFetcher = useFetcher<NotesResponse>();
  const [loaded, setLoaded] = useState(false);

  const pairsUrl = currentTermId
    ? `/api/mentorship/pairs?projectId=${projectId}&termId=${currentTermId}`
    : `/api/mentorship/pairs?projectId=${projectId}`;

  useEffect(() => {
    if (loaded) return;
    pairsFetcher.load(pairsUrl);
    notesFetcher.load(`/api/mentorship/notes?projectId=${projectId}`);
    setLoaded(true);
    // Loaders are idempotent; intentionally one-shot per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const manageFlag = useFeatureFlag("mentorship-manage");
  const canManage = isCore && manageFlag && Boolean(currentTermId);
  const [editing, setEditing] = useState(false);
  const dialog = useDialog();

  const reloadPairs = useCallback(() => {
    pairsFetcher.load(pairsUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairsUrl]);

  const { roster } = useRoster(projectId, currentTermId, editing && canManage);
  const { addPair, reassign, removePair, busy } = usePairMutations(reloadPairs);

  const pairs = pairsFetcher.data?.pairs ?? [];
  const notes = notesFetcher.data?.notes ?? [];

  // Group pairs by domain → mentee → pairs[] (pair ids kept for editing).
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

  function mentorOptions(pair: Pair) {
    const candidates = roster.members
      .filter((mm) => mm.domainId === pair.domain.id && mm.id !== pair.mentor.id)
      .map((mm) => ({ value: mm.id, label: `${memberName(mm)} · ${mm.level}` }));
    return [{ value: pair.mentor.id, label: fullName(pair.mentor) }, ...candidates];
  }

  async function onRemove(pair: Pair) {
    if (
      await dialog.confirm({
        title: "Remove pairing?",
        description: `Remove ${fullName(pair.mentee)} from ${fullName(pair.mentor)}? This deletes the pairing but keeps any notes already written.`,
        tone: "destructive",
      })
    ) {
      removePair(pair.id);
    }
  }

  const editToggleClass = editing
    ? os
      ? "os-btn-primary"
      : "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent-coral text-white text-sm"
    : os
      ? "os-edit-btn"
      : "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm text-foreground hover:bg-muted";

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
              onClick={() => setEditing((v) => !v)}
              aria-pressed={editing}
              className={editToggleClass}
            >
              <PencilLine className="w-4 h-4" aria-hidden />
              {editing ? "Done" : "Edit"}
            </button>
          )}
        </div>

        {editing && canManage && currentTermId && (
          <AddPairForm
            projectId={projectId}
            termId={currentTermId}
            roster={roster}
            busy={busy}
            onAdd={addPair}
          />
        )}

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
                  {[...mentees.values()].map(({ mentee, pairs: menteePairs }) =>
                    editing ? (
                      <li key={mentee.id} className="py-2 text-sm">
                        <span className="font-medium text-foreground">
                          {fullName(mentee)}
                        </span>
                        <div className="mt-1 flex flex-col gap-1">
                          {menteePairs.map((p) => (
                            <div key={p.id} className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground w-12">
                                Mentor
                              </span>
                              <Select
                                ariaLabel={`Reassign ${fullName(mentee)}'s mentor`}
                                value={p.mentor.id}
                                onChange={(v) => {
                                  if (v && v !== p.mentor.id) reassign(p.id, v);
                                }}
                                options={mentorOptions(p)}
                                buttonClassName="min-w-[11rem] text-xs"
                              />
                              {p.manual && (
                                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                  manual
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => onRemove(p)}
                                disabled={busy}
                                className="text-muted-foreground hover:text-red-500 disabled:opacity-50"
                                title="Remove pairing"
                              >
                                <Trash2 className="w-4 h-4" aria-hidden />
                                <span className="sr-only">Remove pairing</span>
                              </button>
                            </div>
                          ))}
                        </div>
                      </li>
                    ) : (
                      <li
                        key={mentee.id}
                        className="py-2 flex items-center justify-between text-sm"
                      >
                        <span className="font-medium text-foreground">
                          {fullName(mentee)}
                        </span>
                        <span className="text-muted-foreground">
                          Mentor:{" "}
                          {menteePairs.map((p) => fullName(p.mentor)).join(", ")}
                        </span>
                      </li>
                    ),
                  )}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={cn(panel, panelPad, "flex flex-col gap-3")}>
        <div className="flex items-center justify-between">
          <h2 className={heading}>
            <FileText className={headingIcon} aria-hidden />
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
