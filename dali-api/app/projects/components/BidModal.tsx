import { Modal, ModalHeader } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { useFeatureFlag } from "~/components/FeatureFlags";
import type { BidField, Preference } from "../lib/staffing-board";

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
  // Project the card is currently in (if assigned). Highlighted in the list.
  currentProjectId: string | null;
};

// One project's bid, collapsed across the StaffingPreference rows it expanded
// into: best rank and the first note found.
type ProjectBid = {
  projectId: string;
  rank: number;
  notes: string | null;
};

export function BidModal({
  open,
  onClose,
  memberName,
  preferences,
  bidFields,
  projectNames,
  currentProjectId,
}: BidModalProps) {
  const os = useFeatureFlag("os-redesign");
  // A bid ranks a PROJECT, nothing more. Each row also carries a domain + level,
  // but those are bookkeeping — bid-validation stamps one on every ranked
  // project (falling back to the project's first declared domain) just to key
  // the row, so showing them here read as "they bid as a designer" when the
  // member may have no claim to that domain at all. What the member is actually
  // hired for lives on the card's eligibility chips. So collapse to one row per
  // project: best (lowest) rank wins the heading.
  const byProject = new Map<string, ProjectBid>();
  for (const p of preferences) {
    const existing = byProject.get(p.projectId);
    if (existing) {
      existing.rank = Math.min(existing.rank, p.preferenceRank);
      if (!existing.notes && p.notes) existing.notes = p.notes;
    } else {
      byProject.set(p.projectId, {
        projectId: p.projectId,
        rank: p.preferenceRank,
        notes: p.notes,
      });
    }
  }
  const sorted = [...byProject.values()].sort((a, b) => a.rank - b.rank);
  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="bid-modal-title"
      containerClassName={modalCardClass(os, "max-w-lg max-h-[85vh] overflow-y-auto")}
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
                      className={cn(
                        "border p-3",
                        os ? "rounded-os-item" : "rounded-md",
                        isCurrent
                          ? os
                            ? "border-os-accent/50 bg-os-accent/[0.07]"
                            : "border-accent-coral bg-accent-coral/5"
                          : os
                            ? "border-transparent bg-os-well"
                            : "border-border bg-background",
                      )}
                    >
                      <div className="flex items-baseline justify-between gap-2 flex-wrap">
                        <span className="font-semibold text-foreground">
                          #{p.rank} · {projectNames[p.projectId] ?? p.projectId}
                        </span>
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
