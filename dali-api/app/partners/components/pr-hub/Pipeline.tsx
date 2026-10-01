import { useMemo, useState } from "react";
import { useFetcher } from "react-router";
import type { DragEndEvent } from "@dnd-kit/core";
import { KanbanBoard, type KanbanColumn } from "~/components/board/KanbanBoard";
import { Modal } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import type { PartnerApplicationStatus } from "../../lib/partner-application";
import { PartnerFavicon } from "./PartnerFavicon";

export type PipelineCard = {
  applicationId: string;
  title: string;
  partnerName: string;
  faviconChar: string | null;
  updatedAt: string; // ISO
  status: PartnerApplicationStatus;
  rejection: { stage: string | null; rationale: string | null } | null;
};

// Four display columns that collapse the live `PartnerApplicationStatus` enum
// into the hub's coarser view. "New" bundles Inquiry/Triaged/ApplicationSubmitted
// (anything freshly in the funnel); "Interview" bundles Meeting/UnderReview/
// LearnMore/OnHold (anything we're actively weighing). Dropping a card onto a
// non-Rejected column maps to a single canonical target status; Rejected opens
// a prompt first.
type ColumnId = "new" | "interview" | "accepted" | "rejected";

const COLUMN_DEF: { id: ColumnId; label: string; hint: string; dot: string }[] = [
  { id: "new", label: "New", hint: "Just came in", dot: "bg-sky-500" },
  { id: "interview", label: "Interview", hint: "In conversation", dot: "bg-amber-500" },
  { id: "accepted", label: "Accepted", hint: "Ready to place", dot: "bg-emerald-500" },
  { id: "rejected", label: "Rejected", hint: "With rationale", dot: "bg-red-500" },
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
  // Promoted applications live on project pages, not on the hub pipeline.
  Promoted: null,
};

// When a drop targets a non-Rejected column, write this canonical status.
const COLUMN_TARGET_STATUS: Record<Exclude<ColumnId, "rejected">, PartnerApplicationStatus> = {
  new: "Triaged",
  interview: "Meeting",
  accepted: "Accepted",
};

const REJECTION_STAGE_OPTS = [
  { id: "Intake", label: "At intake" },
  { id: "Interview", label: "After interview" },
  { id: "Scoping", label: "During scoping" },
  { id: "Funding", label: "Funding fell through" },
  { id: "Other", label: "Other" },
] as const;

function sinceLabel(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const d = Math.max(0, Math.round((Date.now() - then) / 86_400_000));
  if (d === 0) return "today";
  if (d === 1) return "1d";
  return `${d}d`;
}

