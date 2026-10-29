import { useMemo, useState } from "react";
import { useFetcher, useNavigate } from "react-router";
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
  type RenewalRole,
} from "../lib/partner-renewals";
import { RenewalCard } from "./renewals/RenewalCard";
import { ContinueForm, ReasonForm, type DomainOption, type TermOption } from "./renewals/RenewalForms";

const ACCENTS = {
  undecided: osStatusAccent("review"),
  continuing: osStatusAccent("done"),
  not_continuing: osStatusAccent("cancelled"),
};

type Pending = { projectId: string; target: "continuing" | "not_continuing" };

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
  const navigate = useNavigate();
  const fetcher = useFetcher<{ error?: string }>();
  const [pending, setPending] = useState<Pending | null>(null);
  const now = useMemo(() => new Date(), []);
  const saving =
    fetcher.state !== "idle" && fetcher.formData
      ? { intent: String(fetcher.formData.get("intent") ?? ""), projectId: String(fetcher.formData.get("projectId") ?? "") }
      : null;
  const grouped = useMemo(
    () => groupRenewals(withPendingDecision(cards, saving).filter((c) => matchesRenewalQuery(c, query))),
    [cards, query, saving?.intent, saving?.projectId],
  );

  const submit = (fields: Record<string, string>) => {
    fetcher.submit({ ...fields, decisionTermId: decisionTerm.id }, { method: "post" });
    setPending(null);
  };

  function handleDragEnd(event: DragEndEvent) {
    const data = event.active.data.current as { projectId?: string; column?: RenewalColumn } | undefined;
    const to = event.over?.id as RenewalColumn | undefined;
    if (!data?.projectId || !data.column || !to || to === data.column) return;
    if (!RENEWAL_COLUMNS.includes(to)) return;
    if (to === "undecided") {
      submit({ intent: "undecided", projectId: data.projectId });
      return;
    }
    setPending({ projectId: data.projectId, target: to });
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

  const confirmContinue = (
    projectId: string,
    v: { termId: string; roles: RenewalRole[]; feeCents: number | null },
  ) =>
    submit({
      intent: "continue",
      projectId,
      termId: v.termId,
      feeCents: v.feeCents == null ? "" : String(v.feeCents),
      roles: JSON.stringify(v.roles.map((r) => ({ domainId: r.domainId, slots: r.slots }))),
    });

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
        renderCard={(c, { isDragging, dragHandleProps }) => {
          const open = pending?.projectId === c.projectId ? pending : null;
          return (
            <RenewalCard
              card={c}
              accentEdge={ACCENTS[c.column].edge}
              staleDays={staleDays}
              lastTermCode={lastTermCode}
              decisionTermCode={decisionTerm.code}
              now={now}
              dragHandleProps={open ? {} : dragHandleProps}
              isDragging={isDragging}
              onOpen={() => navigate(`/projects/${c.projectId}`)}
            >
              {open?.target === "continuing" && (
                <ContinueForm
                  card={c}
                  decisionTermId={decisionTerm.id}
                  termOptions={termOptions}
                  domains={domains}
                  busy={fetcher.state !== "idle"}
                  onCancel={() => setPending(null)}
                  onConfirm={(v) => confirmContinue(c.projectId, v)}
                />
              )}
              {open?.target === "not_continuing" && (
                <ReasonForm
                  busy={fetcher.state !== "idle"}
                  onCancel={() => setPending(null)}
                  onConfirm={(reason) => submit({ intent: "not-continuing", projectId: c.projectId, reason })}
                />
              )}
            </RenewalCard>
          );
        }}
      />
    </div>
  );
}
