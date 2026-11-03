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
import {
  filterValues,
  type ColumnFilter,
  type FilterCells,
} from "~/projects/lib/submission-filters";
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
  domains: { id: string; name: string; expectedMembers: number }[];
  targetTerms: { id: string; code: string }[];
  nextStep: string | null;
  nextStepDueAt: string | null;
  feeCents: number | null;
  lastActivityAt: string;
  holdUntil: string | null;
  resultingProjectId: string | null;
  projectIconEmoji: string | null;
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

export const CARD_SORTS = ["manual", "next-step", "last-contact", "fee"] as const;

export type PartnerCardSort = (typeof CARD_SORTS)[number];

export const CARD_SORT_LABELS: Record<PartnerCardSort, string> = {
  manual: "Manual",
  "next-step": "Next step",
  "last-contact": "Last contact",
  fee: "Fee",
};

export function isCardSort(v: unknown): v is PartnerCardSort {
  return typeof v === "string" && (CARD_SORTS as readonly string[]).includes(v);
}

function byNullsLast(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * dir;
}

/** Orders one column's cards. Manual keeps the incoming (drag) order. */
export function sortPartnerCards<T extends PartnerCardModel>(cards: T[], sort: PartnerCardSort): T[] {
  if (sort === "manual") return cards;
  const time = (iso: string | null) => (iso ? new Date(iso).getTime() : null);
  const cmp: Record<Exclude<PartnerCardSort, "manual">, (a: T, b: T) => number> = {
    "next-step": (a, b) => byNullsLast(time(a.nextStepDueAt), time(b.nextStepDueAt), 1),
    "last-contact": (a, b) => byNullsLast(time(a.lastActivityAt), time(b.lastActivityAt), 1),
    fee: (a, b) => byNullsLast(a.feeCents, b.feeCents, -1),
  };
  return [...cards].sort(cmp[sort]);
}

export function sortPartnerBoard(board: PartnerCardBoard, sort: PartnerCardSort): PartnerCardBoard {
  if (sort === "manual") return board;
  return Object.fromEntries(
    PARTNER_STAGES.map((stage) => [stage, sortPartnerCards(board[stage] ?? [], sort)]),
  ) as PartnerCardBoard;
}

/** Seed the filter builder from a report or notification link:
 *  ?source=Form and ?term=<termId> open with those column filters set. */
export function columnFiltersFromParams(
  params: URLSearchParams,
  valid: { sources: string[]; terms: { id: string; code: string }[] },
): ColumnFilter[] {
  const filters: ColumnFilter[] = [];
  const source = params.get("source");
  if (source && valid.sources.includes(source)) {
    filters.push({ columnKey: "source", values: [source] });
  }
  const term = valid.terms.find((t) => t.id === params.get("term"));
  if (term) filters.push({ columnKey: "term", values: [term.code] });
  return filters;
}

export function formatCardSpots(domains: PartnerCardModel["domains"]): string {
  return domains
    .filter((d) => d.expectedMembers > 0)
    .map((d) => `${d.name} ${d.expectedMembers}`)
    .join(", ");
}

export const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: "Form", label: "Form" },
  { value: "Email", label: "Email" },
  { value: "Referral", label: "Referral" },
  { value: "Manual", label: "Manual" },
];

export const ACTIVITY_OPTIONS = ["Stale", "Active"] as const;

export function partnerActivityLabel(
  card: PartnerCardModel,
  staleDays: number,
  now = new Date(),
): (typeof ACTIVITY_OPTIONS)[number] {
  return isStale(card, staleDays, now) ? "Stale" : "Active";
}

/** The cell strings the shared ColumnFilters builder matches a card on. */
export function partnerCardCells(
  card: PartnerCardModel,
  staleDays: number,
  now = new Date(),
): FilterCells {
  return {
    term: card.targetTerms.map((t) => t.code),
    domain: card.domains.map((d) => d.name),
    source: card.source,
    activity: partnerActivityLabel(card, staleDays, now),
  };
}

export type PartnerFilters = {
  terms: string[];
  domains: string[];
  sources: string[];
  activity: string[];
  showPaused: boolean;
  showRejectedPastTerms: boolean;
};

export const DEFAULT_FILTERS: PartnerFilters = {
  terms: [],
  domains: [],
  sources: [],
  activity: [],
  showPaused: true,
  showRejectedPastTerms: false,
};

/** Board display options, edited in Partner settings and kept in the URL. */
export type PartnerBoardPrefs = {
  sort: PartnerCardSort;
  showPaused: boolean;
  showRejectedPastTerms: boolean;
};

export const DEFAULT_BOARD_PREFS: PartnerBoardPrefs = {
  sort: "manual",
  showPaused: true,
  showRejectedPastTerms: false,
};

// In the URL only where they differ from the defaults: `sort=<card sort>`,
// `paused=hide`, `rejected=show`.
export function boardPrefsFromParams(params: URLSearchParams): PartnerBoardPrefs {
  const sort = params.get("sort");
  return {
    sort: isCardSort(sort) ? sort : DEFAULT_BOARD_PREFS.sort,
    showPaused: params.get("paused") !== "hide",
    showRejectedPastTerms: params.get("rejected") === "show",
  };
}

export function writeBoardPrefsParams(prev: URLSearchParams, prefs: PartnerBoardPrefs): URLSearchParams {
  const params = new URLSearchParams(prev);
  if (prefs.sort === DEFAULT_BOARD_PREFS.sort) params.delete("sort");
  else params.set("sort", prefs.sort);
  if (prefs.showPaused) params.delete("paused");
  else params.set("paused", "hide");
  if (prefs.showRejectedPastTerms) params.set("rejected", "show");
  else params.delete("rejected");
  return params;
}

export function partnerFiltersFromColumns(
  active: readonly ColumnFilter[],
  prefs: PartnerBoardPrefs,
): PartnerFilters {
  return {
    terms: filterValues(active, "term"),
    domains: filterValues(active, "domain"),
    sources: filterValues(active, "source"),
    activity: filterValues(active, "activity"),
    showPaused: prefs.showPaused,
    showRejectedPastTerms: prefs.showRejectedPastTerms,
  };
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
    if (filters.terms.length && !c.targetTerms.some((t) => filters.terms.includes(t.code)))
      return false;
    if (filters.domains.length && !c.domains.some((d) => filters.domains.includes(d.name)))
      return false;
    if (filters.sources.length && !filters.sources.includes(c.source)) return false;
    if (
      filters.activity.length &&
      !filters.activity.includes(partnerActivityLabel(c, opts.staleDays, now))
    )
      return false;
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