export function Pipeline({ cards }: { cards: PipelineCard[] }) {
  const fetcher = useFetcher();
  const [rejectFor, setRejectFor] = useState<PipelineCard | null>(null);
  const [rejectStage, setRejectStage] = useState<string>("Intake");
  const [rejectWhy, setRejectWhy] = useState("");

  // Apply optimistic status flips so the card doesn't bounce back during the
  // fetcher roundtrip. The server loader is the source of truth after.
  const pending = fetcher.formData;
  const optimisticMove = useMemo(() => {
    if (!pending || pending.get("_intent") !== "pipeline/move") return null;
    const id = String(pending.get("applicationId") ?? "");
    const status = String(pending.get("status") ?? "") as PartnerApplicationStatus;
    return id ? { id, status } : null;
  }, [pending]);

  const effective = useMemo(() => {
    if (!optimisticMove) return cards;
    return cards.map((c) =>
      c.applicationId === optimisticMove.id ? { ...c, status: optimisticMove.status } : c,
    );
  }, [cards, optimisticMove]);

  const columns = useMemo<KanbanColumn<PipelineCard>[]>(() => {
    const byCol: Record<ColumnId, PipelineCard[]> = {
      new: [],
      interview: [],
      accepted: [],
      rejected: [],
    };
    for (const c of effective) {
      const col = STATUS_TO_COLUMN[c.status];
      if (col) byCol[col].push(c);
    }
    for (const k of Object.keys(byCol) as ColumnId[]) {
      byCol[k].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    return COLUMN_DEF.map((def) => ({
      id: def.id,
      title: (
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${def.dot}`} aria-hidden />
          {def.label}
        </span>
      ),
      subtitle: def.hint,
      cards: byCol[def.id],
    }));
  }, [effective]);

  function postMove(id: string, status: PartnerApplicationStatus, extra?: Record<string, string>) {
    fetcher.submit(
      { _intent: "pipeline/move", applicationId: id, status, ...(extra ?? {}) },
      { method: "post", action: "/partners" },
    );
  }

  function handleDragEnd(event: DragEndEvent) {
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
      setRejectFor(card);
      setRejectStage("Intake");
      setRejectWhy("");
      return;
    }
    postMove(activeId, COLUMN_TARGET_STATUS[target.id as Exclude<ColumnId, "rejected">]);
  }

  function confirmReject() {
    if (!rejectFor) return;
    postMove(rejectFor.applicationId, "Rejected", {
      rejectionStage: rejectStage,
      rejectionRationale: rejectWhy.trim() || "—",
    });
    setRejectFor(null);
  }

  return (
    <section className="flex flex-col h-full min-h-0 rounded-os-card bg-os-card overflow-hidden">
      <header className="px-4 py-3 border-b border-border">
        <h2 className="section-title text-foreground">Partner pipeline</h2>
        <p className="text-xs text-muted-foreground">
          Drag between stages. Dropping on Rejected prompts for a reason.
        </p>
      </header>
      <div className="flex-1 overflow-hidden p-3">
        <KanbanBoard<PipelineCard>
          id="partner-relations-pipeline"
          columns={columns}
          getCardId={(c) => c.applicationId}
          getCardData={(c) => ({ applicationId: c.applicationId, status: c.status })}
          renderCard={(c, { dragHandleProps, isDragging }) => (
            <PipelineCardView card={c} dragHandleProps={dragHandleProps} isDragging={isDragging} />
          )}
          draggable
          onDragEnd={handleDragEnd}
          error={fetcher.data && (fetcher.data as { error?: string }).error ? (fetcher.data as { error: string }).error : null}
          emptyLabel="Drop cards here"
        />
      </div>

      {rejectFor && (
        <Modal
          open={!!rejectFor}
          onClose={() => setRejectFor(null)}
          labelledBy="reject-prompt-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          containerClassName={modalCardClass("sm")}
        >
          <div className="p-5">
            <h3 id="reject-prompt-title" className="os-modal-title">
              Reject application
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Record why we passed so future-you can look back.
            </p>
            <p className="text-xs text-muted-foreground mt-3">
              {rejectFor.partnerName}
            </p>

            <div className="mt-4">
              <p className="os-field-label">Stage at rejection</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {REJECTION_STAGE_OPTS.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setRejectStage(o.id)}
                    className={
                      rejectStage === o.id
                        ? "rounded-full border border-os-accent bg-os-accent px-3 py-1 text-xs font-medium text-os-bg"
                        : "rounded-full border border-border bg-os-well px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
                    }
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <p className="os-field-label">Short rationale</p>
              <textarea
                value={rejectWhy}
                onChange={(e) => setRejectWhy(e.target.value)}
                rows={3}
                placeholder="e.g. Scope didn't fit DALI's student teams; suggested Thayer capstone."
                className="mt-1 w-full rounded-[10px] border border-border bg-os-well px-3 py-2 text-sm text-foreground focus:border-os-accent focus:outline-none"
              />
            </div>

            <div className="os-modal-footer mt-5">
              <button
                type="button"
                onClick={() => setRejectFor(null)}
                className="os-btn-ghost"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmReject}
                className="os-btn-primary"
              >
                Reject
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

function PipelineCardView({
  card,
  dragHandleProps,
  isDragging,
}: {
  card: PipelineCard;
  dragHandleProps: Record<string, unknown>;
  isDragging: boolean;
}) {
  return (
    <div
      {...dragHandleProps}
      className={
        "rounded-os-item border border-border bg-os-well px-3 py-2.5 cursor-grab active:cursor-grabbing hover:border-os-container-hi transition " +
        (isDragging ? "opacity-50" : "")
      }
    >
      <div className="flex items-start gap-2.5">
        <PartnerFavicon char={card.faviconChar} name={card.partnerName} size="xs" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-foreground truncate">
              {card.partnerName}
            </span>
            <span className="text-[10.5px] text-muted-foreground shrink-0">
              {sinceLabel(card.updatedAt)}
            </span>
          </div>
          <p className="text-[11.5px] text-muted-foreground mt-0.5 line-clamp-2">
            {card.title}
          </p>
        </div>
      </div>
      {card.status === "Rejected" && card.rejection && (card.rejection.stage || card.rejection.rationale) && (
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
  );
}
