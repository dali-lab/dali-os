// Client-safe board-state helpers for the Partner CRM kanban — the partner
// counterpart of app/projects/lib/task-board.ts's board half, built on the
// shared app/components/board/board-order.ts primitives so the task board and
// the partner board share column math (PartnerBoard.tsx is modeled line for
// line on TaskBoard.tsx).

import {
  buildBoard,
  moveInBoard,
  nextPositionInColumn,
  type Board,
} from "~/components/board/board-order";
import { PARTNER_STAGES, isPaused, isStale, type PartnerStage } from "./partner-application";

// Cards not on a recognized stage (shouldn't happen — the enum is closed, but
// board-order.ts takes a fallback for the same reason task-board.ts does)
// land here rather than vanishing from the board.
const FALLBACK_STAGE: PartnerStage = "New";

export type PartnerCardModel = {
  id: string;
  title: string;
  stage: PartnerStage;
  /** Alias of `stage` — board-order.ts's generic column ops key on `status`. */
  status: PartnerStage;
  position: number;
  contactName: string;
  orgName: string | null;
  domains: { id: string; name: string }[];
  targetTerms: { id: string; code: string }[];
  nextStep: string | null;
  nextStepDueAt: string | null;
  lastActivityAt: string;
  holdUntil: string | null;
  resultingProjectId: string | null;
  meetingRequestedAt: string | null;
  pendingRequestCount: number;
  meetingCount: number;
  source: string;
  hasUnreadEmail: boolean;
  createdAt: string;
};

export type PartnerCardBoard = Board<PartnerStage, PartnerCardModel>;

export function buildPartnerBoard(cards: PartnerCardModel[]): PartnerCardBoard {
  return buildBoard(cards, PARTNER_STAGES, FALLBACK_STAGE);
}

export function nextPartnerPosition(board: PartnerCardBoard, stage: PartnerStage): number {
  return nextPositionInColumn(board, stage);
}

/**
 * Move `cardId` into `toStage` at `targetIndex` (-1 or past the end appends).
 * Thin wrapper over board-order's generic `moveInBoard`: that helper only
 * writes the generic `status` field, so this re-syncs `stage` from it on every
 * card it touched (just the moved card and its new column's siblings keep the
 * same value, but the moved card's `stage` needs to follow `status`).
 */
export function movePartnerInBoard(
  cards: PartnerCardModel[],
  cardId: string,
  toStage: PartnerStage,
  targetIndex: number,
): { cards: PartnerCardModel[]; orderedIds: string[] } {
  const result = moveInBoard(cards, cardId, toStage, targetIndex, PARTNER_STAGES, FALLBACK_STAGE);
  return {
    cards: result.cards.map((c) => (c.stage === c.status ? c : { ...c, stage: c.status })),
    orderedIds: result.orderedIds,
  };
}

/** Board search: title, contact, org, domains, and the next-step text. */
export function partnerMatchesQuery(card: PartnerCardModel, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (card.title.toLowerCase().includes(q)) return true;
  if (card.contactName.toLowerCase().includes(q)) return true;
  if (card.orgName && card.orgName.toLowerCase().includes(q)) return true;
  if (card.domains.some((d) => d.name.toLowerCase().includes(q))) return true;
  if (card.nextStep && card.nextStep.toLowerCase().includes(q)) return true;
  return false;
}

export const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: "Form", label: "Form" },
  { value: "Email", label: "Email" },
  { value: "Referral", label: "Referral" },
  { value: "Manual", label: "Manual" },
  { value: "Renewal", label: "Renewal" },
];

export type PartnerFilters = {
  term: string | null;
  domain: string | null;
  source: string | null;
  staleOnly: boolean;
  showPaused: boolean;
  showRejectedPastTerms: boolean;
};

export const DEFAULT_FILTERS: PartnerFilters = {
  term: null,
  domain: null,
  source: null,
  staleOnly: false,
  showPaused: true,
  showRejectedPastTerms: false,
};

export function isPartnerFilters(v: unknown): v is PartnerFilters {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    (o.term === null || typeof o.term === "string") &&
    (o.domain === null || typeof o.domain === "string") &&
    (o.source === null || typeof o.source === "string") &&
    typeof o.staleOnly === "boolean" &&
    typeof o.showPaused === "boolean" &&
    typeof o.showRejectedPastTerms === "boolean"
  );
}

export function filterPartnerCards<T extends PartnerCardModel>(
  cards: T[],
  filters: PartnerFilters,
  query: string,
  opts: { staleDays: number; currentTermStartIso: string | null; now?: Date },
): T[] {
  const now = opts.now ?? new Date();
  const currentTermStartMs = opts.currentTermStartIso
    ? new Date(opts.currentTermStartIso).getTime()
    : null;
  return cards.filter((c) => {
    if (filters.term && !c.targetTerms.some((t) => t.id === filters.term)) return false;
    if (filters.domain && !c.domains.some((d) => d.id === filters.domain)) return false;
    if (filters.source && c.source !== filters.source) return false;
    if (filters.staleOnly && !isStale(c, opts.staleDays, now)) return false;
    if (!filters.showPaused && isPaused(c.holdUntil, now)) return false;
    if (
      !filters.showRejectedPastTerms &&
      currentTermStartMs !== null &&
      c.stage === "Rejected" &&
      new Date(c.lastActivityAt).getTime() < currentTermStartMs
    )
      return false;
    return partnerMatchesQuery(c, query);
  });
}
