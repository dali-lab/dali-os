// Built on the same BoardCard shell as TaskBoard's TaskCard so the two kanbans
// read as one system. Facts are labeled rows rather than chips or bare icons:
// an unlabeled chip or icon left Core guessing what a value was.

import type { ReactNode } from "react";
import { Link } from "react-router";
import { BoardCard } from "~/components/board/BoardCard";
import { cn } from "~/lib/cn";
import { isPaused, isStale, PARTNER_SOURCE_LABELS } from "../lib/partner-application";
import { formatCardSpots, type PartnerCardModel } from "../lib/partner-board";

function isOverdue(dueIso: string | null): boolean {
  if (!dueIso) return false;
  const due = new Date(dueIso);
  const today = new Date();
  return (
    Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) >
    Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate())
  );
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function staleDaysCount(lastActivityAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(lastActivityAt).getTime()) / 86_400_000));
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function Field({ label, warn, children }: { label: string; warn?: boolean; children: ReactNode }) {
  return (
    <>
      <dt className="text-os-grey">{label}</dt>
      <dd className={cn("min-w-0 break-words", warn ? "text-os-amber" : "text-foreground")}>{children}</dd>
    </>
  );
}

export function PartnerCard({
  card,
  accentEdge,
  staleDays,
  dragHandleProps = {},
  isDragging,
  onOpen,
}: {
  card: PartnerCardModel;
  accentEdge: string;
  staleDays: number;
  dragHandleProps?: Record<string, unknown>;
  isDragging: boolean;
  onOpen: () => void;
}) {
  const paused = isPaused(card.holdUntil);
  const stale = isStale(
    { stage: card.stage, lastActivityAt: card.lastActivityAt, holdUntil: card.holdUntil },
    staleDays,
  );
  const meetings = [
    card.meetingCount > 0 && `${card.meetingCount} held`,
    card.pendingRequestCount > 0 && `${card.pendingRequestCount} requested`,
  ].filter(Boolean);
  const spots = formatCardSpots(card.domains);
  const quietDays = staleDaysCount(card.lastActivityAt);

  return (
    <BoardCard
      accentEdge={accentEdge}
      dragHandleProps={dragHandleProps}
      isDragging={isDragging}
      onOpen={onOpen}
      testId="partner-card"
    >
      <span className="min-w-0 text-foreground">{card.title}</span>

      <div className="mt-1 truncate text-muted-foreground text-xs">
        {card.contactName}
        {card.orgName ? ` · ${card.orgName}` : ""}
      </div>

      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <Field label="Source">{PARTNER_SOURCE_LABELS[card.source] ?? card.source}</Field>
        {card.targetTerms.length > 0 && (
          <Field label={plural(card.targetTerms.length, "Term", "Terms")}>
            {card.targetTerms.map((t) => t.code).join(", ")}
          </Field>
        )}
        {spots ? (
          <Field label="Spots">{spots}</Field>
        ) : card.domains.length > 0 && (
          <Field label={plural(card.domains.length, "Domain", "Domains")}>
            {card.domains.map((d) => d.name).join(", ")}
          </Field>
        )}
        {card.nextStep && (
          <Field label="Next step" warn={isOverdue(card.nextStepDueAt)}>
            {card.nextStep}
            {card.nextStepDueAt && `, ${formatShortDate(card.nextStepDueAt)}`}
          </Field>
        )}
        {meetings.length > 0 && <Field label="Meetings">{meetings.join(", ")}</Field>}
        {stale && (
          <Field label="Last activity" warn>
            {quietDays} {plural(quietDays, "day", "days")} ago
          </Field>
        )}
        {paused && card.holdUntil && <Field label="Paused">Until {formatShortDate(card.holdUntil)}</Field>}
        {card.resultingProjectId && (
          <Field label="Project">
            <Link
              to={`/projects/${card.resultingProjectId}`}
              onClick={(e) => e.stopPropagation()}
              className="text-os-accent hover:underline"
            >
              Open
            </Link>
          </Field>
        )}
      </dl>
    </BoardCard>
  );
}
