import { Modal, ModalHeader } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import { ProjectIcon } from "~/components/ProjectIcon";
import { cn } from "~/lib/cn";
import { useFeatureFlag } from "~/components/FeatureFlags";
import type { BidField, Preference } from "../lib/staffing-board";

type BoardProject = { id: string; name: string; iconEmoji?: string | null };

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
  // Every staffable project column, so the modal can offer placement onto a
  // project the member didn't rank ("Other projects").
  boardProjects: BoardProject[];
  // Projects the member is currently staffed on (any column) — shown as
  // "Assigned here" instead of a place button.
  assignedProjectIds: string[];
  // Managers get one-click placement; viewers see the bid read-only.
  canManage: boolean;
  // Staff the member onto a project (additive — keeps their other projects).
  onPlace: (projectId: string) => void;
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
  boardProjects,
  assignedProjectIds,
  canManage,
  onPlace,
}: BidModalProps) {
  const os = useFeatureFlag("os-redesign");
  const assigned = new Set(assignedProjectIds);
  const boardIds = new Set(boardProjects.map((p) => p.id));
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

  // Staffable projects the member DIDN'T rank — offered below the rankings so a
  // lead can place them anywhere, not just onto a bid.
  const otherProjects = boardProjects.filter((p) => !byProject.has(p.id));

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

      <div className="space-y-5">
        {sorted.length === 0 && bidFields.length === 0 && (
          <p className="text-sm text-muted-foreground italic">
            This member didn't submit a bid for this cycle.
            {canManage && otherProjects.length > 0 && " Place them onto a project below."}
          </p>
        )}
        {/* Resolved project rankings (when the bid produced preferences). */}
        {sorted.length > 0 && (
            <section>
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
                Project rankings
              </h3>
              <ol className="flex flex-col gap-3">
                {sorted.map((p) => {
                  const isAssigned = assigned.has(p.projectId);
                  return (
                    <li
                      key={p.projectId}
                      className={cn(
                        "border p-3",
                        os ? "rounded-os-item" : "rounded-md",
                        isAssigned
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
                        <PlaceControl
                          isAssigned={isAssigned}
                          canPlace={canManage && boardIds.has(p.projectId)}
                          onPlace={() => onPlace(p.projectId)}
                          os={os}
                        />
                      </div>
                      {p.notes && (
                        <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">
                          {p.notes}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          {/* Any other staffable project — place onto one they didn't rank. */}
          {canManage && otherProjects.length > 0 && (
            <section>
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
                Other projects
              </h3>
              <ul className="flex flex-col gap-1.5">
                {otherProjects.map((p) => {
                  const isAssigned = assigned.has(p.id);
                  return (
                    <li
                      key={p.id}
                      className={cn(
                        "flex items-center justify-between gap-2 border px-3 py-2",
                        os ? "rounded-os-item border-transparent bg-os-well" : "rounded-md border-border bg-background",
                      )}
                    >
                      <span className="flex items-center gap-1.5 min-w-0 text-sm text-foreground">
                        <ProjectIcon iconEmoji={p.iconEmoji} />
                        <span className="truncate">{p.name}</span>
                      </span>
                      <PlaceControl
                        isAssigned={isAssigned}
                        canPlace
                        onPlace={() => onPlace(p.id)}
                        os={os}
                      />
                    </li>
                  );
                })}
              </ul>
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
    </Modal>
  );
}

// The trailing affordance on a project row: a "✓ Assigned here" marker if the
// member is already staffed there, else a "Place here" button for managers.
function PlaceControl({
  isAssigned,
  canPlace,
  onPlace,
  os,
}: {
  isAssigned: boolean;
  canPlace: boolean;
  onPlace: () => void;
  os: boolean;
}) {
  if (isAssigned) {
    return (
      <span
        className={cn(
          "flex-shrink-0 inline-flex items-center gap-1 text-xs font-medium",
          os ? "text-os-accent" : "text-accent-coral",
        )}
      >
        ✓ Assigned here
      </span>
    );
  }
  if (!canPlace) return null;
  return (
    <button
      type="button"
      onClick={onPlace}
      className={cn(
        "flex-shrink-0 text-xs font-medium px-2 py-1 rounded border transition-colors",
        os
          ? "border-os-accent/40 text-os-accent hover:bg-os-accent/10"
          : "border-accent-coral/40 text-accent-coral hover:bg-accent-coral/10",
      )}
    >
      Place here
    </button>
  );
}
