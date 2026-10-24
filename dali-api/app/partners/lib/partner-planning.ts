// Shared vocabulary for the Partner Relations term planner — mirrors the
// convention in partner-application.ts (one source of truth for the union,
// labels, pill palette, and ordering).

export const PARTNER_PLANNING_STATUSES = [
  "Continuing",
  "Later",
  "Maybe",
  "New",
] as const;

export type PartnerPlanningStatus = (typeof PARTNER_PLANNING_STATUSES)[number];

export const PARTNER_PLANNING_LABELS: Record<PartnerPlanningStatus, string> = {
  Continuing: "Continuing",
  Later: "Later",
  Maybe: "Maybe",
  New: "New",
};

// Pill tint per status — green / red / yellow / blue to match Alejandro's
// Notion template. Applied in the planner table and the status filter chips.
export const PARTNER_PLANNING_PILL: Record<PartnerPlanningStatus, string> = {
  Continuing: "bg-emerald-100 text-emerald-700",
  Later: "bg-rose-100 text-rose-700",
  Maybe: "bg-amber-100 text-amber-700",
  New: "bg-sky-100 text-sky-700",
};

// Row-level tint applied to the whole table row (lighter — the status chip
// still carries the color, this is just a subtle backdrop).
export const PARTNER_PLANNING_ROW_TINT: Record<PartnerPlanningStatus, string> = {
  Continuing: "bg-emerald-50/40",
  Later: "bg-rose-50/40",
  Maybe: "bg-amber-50/40",
  New: "bg-sky-50/40",
};

// Sort order inside the planner — continuing first (returning work the lab
// already knows), new next, maybe before later. "Later" rows render in a
// separate group at the bottom.
export const PARTNER_PLANNING_SORT: Record<PartnerPlanningStatus, number> = {
  Continuing: 0,
  New: 1,
  Maybe: 2,
  Later: 3,
};
