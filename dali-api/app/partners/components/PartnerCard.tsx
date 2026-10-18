// The partner board's card — PartnerCard is to PartnerBoard what TaskCard is
// to TaskBoard (app/projects/components/TaskBoard.tsx): built on the same
// BoardCard/BoardCardMetaRow/BoardCardMeta/BoardCardChip primitives so the
// two kanbans read as one system.

import { Link } from "react-router";
import {
  CalendarDays,
  FileText,
  Mail,
  Pencil,
  RefreshCw,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Tooltip } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import {
  BoardCard,
  BoardCardChip,
  BoardCardMeta,
  BoardCardMetaRow,
} from "~/components/board/BoardCard";
import { isPaused, isStale } from "../lib/partner-application";
import type { PartnerCardModel } from "../lib/partner-board";

const SOURCE_ICON: Record<string, LucideIcon> = {
  Email: Mail,
  Form: FileText,
  Referral: UserPlus,
  Manual: Pencil,
  Renewal: RefreshCw,
};

const SOURCE_LABEL: Record<string, string> = {
  Email: "Logged from an email",
  Form: "Submitted the application form",
  Referral: "Referral",
  Manual: "Added manually by Core",
  Renewal: "Auto-created renewal",
};

function isOverdue(dueIso: string | null): boolean {
  if (!dueIso) return false;
  const due = new Date(dueIso);
  const today = new Date();
  return (
    Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) >
    Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate())
  );
}

function formatDuePill(iso: string): string {
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
  const { os } = useOsChrome();
  const paused = isPaused(card.holdUntil);
  const stale = isStale(
    { stage: card.stage, lastActivityAt: card.lastActivityAt, holdUntil: card.holdUntil },
    staleDays,
  );
  const overdue = isOverdue(card.nextStepDueAt);
  const SourceIcon = SOURCE_ICON[card.source] ?? Mail;

  return (
    <BoardCard
      accentEdge={accentEdge}
      dragHandleProps={dragHandleProps}
      isDragging={isDragging}
      onOpen={onOpen}
      testId="partner-card"
    >
      <div className="flex items-start justify-between gap-1.5">
        <span className="min-w-0 text-foreground">{card.title}</span>
        <Tooltip content={SOURCE_LABEL[card.source] ?? card.source}>
          <SourceIcon
            aria-label={SOURCE_LABEL[card.source] ?? card.source}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
          />
        </Tooltip>
      </div>

      <div className="mt-1 truncate text-muted-foreground text-xs">
        {card.contactName}
        {card.orgName ? ` · ${card.orgName}` : ""}
      </div>

      <BoardCardMetaRow>
        {card.nextStep && (
          <BoardCardMeta
            icon={
              <CalendarDays
                aria-hidden
                className={
                  overdue
                    ? os
                      ? "h-3.5 w-3.5 text-os-amber"
                      : "h-3.5 w-3.5 text-accent-coral"
                    : "h-3.5 w-3.5"
                }
              />
            }
            title={
              card.nextStepDueAt
                ? `${card.nextStep}, due ${formatDuePill(card.nextStepDueAt)}`
                : card.nextStep
            }
          >
            <span className="max-w-[9rem] truncate">{card.nextStep}</span>
            {card.nextStepDueAt && ` · ${formatDuePill(card.nextStepDueAt)}`}
          </BoardCardMeta>
        )}

        {stale && (
          <BoardCardChip tone="warn" title="No activity past the stale threshold">
            Stale {staleDaysCount(card.lastActivityAt)}d
          </BoardCardChip>
        )}

        {paused && (
          <BoardCardChip tone="neutral" title="Parked, hidden from the stale sweep until it lifts">
            Paused
          </BoardCardChip>
        )}

        {card.resultingProjectId && (
          <Link
            to={`/projects/${card.resultingProjectId}`}
            onClick={(e) => e.stopPropagation()}
          >
            <BoardCardChip tone="good" title="Promoted to a project, open it">
              Project
            </BoardCardChip>
          </Link>
        )}

        {card.pendingRequestCount > 0 && (
          <BoardCardChip
            tone="accent"
            title={`${card.pendingRequestCount} pending meeting request${card.pendingRequestCount === 1 ? "" : "s"}`}
          >
            Meeting requested
          </BoardCardChip>
        )}

        {card.meetingCount > 0 && (
          <BoardCardMeta
            icon={<Users aria-hidden className="h-3.5 w-3.5" />}
            title={`${card.meetingCount} meeting${card.meetingCount === 1 ? "" : "s"}`}
          >
            {card.meetingCount}
          </BoardCardMeta>
        )}

        {card.domains.map((d) => (
          <BoardCardChip key={d.id} tone="accent">
            {d.name}
          </BoardCardChip>
        ))}

        {card.targetTerms.map((t) => (
          <span
            key={t.id}
            className={
              os
                ? "rounded-full border border-os-container px-1.5 py-0.5 text-os-grey"
                : "rounded-md border border-border px-1.5 py-0.5 text-muted-foreground"
            }
          >
            {t.code}
          </span>
        ))}
      </BoardCardMetaRow>
    </BoardCard>
  );
}
