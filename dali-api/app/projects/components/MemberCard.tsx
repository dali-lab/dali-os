import { useDraggable } from "@dnd-kit/core";
import { initialsFromName } from "~/lib/display";
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
  onOpenBid: () => void;
  /** When false the card is static (read-only viewers). */
  draggable: boolean;
};

export function MemberCard({ card, columnId, projectNames, onOpenBid, draggable }: Props) {
  const dragId = `${columnId}::${card.userId}`;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: dragId,
    data: { userId: card.userId, fromColumn: columnId },
    disabled: !draggable,
  });

  const style: React.CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 }
    : {};

  const fullName = `${card.firstName} ${card.lastName}`.trim();

  // Only wire dnd listeners + grab cursor when draggable. Read-only viewers
  // still see the card and can click the name to open the bid modal.
  const dragProps = draggable ? { ...attributes, ...listeners } : {};

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...dragProps}
      className={`bg-card border border-border rounded-md p-2.5 flex flex-col gap-1.5 select-none ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      } ${isDragging ? "opacity-60 shadow-lg" : "hover:bg-muted/20"}`}
    >
      <div className="flex items-start gap-2">
        <Avatar photoUrl={card.photoUrl} name={fullName} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={(e) => {
                // Don't trigger drag-start. Open the modal instead.
                e.stopPropagation();
                onOpenBid();
              }}
              // Block the dnd-kit pointer listeners from receiving this
              // click — without this, dnd-kit's pointer activation can swallow
              // it. We re-attach listeners on the outer wrapper above so the
              // rest of the card surface still drags.
              onPointerDown={(e) => e.stopPropagation()}
              className="text-sm font-semibold text-foreground truncate hover:underline text-left"
              title="View bid"
            >
              {fullName}
            </button>
          </div>
          <RoleStrip card={card} />
        </div>
      </div>

      <DomainLevelStrip card={card} />
      <BidStrip card={card} projectNames={projectNames} />
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

function Avatar({ photoUrl, name }: { photoUrl: string | null; name: string }) {
  if (photoUrl) {
    return <img src={photoUrl} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />;
  }
  return (
    <div className="w-8 h-8 rounded-full bg-accent-coral/15 text-accent-coral flex items-center justify-center font-bold text-[11px] flex-shrink-0">
      {initialsFromName(name)}
    </div>
  );
}

function RoleStrip({ card }: { card: MemberCardModel }) {
  if (!card.isAdmin && card.coreTitles.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-0.5">
      {card.isAdmin && (
        <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-accent-coral/15 text-accent-coral">
          Admin
        </span>
      )}
      {card.coreTitles.map((t) => (
        <span
          key={t}
          className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-muted text-foreground"
        >
          {t}
        </span>
      ))}
    </div>
  );
}

function BidStrip({
  card,
  projectNames,
}: {
  card: MemberCardModel;
  projectNames: Record<string, string>;
}) {
  // Always show the member's top 3 project preferences in rank order,
  // regardless of which column the card is in.
  if (card.topPreferences.length === 0) {
    return <p className="text-[11px] text-muted-foreground italic">No project bids</p>;
  }
  return (
    <ol className="text-[11px] text-muted-foreground flex flex-col gap-0.5">
      {card.topPreferences.map((p) => (
        <li key={p.projectId} className="truncate">
          <span className="font-semibold">#{p.rank}</span>{" "}
          {projectNames[p.projectId] ?? p.projectId}
        </li>
      ))}
    </ol>
  );
}
