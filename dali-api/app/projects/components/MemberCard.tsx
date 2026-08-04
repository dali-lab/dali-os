import { useState, type ReactNode } from "react";
import { GraduationCap, Plus } from "lucide-react";
import { fullName as buildFullName } from "~/lib/display";
import { Avatar } from "~/components/ui/Avatar";
import { RolePills } from "~/components/ui/RolePills";
import { ALL_LEVELS, type Level } from "~/lib/level";
import type { DomainLevel, MemberCardModel } from "../lib/staffing-board";
import { Select } from "~/components/ui/floating";

const LEVEL_BADGE: Record<Level, { label: string; cls: string }> = {
  P1: { label: "P1", cls: "bg-muted text-muted-foreground" },
  P2: { label: "P2", cls: "bg-accent-teal/15 text-accent-teal" },
  P3: { label: "P3", cls: "bg-accent-coral/15 text-accent-coral" },
};

type DomainOption = { id: string; name: string };

type Props = {
  card: MemberCardModel;
  projectNames: Record<string, string>;
  domainNames: Record<string, string>;
  onOpenBid: () => void;
  /** Remove a manually-added member from the board. Only passed for managers. */
  onRemove?: () => void;
  /** When false the card is static (read-only viewers). */
  draggable: boolean;
  /**
   * Drag listeners + a11y attributes from the KanbanBoard sortable wrapper.
   * Spread onto the card root so the whole card initiates a drag. Empty for
   * read-only viewers.
   */
  dragHandleProps: Record<string, unknown>;
  /** The card is the one being dragged — dim it; the DragOverlay floats a copy. */
  isDragging: boolean;
  /**
   * Optional mentorship control (the Mentor/Mentee badge) rendered below the
   * card body. Interactive — lives outside the card's drag/click surface.
   */
  mentorSlot?: ReactNode;
  /**
   * Tint the card as an external mentor — this member mentors someone on
   * another team. A distinct teal edge marks the cross-team relationship.
   */
  accentExternal?: boolean;
  /** Managers: edit DomainEligibility chips + add a domain. */
  canEditDomains?: boolean;
  /** All domains available to add (not already on the card). */
  allDomains?: DomainOption[];
  onChangeDomainLevel?: (domainId: string, level: Level) => void;
  onAddDomain?: (domainId: string, level: Level) => void;
  /** Domain ids selected for the live staffing assignment (multi allowed). */
  assignmentDomainIds?: string[];
  /**
   * Toggle a domain into / out of the staffing assignment. Only wired on
   * project columns — Unassigned cards have no assignment to edit.
   */
  onToggleAssignmentDomain?: (domainId: string) => void;
};

export function MemberCard({
  card,
  projectNames,
  domainNames,
  onOpenBid,
  onRemove,
  draggable,
  dragHandleProps,
  isDragging,
  mentorSlot,
  accentExternal,
  canEditDomains,
  allDomains,
  onChangeDomainLevel,
  onAddDomain,
  assignmentDomainIds,
  onToggleAssignmentDomain,
}: Props) {
  const fullName = buildFullName(card);

  // External-mentor cards are a distinct, non-roster placement: their own
  // rendering (teal edge, no bid, a Remove ×), never draggable, no bid modal.
  if (card.isExternalMentor) {
    return (
      <ExternalMentorCard card={card} fullName={fullName} onRemove={onRemove} />
    );
  }

  // Only wire dnd listeners + grab cursor when draggable. Read-only viewers
  // still see the card and can click it to open the bid modal.
  const dragProps = draggable ? dragHandleProps : {};

  // The wrapper (KanbanBoard's SortableCardWrapper) owns setNodeRef + the
  // sortable transform that animates SIBLINGS shifting to make room. The dragged
  // card itself is dimmed; its floating copy is rendered by DragOverlay (portaled
  // above all columns), so it can never clip under an adjacent column.
  //
  // Clicking anywhere on the card opens the member's bid. The DndContext uses a
  // small activation-distance constraint, so a pointer press that doesn't move
  // past the threshold lands here as a click rather than starting a drag.
  return (
    <div
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
      className={`rounded-md p-2.5 flex flex-col gap-1.5 select-none ${
        accentExternal
          ? "bg-accent-teal/[0.06] border border-accent-teal/40"
          : "bg-card border border-border"
      } ${
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      } ${isDragging ? "opacity-40" : "hover:bg-muted/20"}`}
    >
      <MemberCardBody
        card={card}
        fullName={fullName}
        projectNames={projectNames}
        domainNames={domainNames}
        onRemove={onRemove}
        canEditDomains={canEditDomains}
        allDomains={allDomains}
        onChangeDomainLevel={onChangeDomainLevel}
        onAddDomain={onAddDomain}
        assignmentDomainIds={assignmentDomainIds}
        onToggleAssignmentDomain={onToggleAssignmentDomain}
      />
      {mentorSlot && (
        // Keep drag/click off the mentorship control: a press here must not
        // start a card drag or open the bid modal.
        <div
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="cursor-default"
        >
          {mentorSlot}
        </div>
      )}
    </div>
  );
}

