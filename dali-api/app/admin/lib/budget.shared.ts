// Client-safe budget surface: the project-type constant + serialized row/group
// shapes. Kept free of any server-only import so the Budget tab component can
// pull the type list without dragging Prisma / the reconcile server module into
// the client bundle. budget.ts (server) re-exports these for its callers.

// DALI PATEO funds are discounted for Dartmouth's indirect-cost recovery.
// Effective rate = 1.47625 / 1.635 ≈ 0.9029, derived from an F&A rate of 63.5%
// with 75% recovery. Applied ONLY to revenue on rows whose projectType is
// "DALI PATEO"; every other type carries revenue through unchanged.
export const PATEO_EFFECTIVE_RATE = 1.47625 / 1.635;

/** The four project-type values the UI offers (empty = unset). */
export const PROJECT_TYPES = [
  "DALI GL",
  "Transfer GL",
  "DALI PATEO",
  "Other PATEO",
] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export type BudgetRow = {
  /** BudgetEntry id, or null when this row exists only because of expense. */
  entryId: string | null;
  /** BudgetNote id, or null when no note is attached. */
  noteId: string | null;
  projectId: string | null;
  chartString: string;
  projectType: string | null;
  revenue: number;
  adjustedRevenue: number;
  expense: number;
  net: number;
  note: string | null;
  /** True when projectType is "DALI PATEO" (revenue was scaled). */
  isPateo: boolean;
};

export type BudgetGroup = {
  /** Project id, or null for the non-project (Core/Instructor/External/unmatched) bucket. */
  projectId: string | null;
  /** Display name for the group. */
  projectName: string;
  rows: BudgetRow[];
  totalRevenue: number;
  totalAdjustedRevenue: number;
  totalExpense: number;
  totalNet: number;
};

export type BudgetData = {
  groups: BudgetGroup[];
  grandTotalRevenue: number;
  grandTotalAdjustedRevenue: number;
  grandTotalExpense: number;
  grandTotalNet: number;
};
