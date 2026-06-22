import { Modal, ModalHeader } from "~/components/Modal";
import type { BidField, Level, Preference } from "../lib/staffing-board";

type BidModalProps = {
  open: boolean;
  onClose: () => void;
  memberName: string;
  preferences: Preference[];
  // The member's full Project Bids form answers (label/value) — the complete
  // bid content, beyond just the resolved rankings.
  bidFields: BidField[];
  // Project id → display name, for rendering rank rows.
  projectNames: Record<string, string>;
  // Domain id → display name, for the per-bid domain chip.
  domainNames: Record<string, string>;
  // Project the card is currently in (if assigned). Highlighted in the list.
  currentProjectId: string | null;
};

const LEVEL_LABEL: Record<Level, string> = {
  P1: "P1 · Learner",
  P2: "P2 · Doer",
  P3: "P3 · Mentor",
};

// One project's bid, collapsed across the StaffingPreference rows it expanded
// into: best rank, the distinct domain·level combos, and the first note found.
type ProjectBid = {
  projectId: string;
  rank: number;
  notes: string | null;
  combos: { domainId: string; level: Level }[];
};

export function BidModal({
  open,
  onClose,
  memberName,
  preferences,
  bidFields,
  projectNames,
  domainNames,
  currentProjectId,
}: BidModalProps) {
  // A single bid expands server-side into one StaffingPreference row per
  // (domain, level) the project + member resolve to, so the same project can
  // appear in several rows. Collapse to one row per project — best (lowest)
  // rank wins the heading, and each domain·level combo shows as a chip.
  const byProject = new Map<string, ProjectBid>();
  for (const p of preferences) {
    const existing = byProject.get(p.projectId);
    if (existing) {
      existing.rank = Math.min(existing.rank, p.preferenceRank);
      existing.combos.push({ domainId: p.domainId, level: p.level });
      if (!existing.notes && p.notes) existing.notes = p.notes;
    } else {
      byProject.set(p.projectId, {
        projectId: p.projectId,
        rank: p.preferenceRank,
        notes: p.notes,
        combos: [{ domainId: p.domainId, level: p.level }],
      });
    }
  }
  const sorted = [...byProject.values()].sort((a, b) => a.rank - b.rank);
  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="bid-modal-title"
      containerClassName="bg-card rounded-2xl shadow-xl max-w-lg w-full p-5 sm:p-6 my-auto max-h-[85vh] overflow-y-auto"
    >
      <ModalHeader
        titleId="bid-modal-title"
        title={`${memberName}'s bid`}
        subtitle="Full bid submission for this staffing cycle."
        onClose={onClose}
      />

      {sorted.length === 0 && bidFields.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          This member didn't submit a bid for this cycle.
        </p>
      ) : (
        <div className="space-y-5">
          {/* Resolved project rankings (when the bid produced preferences). */}
          {sorted.length > 0 && (
            <section>
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
                Project rankings
              </h3>
              <ol className="flex flex-col gap-3">
                {sorted.map((p) => {
                  const isCurrent = p.projectId === currentProjectId;
                  return (
                    <li
                      key={p.projectId}
                      className={`border rounded-md p-3 ${
                        isCurrent
                          ? "border-accent-coral bg-accent-coral/5"
                          : "border-border bg-background"
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2 flex-wrap">
                        <span className="font-semibold text-foreground">
                          #{p.rank} · {projectNames[p.projectId] ?? p.projectId}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {p.combos.map((c) => (
                          <span
                            key={`${c.domainId}:${c.level}`}
                            className="inline-flex items-center px-1.5 py-0.5 text-[11px] font-medium rounded bg-muted text-foreground"
                          >
                            {domainNames[c.domainId] ?? c.domainId} · {LEVEL_LABEL[c.level]}
                          </span>
                        ))}
                      </div>
                      {p.notes && (
                        <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">
                          {p.notes}
                        </p>
                      )}
                      {isCurrent && (
                        <p className="text-xs text-accent-coral font-medium mt-2">
                          Currently assigned here.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          {/* Full bid form answers — the complete submission. */}
          {bidFields.length > 0 && (
            <section>
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
                Bid responses
              </h3>
              <dl className="space-y-3">
                {bidFields.map((f, i) => (
                  <div key={i}>
                    <dt className="text-xs font-medium text-muted-foreground">{f.label}</dt>
                    <dd className="text-sm text-foreground whitespace-pre-wrap mt-0.5">
                      {f.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