// A non-roster external mentor placed on a project column. Distinct teal
// styling marks it apart from staffed members; it isn't draggable and has no
// bid to open — just a name, its mentoring domain, and a Remove control.
function ExternalMentorCard({
  card,
  fullName,
  onRemove,
}: {
  card: MemberCardModel;
  fullName: string;
  onRemove?: () => void;
}) {
  return (
    <div className="rounded-md p-2.5 flex flex-col gap-1.5 select-none bg-accent-teal/[0.06] border border-accent-teal/40">
      <div className="flex items-start gap-2">
        <Avatar photoUrl={card.photoUrl} name={fullName} size="sm" userId={card.userId} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-foreground truncate text-left">
              {fullName}
            </span>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-accent-teal/15 text-accent-teal">
              <GraduationCap className="w-2.5 h-2.5" aria-hidden />
              External mentor
            </span>
          </div>
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            title="Remove external mentor"
            aria-label={`Remove external mentor ${fullName}`}
            className="flex-shrink-0 text-muted-foreground hover:text-destructive text-sm leading-none px-1 rounded hover:bg-muted"
          >
            ×
          </button>
        )}
      </div>
      <DomainLevelStrip card={card} />
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
  canEditDomains,
  allDomains,
  onChangeDomainLevel,
  onAddDomain,
  assignmentDomainIds,
  onToggleAssignmentDomain,
}: {
  card: MemberCardModel;
  fullName: string;
  projectNames: Record<string, string>;
  domainNames: Record<string, string>;
  onRemove?: () => void;
  canEditDomains?: boolean;
  allDomains?: DomainOption[];
  onChangeDomainLevel?: (domainId: string, level: Level) => void;
  onAddDomain?: (domainId: string, level: Level) => void;
  assignmentDomainIds?: string[];
  onToggleAssignmentDomain?: (domainId: string) => void;
}) {
  return (
    <>
      <div className="flex items-start gap-2">
        <Avatar photoUrl={card.photoUrl} name={fullName} size="sm" userId={card.userId} />
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

      <DomainLevelStrip
        card={card}
        canEdit={canEditDomains}
        allDomains={allDomains}
        onChangeLevel={onChangeDomainLevel}
        onAddDomain={onAddDomain}
        assignmentDomainIds={assignmentDomainIds}
        onToggleAssignmentDomain={onToggleAssignmentDomain}
      />
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

function DomainLevelStrip({
  card,
  canEdit,
  allDomains,
  onChangeLevel,
  onAddDomain,
  assignmentDomainIds,
  onToggleAssignmentDomain,
}: {
  card: MemberCardModel;
  canEdit?: boolean;
  allDomains?: DomainOption[];
  onChangeLevel?: (domainId: string, level: Level) => void;
  onAddDomain?: (domainId: string, level: Level) => void;
  assignmentDomainIds?: string[];
  onToggleAssignmentDomain?: (domainId: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newDomainId, setNewDomainId] = useState("");
  const [newLevel, setNewLevel] = useState<Level>("P1");

  const haveIds = new Set(card.domainLevels.map((d) => d.domainId));
  const available = (allDomains ?? []).filter((d) => !haveIds.has(d.id));
  const selected = new Set(assignmentDomainIds ?? card.assignmentDomainIds ?? []);

  if (card.domainLevels.length === 0 && !canEdit) {
    return <p className="text-[11px] text-muted-foreground italic">No domain eligibility</p>;
  }

  return (
    <div
      className="flex flex-wrap gap-1 items-center"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {card.domainLevels.map((d) => (
        <DomainLevelChip
          key={d.domainId}
          domain={d}
          canEdit={!!canEdit && !!onChangeLevel}
          isAssignment={selected.has(d.domainId)}
          canToggleAssignment={!!onToggleAssignmentDomain}
          onToggleAssignment={() => onToggleAssignmentDomain?.(d.domainId)}
          onChangeLevel={(level) => onChangeLevel?.(d.domainId, level)}
        />
      ))}
      {canEdit && onAddDomain && !adding && available.length > 0 && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          title="Add domain"
          aria-label="Add domain"
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded border border-dashed border-border text-muted-foreground hover:text-foreground hover:bg-muted"
        >
          <Plus className="w-2.5 h-2.5" aria-hidden />
          Domain
        </button>
      )}
      {canEdit && adding && (
        <div className="flex flex-wrap items-center gap-1 w-full mt-0.5">
          <Select
            value={newDomainId}
            onChange={(value) => setNewDomainId(value)}
            ariaLabel="Domain to add"
            placeholder="Domain…"
            options={[
              { value: "", label: "Domain…" },
              ...available.map((d) => ({ value: d.id, label: d.name })),
            ]}
            buttonClassName="max-w-[9rem] rounded border border-border bg-background px-1 py-0.5 text-[10px] text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
          />
          <Select
            value={newLevel}
            onChange={(value) => setNewLevel(value as Level)}
            ariaLabel="Level for new domain"
            options={ALL_LEVELS.map((l) => ({ value: l, label: l }))}
            buttonClassName="rounded border border-border bg-background px-1 py-0.5 text-[10px] font-bold text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
          />
          <button
            type="button"
            disabled={!newDomainId}
            onClick={() => {
              if (!newDomainId) return;
              onAddDomain?.(newDomainId, newLevel);
              setAdding(false);
              setNewDomainId("");
              setNewLevel("P1");
            }}
            className="rounded bg-accent-coral px-1.5 py-0.5 text-[10px] font-medium text-white disabled:opacity-50"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setNewDomainId("");
              setNewLevel("P1");
            }}
            className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      )}
      {card.domainLevels.length === 0 && canEdit && !adding && available.length === 0 && (
        <p className="text-[11px] text-muted-foreground italic">No domains left to add</p>
      )}
    </div>
  );
}

