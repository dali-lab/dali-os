import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
import type { DragEndEvent } from "@dnd-kit/core";
import { KanbanBoard, type KanbanColumn } from "~/components/board/KanbanBoard";
import type { PartnerApplicationStatus } from "../../lib/partner-application";
import { PartnerFavicon } from "./PartnerFavicon";
import { ArrowUpRight, CornerDownLeft, GripVertical } from "lucide-react";
import { SearchInput } from "~/components/ui/SearchInput";

export type PipelineCard = {
  applicationId: string;
  title: string;
  partnerName: string;
  faviconChar: string | null;
  updatedAt: string; // ISO
  status: PartnerApplicationStatus;
  rejection: { stage: string | null; rationale: string | null } | null;
};

type ColumnId = "new" | "interview" | "accepted" | "rejected";

const COLUMN_DEF: {
  id: ColumnId;
  label: string;
  hint: string;
  dot: string;
  titleColor: string;
}[] = [
  { id: "new", label: "New", hint: "Just came in", dot: "bg-sky-500", titleColor: "text-sky-700 dark:text-sky-300" },
  { id: "interview", label: "Interview", hint: "In conversation", dot: "bg-amber-500", titleColor: "text-amber-700 dark:text-amber-300" },
  { id: "accepted", label: "Accepted", hint: "Ready to place", dot: "bg-emerald-500", titleColor: "text-emerald-700 dark:text-emerald-300" },
  { id: "rejected", label: "Rejected", hint: "With rationale", dot: "bg-red-500", titleColor: "text-red-700 dark:text-red-300" },
];

const STATUS_TO_COLUMN: Record<PartnerApplicationStatus, ColumnId | null> = {
  Inquiry: "new",
  Triaged: "new",
  ApplicationSubmitted: "new",
  Submitted: "new",
  Meeting: "interview",
  UnderReview: "interview",
  LearnMore: "interview",
  OnHold: "interview",
  Accepted: "accepted",
  Rejected: "rejected",
  Promoted: null,
};

const COLUMN_TARGET_STATUS: Record<Exclude<ColumnId, "rejected">, PartnerApplicationStatus> = {
  new: "Triaged",
  interview: "Meeting",
  accepted: "Accepted",
};

type RejectionStage = "Intake" | "Interview" | "Scoping" | "Funding" | "Other";

// Derive a sensible default stage from the status the card is being rejected
// *from* — saves the user a click. They can refine it later in the drawer if
// needed.
function stageFromStatus(s: PartnerApplicationStatus): RejectionStage {
  if (s === "Inquiry" || s === "Triaged" || s === "ApplicationSubmitted" || s === "Submitted") {
    return "Intake";
  }
  if (s === "Meeting" || s === "UnderReview" || s === "LearnMore" || s === "OnHold") {
    return "Interview";
  }
  if (s === "Accepted") return "Scoping";
  return "Other";
}

function sinceLabel(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const d = Math.max(0, Math.round((Date.now() - then) / 86_400_000));
  if (d === 0) return "today";
  if (d === 1) return "1d";
  return `${d}d`;
}

