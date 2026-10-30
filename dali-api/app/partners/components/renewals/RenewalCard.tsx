import type { ReactNode } from "react";
import { BoardCard } from "~/components/board/BoardCard";
import { cn } from "~/lib/cn";
import { relativeTime } from "~/lib/relative-time";
import {
  isContactStale,
  isNextStepOverdue,
  rolesLabel,
  type RenewalCardModel,
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

export function RenewalCard({
  card,
  accentEdge,
  staleDays,
  lastTermCode,
  decisionTermCode,
  now,
  dragHandleProps = {},
  isDragging,
  onOpen,
}: {
  card: RenewalCardModel;
  accentEdge: string;
  staleDays: number;
  lastTermCode: string;
  decisionTermCode: string;
  now: Date;
  dragHandleProps?: Record<string, unknown>;
  isDragging: boolean;
  onOpen: () => void;
}) {
  const stale = isContactStale(card.lastContactAt, staleDays, now);
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
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        {card.nextStep && (
          <Field label="Next step" warn={isNextStepOverdue(card.nextStepDueAt, now)}>
            {card.nextStep}
            {card.nextStepDueAt && `, ${shortDate(card.nextStepDueAt)}`}
          </Field>
        )}
        <Field label="Last contact" warn={stale}>
          {card.lastContactAt ? relativeTime(card.lastContactAt) : "None yet"}
        </Field>
        <Field label="Spots">
          {card.column === "not_continuing"
            ? `Ends after ${lastTermCode}`
            : card.column === "continuing"
              ? rolesLabel(card.fromTermCode ?? decisionTermCode, card.decidedRoles)
              : rolesLabel(lastTermCode, card.lastRoles)}
        </Field>
        {card.column === "not_continuing" && card.reason && <Field label="Reason">{card.reason}</Field>}
      </dl>
    </BoardCard>
  );
}