function DomainLevelChip({
  domain,
  canEdit,
  isAssignment,
  canToggleAssignment,
  onToggleAssignment,
  onChangeLevel,
}: {
  domain: DomainLevel;
  canEdit: boolean;
  isAssignment: boolean;
  canToggleAssignment: boolean;
  onToggleAssignment: () => void;
  onChangeLevel: (level: Level) => void;
}) {
  const nameButton = canToggleAssignment ? (
    <button
      type="button"
      onClick={onToggleAssignment}
      title={
        isAssignment
          ? `Remove ${domain.domainName} from staffing assignment`
          : `Staff in ${domain.domainName}`
      }
      aria-pressed={isAssignment}
      className="hover:underline focus:outline-none focus:underline"
    >
      {domain.domainName}
    </button>
  ) : (
    <span>{domain.domainName}</span>
  );

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded ${
        isAssignment
          ? "bg-accent-coral/10 text-foreground ring-1 ring-accent-coral/30"
          : "bg-muted text-foreground"
      }`}
      title={
        isAssignment
          ? `${domain.domainName} · ${domain.level} (staffing assignment)`
          : canToggleAssignment
            ? `Click ${domain.domainName} to staff in this domain · ${domain.level}`
            : `${domain.domainName} · ${domain.level}`
      }
    >
      {nameButton}
      {canEdit ? (
        <Select
          value={domain.level}
          ariaLabel={`Level for ${domain.domainName}`}
          onChange={(value) => onChangeLevel(value as Level)}
          options={ALL_LEVELS.map((l) => ({ value: l, label: l }))}
          buttonClassName={`rounded border-0 px-1 py-0 text-[10px] font-bold focus:outline-none focus:ring-1 focus:ring-accent-coral/40 inline-flex items-center justify-between gap-0.5 transition-colors ${LEVEL_BADGE[domain.level].cls}`}
        />
      ) : (
        <span className={`px-1 rounded font-bold ${LEVEL_BADGE[domain.level].cls}`}>
          {LEVEL_BADGE[domain.level].label}
        </span>
      )}
    </span>
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
