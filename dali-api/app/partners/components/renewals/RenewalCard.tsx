import type { ReactNode } from "react";
import { BoardCard } from "~/components/board/BoardCard";
import { Select } from "~/components/ui/floating";
import { cn } from "~/lib/cn";
import {
  isNextStepOverdue,
  type RenewalCardModel,
  type RenewalColumn,
} from "../../lib/partner-renewals";

function Field({ label, warn, children }: { label: string; warn?: boolean; children: ReactNode }) {
  return (
    <>
      <dt className="text-os-grey">{label}</dt>
      <dd className={cn("min-w-0 break-words", warn ? "text-os-amber" : "text-foreground")}>{children}</dd>
    </>
  );
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

function DecisionButton({
  active,
  tone,
  onClick,
  children,
}: {
  active: boolean;
  tone: "good" | "bad";
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-semibold transition-colors",
        tone === "good"
          ? "bg-os-green/15 text-os-green hover:bg-os-green/25"
          : "bg-destructive/10 text-destructive hover:bg-destructive/20",
        active && "ring-1 ring-current",
      )}
    >
      {children}
    </button>
  );
}

export function RenewalCard({
  card,
  accentEdge,
  now,
  dragHandleProps = {},
  isDragging,
  onOpen,
  onDecide,
  coreMembers,
  onPiChange,
  pendingDecision,
  expansion,
}: {
  card: RenewalCardModel;
  accentEdge: string;
  now: Date;
  dragHandleProps?: Record<string, unknown>;
  isDragging: boolean;
  onOpen: () => void;
  /** Continue / Not continuing right on the card; while the card is expanded
   *  the same buttons switch the pending decision. */
  onDecide?: (decision: RenewalColumn) => void;
  coreMembers?: { userId: string; name: string }[];
  onPiChange?: (piUserId: string | null) => void;
  /** The decision being edited while the card is expanded. */
  pendingDecision?: RenewalColumn;
  /** The decision form, appended below the card's content when editing. */
  expansion?: ReactNode;
}) {
  const expanded = expansion != null;
  const showButtons = onDecide && (expanded || card.column === "undecided");
  return (
    <BoardCard
      accentEdge={accentEdge}
      dragHandleProps={dragHandleProps}
      isDragging={isDragging}
      onOpen={onOpen}
      testId="renewal-card"
    >
      <span className="flex min-w-0 items-center gap-1.5 text-foreground">
        {card.iconEmoji && <span aria-hidden className="shrink-0">{card.iconEmoji}</span>}
        <span className="min-w-0">{card.name}</span>
      </span>
      <div className="mt-1 truncate text-xs text-muted-foreground">
        {card.orgName ? `${card.orgName} · ` : ""}
        {card.termCount} {card.termCount === 1 ? "term" : "terms"}
        {card.fromTermCode ? ` · From ${card.fromTermCode}` : ""}
      </div>
      {coreMembers && onPiChange && (
        <div
          className="mt-2 flex items-center gap-2 text-xs"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className="text-os-grey">PI</span>
          <Select
            ariaLabel={`PI for ${card.name}`}
            value={card.piUserId ?? ""}
            onChange={(v) => onPiChange(v || null)}
            options={[
              { value: "", label: "No PI" },
              ...(card.piUserId && !coreMembers.some((m) => m.userId === card.piUserId)
                ? [{ value: card.piUserId, label: card.piName ?? "Former Core member" }]
                : []),
              ...coreMembers.map((m) => ({ value: m.userId, label: m.name })),
            ]}
          />
        </div>
      )}
      {!expanded && (card.nextStep || (card.column === "not_continuing" && card.reason)) && (
        <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          {card.nextStep && (
            <Field label="Next step" warn={isNextStepOverdue(card.nextStepDueAt, now)}>
              {card.nextStep}
              {card.nextStepDueAt && `, ${shortDate(card.nextStepDueAt)}`}
            </Field>
          )}
          {card.column === "not_continuing" && card.reason && <Field label="Reason">{card.reason}</Field>}
        </dl>
      )}
      {showButtons && (
        <div className="mt-2.5 flex items-center gap-1.5">
          <DecisionButton
            tone="good"
            active={pendingDecision === "continuing"}
            onClick={() => onDecide("continuing")}
          >
            Continue
          </DecisionButton>
          <DecisionButton
            tone="bad"
            active={pendingDecision === "not_continuing"}
            onClick={() => onDecide("not_continuing")}
          >
            Not continuing
          </DecisionButton>
        </div>
      )}
      {expanded && (
        <div
          className="mt-3 border-t border-os-container pt-3"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {expansion}
        </div>
      )}
    </BoardCard>
  );
}
