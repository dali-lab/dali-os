import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { fullName as buildFullName } from "~/lib/display";
import { Avatar } from "~/components/ui/Avatar";
import { RolePills } from "~/components/ui/RolePills";
import type { MemberCardModel, Level } from "../lib/staffing-board";

const LEVEL_BADGE: Record<Level, { label: string; cls: string }> = {
  P1: { label: "P1", cls: "bg-muted text-muted-foreground" },
  P2: { label: "P2", cls: "bg-accent-teal/15 text-accent-teal" },
  P3: { label: "P3", cls: "bg-accent-coral/15 text-accent-coral" },
};

type Props = {
  card: MemberCardModel;
  columnId: string;
  projectNames: Record<string, string>;
  domainNames: Record<string, string>;
  onOpenBid: () => void;
  /** Remove a manually-added member from the board. Only passed for managers. */
  onRemove?: () => void;
  /** When false the card is static (read-only viewers). */
  draggable: boolean;
};

export function MemberCard({ card, columnId, projectNames, domainNames, onOpenBid, onRemove, draggable }: Props) {
  // The card's sortable id is its userId (unique per board). Column membership
  // travels in `data` so the drag handler knows where the card came from.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: card.userId,
      data: { userId: card.userId, fromColumn: columnId },
      disabled: !draggable,
    });

  const fullName = buildFullName(card);

  // Only wire dnd listeners + grab cursor when draggable. Read-only viewers
  // still see the card and can click it to open the bid modal.
  const dragProps = draggable ? { ...attributes, ...listeners } : {};

  // useSortable's transform/transition animate the SIBLINGS shifting to make
  // room as a card is dragged over them. The dragged card itself is dimmed and
  // its floating copy is rendered by DragOverlay (portaled above all columns),
  // so it can never clip under an adjacent column's stacking context.
  //
  // Clicking anywhere on the card opens the member's bid. The DndContext uses
  // a small activation-distance constraint, so a pointer press that doesn't
  // move past the threshold lands here as a click rather than starting a drag.
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      {...dragProps}
      onClick={onOpenBid}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenBid();
        }
      }}
      aria-label={`View ${fullName}'s bid`}
      title="View bid"
      className={`bg-card border border-border rounded-md p-2.5 flex flex-col gap-1.5 select-none ${
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      } ${isDragging ? "opacity-40" : "hover:bg-muted/20"}`}
    >
      <MemberCardBody
        card={card}
        fullName={fullName}
        projectNames={projectNames}
        domainNames={domainNames}
        onRemove={onRemove}
      />
    </div>
  );
}

// The card's visual content, shared by the in-column MemberCard and the
// DragOverlay's floating copy so the dragged card looks identical to its
// resting state.
function MemberCardBody({
  card,
  fullName,
  projectNames,
  domainNames,
  onRemove,
}: {
  card: MemberCardModel;
  fullName: string;
  projectNames: Record<string, string>;
  domainNames: Record<string, string>;
  onRemove?: () => void;
}) {
  return (
    <>
      <div className="flex items-start gap-2">
        <Avatar photoUrl={card.photoUrl} name={fullName} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-foreground truncate text-left">
              {fullName}
            </span>
            {card.unresolvedBid && (
              <span
                className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-100 text-amber-800"
                title="Submitted a bid, but none of their picks matched an open role for this term — needs a staffing lead's attention."
              >
                Bid unresolved
              </span>
            )}
            {card.manuallyAdded && (
              <span
                className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-muted text-muted-foreground"
                title="Manually added to the board (no bid submitted)."
              >
                Added
              </span>
            )}
          </div>
          <RolePills
            isAdmin={card.isAdmin}
            coreTitles={card.coreTitles}
            size="sm"
            className="mt-0.5"
          />
        </div>
        {onRemove && card.manuallyAdded && (
          <button
            type="button"
            // Stop the press from starting a drag or opening the bid modal.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            title="Remove from board"
            aria-label={`Remove ${fullName} from board`}
            className="flex-shrink-0 text-muted-foreground hover:text-destructive text-sm leading-none px-1 rounded hover:bg-muted"
          >
            ×
          </button>
        )}
      </div>

      <DomainLevelStrip card={card} />
      <BidStrip card={card} projectNames={projectNames} domainNames={domainNames} />
    </>
  );
}

// A static, non-draggable copy of the card for DragOverlay to float above the
// columns. Same body as MemberCard, with the resting card styling.
export function MemberCardPreview({
  card,
  projectNames,
  domainNames,
}: {
  card: MemberCardModel;
  projectNames: Record<string, string>;
  domainNames: Record<string, string>;
}) {
  const fullName = buildFullName(card);
  return (
    <div className="bg-card border border-border rounded-md p-2.5 flex flex-col gap-1.5 select-none shadow-lg cursor-grabbing">
      <MemberCardBody
        card={card}
        fullName={fullName}
        projectNames={projectNames}
        domainNames={domainNames}
      />
    </div>
  );
}

function DomainLevelStrip({ card }: { card: MemberCardModel }) {
  if (card.domainLevels.length === 0) {
    return <p className="text-[11px] text-muted-foreground italic">No domain eligibility</p>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {card.domainLevels.map((d) => (
        <span
          key={d.domainName}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-muted text-foreground"
          title={`${d.domainName} · ${LEVEL_BADGE[d.level].label}`}
        >
          {d.domainName}
          <span className={`px-1 rounded font-bold ${LEVEL_BADGE[d.level].cls}`}>
            {LEVEL_BADGE[d.level].label}
          </span>
        </span>
      ))}
    </div>
  );
}

function BidStrip({
  card,
  projectNames,
  domainNames,
}: {
  card: MemberCardModel;
  projectNames: Record<string, string>;
  domainNames: Record<string, string>;
}) {
  // Always show the member's top 3 project preferences in rank order,
  // regardless of which column the card is in.
  if (card.topPreferences.length === 0) {
    // Distinguish "submitted a bid that resolved to nothing" from "never bid" —
    // the former needs a lead to fix open roles, the latter is just empty.
    return (
      <p className="text-[11px] text-muted-foreground italic">
        {card.unresolvedBid
          ? "Bid submitted — no picks matched an open role"
          : "No project bids"}
      </p>
    );
  }
  return (
    <ol className="text-[11px] text-muted-foreground flex flex-col gap-0.5">
      {card.topPreferences.map((p) => {
        // A project bid at this rank in multiple domains shows the project once
        // with its domains appended (e.g. "Evergreen — Fullstack, UI/UX"),
        // rather than repeating the project line per domain.
        const domains = p.domainIds
          .map((id) => domainNames[id])
          .filter((n): n is string => !!n);
        return (
          <li key={`${p.projectId}-${p.rank}`} className="truncate">
            <span className="font-semibold">#{p.rank}</span>{" "}
            {projectNames[p.projectId] ?? p.projectId}
            {domains.length > 0 && (
              <span className="text-muted-foreground/70"> — {domains.join(", ")}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
