// Client-safe types + pure helpers for milestone sets. The DB/seed logic lives
// in milestones.server.ts (which pulls in node-only deps); keep this module
// import-safe for the editor bundle. See specs/milestones.md.

// One milestone in a set: a week-indexed goal. `labWide` entries (from the one
// Lab set) overlay every project timeline; the rest are team milestones.
export type MilestoneEntry = {
  id: string;
  weekIndex: number;
  name: string;
  detail: string;
  labWide: boolean;
};

// DALI's standard term length; the editor always shows at least this many week
// rows so an empty set still has somewhere to add milestones.
export const DEFAULT_WEEK_COUNT = 10;

/** How many week rows to render for a set — never fewer than the standard term,
 *  but grown to fit any entry that lives past week 9. */
export function weekCountFor(entries: MilestoneEntry[]): number {
  const maxIndex = entries.reduce((m, e) => Math.max(m, e.weekIndex), -1);
  return Math.max(DEFAULT_WEEK_COUNT, maxIndex + 1);
}

/** Entries that belong to a given week, in stored order. */
export function entriesForWeek(entries: MilestoneEntry[], weekIndex: number): MilestoneEntry[] {
  return entries.filter((e) => e.weekIndex === weekIndex);
}

// A milestone resolved to a calendar date, ready to place on a project timeline.
export type TimelineMilestoneMarker = {
  id: string;
  name: string;
  detail: string;
  labWide: boolean;
  /** UTC-midnight ISO of the week the milestone falls on (termStart + week·7d). */
  dateIso: string;
};

const DAY_MS = 86_400_000;

/**
 * Map a set's entries onto calendar dates for a given term start: entry at
 * weekIndex N lands on termStart + N·7 days, which is exactly where the epics
 * timeline's weekly sprint band for that week sits.
 */
export function entriesToMarkers(
  entries: MilestoneEntry[],
  termStartIso: string,
  opts?: { labWideOnly?: boolean; keyPrefix?: string },
): TimelineMilestoneMarker[] {
  const startMs = Date.parse(termStartIso);
  if (!Number.isFinite(startMs)) return [];
  return entries
    .filter((e) => !opts?.labWideOnly || e.labWide)
    .map((e) => ({
      id: `${opts?.keyPrefix ?? ""}${e.id}`,
      name: e.name,
      detail: e.detail,
      labWide: e.labWide,
      dateIso: new Date(startMs + e.weekIndex * 7 * DAY_MS).toISOString(),
    }));
}

/** Validate/normalize an untrusted entries payload (posted JSON or a stored
 *  version's `entries`). Drops anything without a usable week index; synthesizes
 *  a stable id for entries missing one. */
export function coerceEntries(value: unknown): MilestoneEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw, i) => {
    if (!raw || typeof raw !== "object") return [];
    const r = raw as Record<string, unknown>;
    const weekIndex =
      typeof r.weekIndex === "number" ? r.weekIndex : Number(r.weekIndex);
    if (!Number.isFinite(weekIndex) || weekIndex < 0) return [];
    return [
      {
        id: typeof r.id === "string" && r.id ? r.id : `m-${Math.floor(weekIndex)}-${i}`,
        weekIndex: Math.floor(weekIndex),
        name: typeof r.name === "string" ? r.name : "",
        detail: typeof r.detail === "string" ? r.detail : "",
        labWide: r.labWide === true,
      },
    ];
  });
}
