// Client-safe timesheet-hire types + constants. This file MUST NOT import prisma
// (or anything that pulls in ~/lib/db), because it's imported by the calendar
// route's client component. The server-only `deriveHires` lives in
// timesheet-hires.ts and re-exports these.

export type HireType = "Core" | "Project" | "Instructor" | "DomainLead" | "Admin";

export type Hire = {
  key: string;
  label: string;
  type: HireType;
  color: string;
};

// Fixed palette; deriveHires assigns colors by a stable sort of hire keys so a
// given hire keeps its color across loads.
export const HIRE_PALETTE = [
  "#2563eb", // blue
  "#16a34a", // green
  "#db2777", // pink
  "#d97706", // amber
  "#7c3aed", // violet
  "#0891b2", // cyan
  "#dc2626", // red
  "#4d7c0f", // olive
];

// The gray used for unassigned (imported, not-yet-tagged) sections.
export const UNASSIGNED_COLOR = "#9ca3af";

/** The member's primary hire (drag-create default), or null if they have none. */
export function primaryHire(hires: Hire[]): Hire | null {
  return hires[0] ?? null;
}

/** Look up a hire's color by key; falls back to the unassigned gray. */
export function colorForHire(hires: Hire[], hireKey: string | null): string {
  if (!hireKey) return UNASSIGNED_COLOR;
  return hires.find((h) => h.key === hireKey)?.color ?? UNASSIGNED_COLOR;
}