export function Pipeline({ cards, canEdit = false, onOpen }: { cards: PipelineCard[]; canEdit?: boolean; onOpen?: (id: string) => void }) {
  const fetcher = useFetcher();
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<ColumnId | "all">("all");

  // In-flight rejection waiting for a rationale: the card has already moved
  // optimistically to the Rejected column, and a floating "Why?" input is
  // anchored to it. Writing + confirming saves the move; dismissing without
  // content lets the card snap back to `from`.
  const [pendingReject, setPendingReject] = useState<
    { id: string; from: PartnerApplicationStatus } | null
  >(null);

  // Optimistic status for the usual (non-rejection) moves — mirrors the
  // in-flight fetcher payload so cards don't bounce between columns while the
  // POST is in flight.
  const pending = fetcher.formData;
  const optimisticMove = useMemo(() => {
    if (!pending || pending.get("_intent") !== "pipeline/move") return null;
    const id = String(pending.get("applicationId") ?? "");
    const status = String(pending.get("status") ?? "") as PartnerApplicationStatus;
    return id ? { id, status } : null;
  }, [pending]);

  const effective = useMemo(() => {
    return cards.map((c) => {
      if (pendingReject && pendingReject.id === c.applicationId) {
        return { ...c, status: "Rejected" as PartnerApplicationStatus };
      }
      if (optimisticMove && optimisticMove.id === c.applicationId) {
        return { ...c, status: optimisticMove.status };
      }
      return c;
    });
  }, [cards, pendingReject, optimisticMove]);

  const columns = useMemo<KanbanColumn<PipelineCard>[]>(() => {
    const byCol: Record<ColumnId, PipelineCard[]> = {
      new: [],
      interview: [],
      accepted: [],
      rejected: [],
    };
    for (const c of effective) {
      if (query.trim() && !`${c.title} ${c.partnerName}`.toLowerCase().includes(query.trim().toLowerCase())) continue;
      const col = STATUS_TO_COLUMN[c.status];
      if (col) byCol[col].push(c);
    }
    for (const k of Object.keys(byCol) as ColumnId[]) {
      byCol[k].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    return COLUMN_DEF.filter((def) => stage === "all" || def.id === stage).map((def) => ({
      id: def.id,
      className: `hub-lane hub-lane-${def.id}`,
      headerClassName: "hub-lane-heading",
      listClassName: "hub-lane-cards",
      title: (
        <span className="hub-lane-title">
          <span className="hub-diamond" aria-hidden />
          {def.label}
        </span>
      ),
      subtitle: def.hint,
      cards: byCol[def.id],
    }));
  }, [effective, query, stage]);

  function postMove(
    id: string,
    status: PartnerApplicationStatus,
    extra?: Record<string, string>,
  ) {
    fetcher.submit(
      { _intent: "pipeline/move", applicationId: id, status, ...(extra ?? {}) },
      { method: "post", action: "/partners" },
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    if (!canEdit) return;
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId) return;
    const target = COLUMN_DEF.find((c) => c.id === overId);
    if (!target) return;
    const card = effective.find((c) => c.applicationId === activeId);
    if (!card) return;
    const currentCol = STATUS_TO_COLUMN[card.status];
    if (currentCol === target.id) return;

    if (target.id === "rejected") {
      // Start the inline rationale flow — the card moves optimistically and
      // the anchored input renders inside its card body (see
      // PipelineCardView). Only one at a time; if another reject is already
      // pending, resolve-or-cancel is handled by that one's own blur path.
      setPendingReject({ id: activeId, from: card.status });
      return;
    }
    postMove(activeId, COLUMN_TARGET_STATUS[target.id as Exclude<ColumnId, "rejected">]);
  }

  function confirmReject(id: string, rationale: string) {
    const current = pendingReject;
    if (!current || current.id !== id) return;
    const stage = stageFromStatus(current.from);
    postMove(id, "Rejected", {
      rejectionStage: stage,
      rejectionRationale: rationale,
    });
    setPendingReject(null);
  }

  function cancelReject(id: string) {
    const current = pendingReject;
    if (!current || current.id !== id) return;
    setPendingReject(null);
  }

  return (
    <section id="partner-pipeline" className="hub-pipeline">
      <header className="hub-section-heading">
        <div><h2>Partner pipeline<span className="hub-heading-count">{cards.length}</span></h2><p>{canEdit ? "Move the conversation forward. Drag cards between stages or use the stage menu." : "Follow each opportunity from first conversation to final decision."}</p></div>
        <Link to="/partners/applications" className="hub-text-link">All applications <ArrowUpRight aria-hidden /></Link>
      </header>
      <div className="hub-pipeline-toolbar">
        <div className="hub-stage-filters" role="group" aria-label="Filter pipeline by stage">
          <button type="button" aria-pressed={stage === "all"} onClick={() => setStage("all")}>All opportunities</button>
          {COLUMN_DEF.map((def) => <button type="button" key={def.id} className={`hub-filter-${def.id}`} aria-pressed={stage === def.id} onClick={() => setStage(def.id)}><span className="hub-diamond" aria-hidden />{def.label}<span>{effective.filter((card) => STATUS_TO_COLUMN[card.status] === def.id).length}</span></button>)}
        </div>
        <SearchInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find an opportunity…" aria-label="Find an opportunity" containerClassName="hub-pipeline-search" />
      </div>
      <div className="hub-board" data-filtered={stage !== "all"}>
        <KanbanBoard<PipelineCard>
          id="partner-relations-pipeline"
          columns={columns}
          getCardId={(c) => c.applicationId}
          getCardData={(c) => ({ applicationId: c.applicationId, status: c.status })}
          renderCard={(c, { dragHandleProps, isDragging }) => (
            <PipelineCardView
              card={c}
              dragHandleProps={dragHandleProps}
              isDragging={isDragging}
              pendingReject={pendingReject?.id === c.applicationId}
              onConfirmReject={(rationale) => confirmReject(c.applicationId, rationale)}
              onCancelReject={() => cancelReject(c.applicationId)}
              onOpen={() => onOpen?.(c.applicationId)}
              canEdit={canEdit}
              onMove={(target) => {
                if (target === "rejected") {
                  setStage("all");
                  setPendingReject({ id: c.applicationId, from: c.status });
                }
                else postMove(c.applicationId, COLUMN_TARGET_STATUS[target]);
              }}
            />
          )}
          draggable={canEdit}
          onDragEnd={handleDragEnd}
          error={
            fetcher.data && (fetcher.data as { error?: string; ok?: boolean }).error
              ? (fetcher.data as { error: string }).error
              : fetcher.state === "idle" &&
                  fetcher.data &&
                  (fetcher.data as { ok?: boolean }).ok === false
                ? "The server rejected the move. Check Core access and refresh."
                : null
          }
          emptyLabel={query ? "No matching opportunities" : canEdit ? "No opportunities yet. Drop a card here." : "No opportunities in this stage."}
        />
      </div>
    </section>
  );
}

function PipelineCardView({
  card,
  dragHandleProps,
  isDragging,
  pendingReject,
  onConfirmReject,
  onCancelReject,
  onOpen,
  canEdit,
  onMove,
}: {
  card: PipelineCard;
  dragHandleProps: Record<string, unknown>;
  isDragging: boolean;
  pendingReject: boolean;
  onConfirmReject: (rationale: string) => void;
  onCancelReject: () => void;
  onOpen: () => void;
  canEdit: boolean;
  onMove: (stage: ColumnId) => void;
}) {
  // Spread dragHandleProps on the whole card body so the entire surface
  // initiates a drag — the small grip was too fiddly to grab reliably. The
  // KanbanBoard's 6px activation distance disambiguates click-to-open from
  // drag-to-move for the inner button/select.
  const bodyHandleProps = canEdit ? dragHandleProps : {};
  return (
    <div className={`hub-opportunity hub-opportunity-${STATUS_TO_COLUMN[card.status]}${isDragging ? " is-dragging" : ""}${pendingReject ? " is-rejecting" : ""}`}>
      <div
        className="hub-opportunity-body"
        {...bodyHandleProps}
      >
        <div className="hub-opportunity-meta">
          <PartnerFavicon char={card.faviconChar} name={card.partnerName} size="xs" />
          <span className="hub-opportunity-partner">{card.partnerName}</span>
          {canEdit && <span className="hub-drag-handle" aria-hidden><GripVertical /></span>}
        </div>
        <button type="button" onClick={onOpen} className="hub-opportunity-open"><h3>{card.title}</h3><ArrowUpRight aria-hidden /></button>
        <div className="hub-opportunity-footer"><span>Updated {sinceLabel(card.updatedAt)}</span>{canEdit ? <select aria-label={`Move ${card.title} to stage`} value={STATUS_TO_COLUMN[card.status] ?? "new"} onChange={(event) => onMove(event.target.value as ColumnId)} onPointerDown={(e) => e.stopPropagation()} disabled={pendingReject}>{COLUMN_DEF.map((def) => <option key={def.id} value={def.id}>{def.label}</option>)}</select> : <span>{COLUMN_DEF.find((def) => def.id === STATUS_TO_COLUMN[card.status])?.label}</span>}</div>
        {!pendingReject && card.status === "Rejected" && card.rejection && (card.rejection.stage || card.rejection.rationale) && (
          <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10.5px] text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            <div className="font-medium">
              Rejected{card.rejection.stage ? ` · ${card.rejection.stage}` : ""}
            </div>
            {card.rejection.rationale && (
              <div className="line-clamp-2 opacity-90">{card.rejection.rationale}</div>
            )}
          </div>
        )}
      </div>
      {pendingReject && (
        <RejectRationalePopover
          onConfirm={onConfirmReject}
          onCancel={onCancelReject}
        />
      )}
    </div>
  );
}

function RejectRationalePopover({
  onConfirm,
  onCancel,
}: {
  onConfirm: (rationale: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function resolve() {
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
    else onCancel();
  }

  return (
    <div
      // Anchored below the card, non-modal — nothing outside is darkened.
      className="hub-reject-popover"
      // Prevent dnd-kit from treating a click inside the popover as a drag
      // activator on the card beneath it.
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            resolve();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={resolve}
        placeholder="Why?"
        aria-label="Rejection rationale"
        className="flex-1 !bg-transparent text-[12.5px] text-foreground placeholder:text-muted-foreground focus:outline-none"
      />
      <button
        type="button"
        onClick={resolve}
        aria-label="Save rationale"
        className={
          "grid place-items-center h-6 w-6 rounded-md transition " +
          (value.trim()
            ? "bg-red-500 text-white hover:bg-red-600"
            : "bg-neutral-200 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-600")
        }
      >
        <CornerDownLeft className="h-3.5 w-3.5" strokeWidth={2.5} />
      </button>
    </div>
  );
}
