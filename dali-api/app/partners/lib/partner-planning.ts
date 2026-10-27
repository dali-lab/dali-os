import type { PartnerCardModel } from "./partner-board";

export const PARTNER_PLANNING_STATUSES = [
  "Continuing",
  "New",
  "Maybe",
  "Later",
] as const;

export type PartnerPlanningStatus = (typeof PARTNER_PLANNING_STATUSES)[number];

export const PARTNER_PLANNING_PILL: Record<PartnerPlanningStatus, string> = {
  Continuing: "bg-[var(--os-role-green-fill)] text-[var(--os-role-green-ink)]",
  New: "bg-[var(--os-role-blue-fill)] text-[var(--os-role-blue-ink)]",
  Maybe: "bg-[var(--os-role-amber-fill)] text-[var(--os-role-amber-ink)]",
  Later: "bg-[var(--os-role-red-fill)] text-[var(--os-role-red-ink)]",
};

export const PARTNER_PLANNING_DOT: Record<PartnerPlanningStatus, string> = {
  Continuing: "bg-[var(--os-role-green-ink)]",
  New: "bg-[var(--os-role-blue-ink)]",
  Maybe: "bg-[var(--os-role-amber-ink)]",
  Later: "bg-[var(--os-role-red-ink)]",
};

export type PlanningStatusFilter = PartnerPlanningStatus | "Unset";

export type PlanTermEntry = {
  targetTermId: string;
  termId: string;
  code: string;
  sortKey: number;
  planningStatus: PartnerPlanningStatus | null;
  plannerNotes: string | null;
  plannerTodo: string | null;
};

export type PartnerListCard = PartnerCardModel & {
  partnerName: string;
  feeCents: number | null;
  plan: PlanTermEntry[];
  headcount: { id: string; domainId: string; expectedMembers: number }[];
};

export type PlannerRow = { card: PartnerListCard; entry: PlanTermEntry | null };

export type PlannerGroup = { key: string; label: string; rows: PlannerRow[] };

export const NO_TERM_GROUP = "none";

// Unset sits between Maybe and Later: Later is the "parked" tail of a term.
function planningRank(status: PartnerPlanningStatus | null): number {
  if (status === null) return 3;
  return status === "Later" ? 4 : PARTNER_PLANNING_STATUSES.indexOf(status);
}

function byPlanThenTitle(a: PlannerRow, b: PlannerRow): number {
  const diff =
    planningRank(a.entry?.planningStatus ?? null) - planningRank(b.entry?.planningStatus ?? null);
  return diff !== 0 ? diff : a.card.title.localeCompare(b.card.title);
}

/** One row per (application, target term). A single-term scope yields one
 *  group; All yields a group per term, newest first, then the applications
 *  with no target term. */
export function groupPlannerRows(
  cards: PartnerListCard[],
  term: string | null,
  statusFilter: PlanningStatusFilter | null,
): PlannerGroup[] {
  const groups = new Map<string, PlannerGroup & { sortKey: number }>();
  const add = (key: string, label: string, sortKey: number, row: PlannerRow) => {
    const status = row.entry?.planningStatus ?? "Unset";
    if (statusFilter && status !== statusFilter) return;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, label, sortKey, rows: [] }));
    g.rows.push(row);
  };

  for (const card of cards) {
    const entries = term ? card.plan.filter((e) => e.termId === term) : card.plan;
    for (const entry of entries) add(entry.termId, entry.code, entry.sortKey, { card, entry });
    if (!term && card.plan.length === 0) {
      add(NO_TERM_GROUP, "No target term", Number.NEGATIVE_INFINITY, { card, entry: null });
    }
  }

  return [...groups.values()]
    .sort((a, b) => b.sortKey - a.sortKey)
    .map(({ key, label, rows }) => ({ key, label, rows: rows.sort(byPlanThenTitle) }));
}

export function groupTotals(rows: PlannerRow[]): {
  feeCents: number;
  members: Map<string, number>;
} {
  let feeCents = 0;
  const members = new Map<string, number>();
  for (const { card } of rows) {
    feeCents += card.feeCents ?? 0;
    for (const h of card.headcount) {
      members.set(h.domainId, (members.get(h.domainId) ?? 0) + h.expectedMembers);
    }
  }
  return { feeCents, members };
}
