// Ordering for an attendance roster, shared by the two surfaces that show one:
// the lab-wide Attendance page (/attendance) and the per-meeting checklist
// (AttendanceChecklist, on /calendar/meeting/:id and a meeting note). Both
// offer the same name sorts so a roster reads the same way wherever it's
// opened; the status/marked orders are offered only where they mean something
// (the checklist mixes present and absent people in one list, while the
// Attendance page has already split them into two columns).

export type AttendeeSort = "name-asc" | "name-desc" | "status" | "marked-desc";

export const ATTENDEE_SORT_LABELS: Record<AttendeeSort, string> = {
  "name-asc": "Name (A–Z)",
  "name-desc": "Name (Z–A)",
  status: "Checked in first",
  "marked-desc": "Recently marked",
};

export function attendeeSortOptions(keys: readonly AttendeeSort[]) {
  return keys.map((value) => ({ value, label: ATTENDEE_SORT_LABELS[value] }));
}

export type SortableAttendee = {
  name: string;
  present: boolean;
  /** ISO timestamp of when attendance was marked; absent on rosters that don't carry it. */
  markedAt?: string | null;
};

// Names are compared case- and accent-insensitively so "de Sousa" and
// "Delgado" don't land wherever raw code points put them.
function byName(a: SortableAttendee, b: SortableAttendee) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function markedMs(a: SortableAttendee) {
  const parsed = a.markedAt ? Date.parse(a.markedAt) : NaN;
  // Never-marked rows sort last under "Recently marked" rather than first.
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/** Returns a new array — the caller's roster (often loader data) is left alone. */
export function sortAttendees<T extends SortableAttendee>(
  rows: readonly T[],
  sort: AttendeeSort,
): T[] {
  const sorted = [...rows];
  switch (sort) {
    case "name-desc":
      return sorted.sort((a, b) => byName(b, a));
    case "status":
      return sorted.sort((a, b) => Number(b.present) - Number(a.present) || byName(a, b));
    case "marked-desc":
      return sorted.sort((a, b) => markedMs(b) - markedMs(a) || byName(a, b));
    default:
      return sorted.sort(byName);
  }
}
