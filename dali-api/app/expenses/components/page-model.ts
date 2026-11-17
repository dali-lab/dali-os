import type { ExpenseRow } from "./types";

export const TAB_LABELS = { yours: "Your expenses", approvals: "Approvals", all: "All expenses", cards: "Cards" } as const;

export function tabHref(tab: keyof typeof TAB_LABELS): string {
  return tab === "yours" ? "/expenses" : `/expenses?tab=${tab}`;
}

export type PaidFilter = "all" | "STAFF_CARD" | "OWN_CARD";

export function filterRows(rows: ExpenseRow[], filter: PaidFilter): ExpenseRow[] {
  return filter === "all" ? rows : rows.filter((r) => r.paidWith === filter);
}

export function expenseStats(rows: ExpenseRow[]): { waiting: number; owedCents: number } {
  return {
    waiting: rows.filter((r) => r.status === "SUBMITTED").length,
    owedCents: rows
      .filter((r) => r.status === "APPROVED" && r.paidWith === "OWN_CARD")
      .reduce((sum, r) => sum + (r.totalCents ?? 0), 0),
  };
}

