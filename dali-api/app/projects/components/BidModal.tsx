import { Modal } from "~/components/Modal";
import type { Level, Preference } from "../lib/staffing-board";

type BidModalProps = {
  open: boolean;
  onClose: () => void;
  memberName: string;
  preferences: Preference[];
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

export function BidModal({
  open,
  onClose,
  memberName,
  preferences,
  projectNames,
  domainNames,
  currentProjectId,
}: BidModalProps) {
  const sorted = [...preferences].sort((a, b) => a.preferenceRank - b.preferenceRank);
  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="bid-modal-title"
      containerClassName="bg-card rounded-2xl shadow-xl max-w-lg w-full p-5 sm:p-6 my-auto"
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 id="bid-modal-title" className="font-heading text-lg font-bold text-foreground">
            {memberName}'s bid
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Project rankings for this staffing cycle.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-sm px-2 py-1 rounded hover:bg-muted"
        >
          Close
        </button>
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          This member didn't submit any project preferences for this cycle.
        </p>
      ) : (
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
                    #{p.preferenceRank} · {projectNames[p.projectId] ?? p.projectId}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {domainNames[p.domainId] ?? p.domainId} · {LEVEL_LABEL[p.level]}
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
      )}
    </Modal>
  );
}
