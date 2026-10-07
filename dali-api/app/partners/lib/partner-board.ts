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
import { PARTNER_STAGES, type PartnerStage } from "./partner-application";

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
