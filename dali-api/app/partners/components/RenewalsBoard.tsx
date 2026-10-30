import { useMemo, useState } from "react";
import { useFetcher } from "react-router";
import type { DragEndEvent } from "@dnd-kit/core";
import { KanbanBoard, type KanbanColumn } from "~/components/board/KanbanBoard";
import { BOARD_TITLE_CLASS, boardTitleStyle, osStatusAccent } from "~/components/board/status-accent";
import { cn } from "~/lib/cn";
import {
  RENEWAL_COLUMNS,
  RENEWAL_COLUMN_LABELS,
  groupRenewals,
  withPendingDecision,
  matchesRenewalQuery,
  spotsHeader,
  totalSlots,
  type RenewalCardModel,
  type RenewalColumn,
} from "../lib/partner-renewals";
import { RenewalCard } from "./renewals/RenewalCard";
import {
  RenewalModal,
  toFormFields,
  type DomainOption,
  type RenewalSubmission,
  type TermOption,
} from "./renewals/RenewalModal";

const ACCENTS = {
  undecided: osStatusAccent("review"),
  continuing: osStatusAccent("done"),
  not_continuing: osStatusAccent("cancelled"),
};

type Editing = { projectId: string; decision: RenewalColumn };

export function RenewalsBoard({
  cards,
  query,
  staleDays,
  lastTermCode,
  decisionTerm,
  termOptions,
  domains,
}: {
  cards: RenewalCardModel[];
  query: string;
  staleDays: number;
  lastTermCode: string;
  decisionTerm: { id: string; code: string };
  termOptions: TermOption[];
  domains: DomainOption[];
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const [editing, setEditing] = useState<Editing | null>(null);
  const now = useMemo(() => new Date(), []);
  const saving =
    fetcher.state !== "idle" && fetcher.formData
      ? { intent: String(fetcher.formData.get("intent") ?? ""), projectId: String(fetcher.formData.get("projectId") ?? "") }
      : null;
  const grouped = useMemo(
    () => groupRenewals(withPendingDecision(cards, saving).filter((c) => matchesRenewalQuery(c, query))),
    [cards, query, saving?.intent, saving?.projectId],
  );

  const save = (v: RenewalSubmission) => {
    fetcher.submit({ ...toFormFields(v), decisionTermId: decisionTerm.id }, { method: "post" });
    setEditing(null);
  };

  function handleDragEnd(event: DragEndEvent) {
    const data = event.active.data.current as { projectId?: string; column?: RenewalColumn } | undefined;
    const to = event.over?.id as RenewalColumn | undefined;
    if (!data?.projectId || !data.column || !to || to === data.column) return;
    if (!RENEWAL_COLUMNS.includes(to)) return;
    setEditing({ projectId: data.projectId, decision: to });
  }

  const columns: KanbanColumn<RenewalCardModel>[] = RENEWAL_COLUMNS.map((col) => {
    const accent = ACCENTS[col];
    const list = grouped[col];
    const spots =
      col === "undecided"
        ? spotsHeader(totalSlots(list.flatMap((c) => c.lastRoles)), lastTermCode)
        : col === "continuing"
          ? spotsHeader(totalSlots(list.flatMap((c) => c.decidedRoles)), decisionTerm.code)
          : null;
    return {
      id: col,
      title: (
        <span className={cn("text-sm font-medium", BOARD_TITLE_CLASS)} style={boardTitleStyle(accent)}>
          {RENEWAL_COLUMN_LABELS[col]}
        </span>
      ),
      className: "flex-shrink-0 border border-transparent rounded-os-item bg-os-card flex flex-col w-full md:flex-1 md:min-w-[16rem]",
      headerClassName: "flex items-center justify-between gap-2 px-3 py-2 rounded-t-os-item",
      headerStyle: { background: accent.fill, color: accent.ink },
      headerExtra: (
        <div className="flex shrink-0 items-center gap-2 text-xs text-current">
          {spots && <span>{spots}</span>}
          <span className="rounded-full border border-current/30 px-2 py-0.5 font-medium tabular-nums">
            {list.length}
          </span>
        </div>
      ),
      cards: list,
      listClassName: "flex flex-col gap-2 p-2 min-h-[360px] max-h-[calc(100vh-14rem)] overflow-y-auto",
    };
  });

  const editingCard = editing ? cards.find((c) => c.projectId === editing.projectId) : null;

  return (
    <div className="flex flex-col gap-3">
      {fetcher.data?.error && <p className="text-sm text-os-red">{fetcher.data.error}</p>}
      {query.trim() && cards.length > 0 && RENEWAL_COLUMNS.every((c) => grouped[c].length === 0) && (
        <p className="text-sm text-muted-foreground">No projects match &ldquo;{query.trim()}&rdquo;.</p>
      )}
      <KanbanBoard<RenewalCardModel>
        id="renewals-board"
        columns={columns}
        getCardId={(c) => c.projectId}
        getCardData={(c) => ({ projectId: c.projectId, column: c.column })}
        draggable
        onDragEnd={handleDragEnd}
        renderOverlay={(activeId) => {
          const c = activeId ? cards.find((x) => x.projectId === activeId) : null;
          return c ? (
            <div className="w-64 rotate-1 shadow-xl">
              <RenewalCard
                card={c}
                accentEdge={ACCENTS[c.column].edge}
                staleDays={staleDays}
                lastTermCode={lastTermCode}
                decisionTermCode={decisionTerm.code}
                now={now}
                isDragging={false}
                onOpen={() => {}}
              />
            </div>
          ) : null;
        }}
        renderCard={(c, { isDragging, dragHandleProps }) => (
          <RenewalCard
            card={c}
            accentEdge={ACCENTS[c.column].edge}
            staleDays={staleDays}
            lastTermCode={lastTermCode}
            decisionTermCode={decisionTerm.code}
            now={now}
            dragHandleProps={dragHandleProps}
            isDragging={isDragging}
            onOpen={() => setEditing({ projectId: c.projectId, decision: c.column })}
          />
        )}
      />
      {editing && editingCard && (
        <RenewalModal
          key={`${editing.projectId}:${editing.decision}`}
          card={editingCard}
          initialDecision={editing.decision}
          decisionTerm={decisionTerm}
          termOptions={termOptions}
          domains={domains}
          busy={fetcher.state !== "idle"}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </div>
  );
}
