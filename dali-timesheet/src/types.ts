// ── Data pulled from DALI OS (/api/timesheets/export) ───────────────────────

/** A paid role/job the caller can attribute hours to (JobX fills one at a time). */
export interface Hire {
  key: string;
  label: string;
}

/** One logged block of work. Times are ISO instants; `description` is the note
 *  text the export sends (DALI's export maps TimeEntry.note → description). */
export interface LoggedEntry {
  startAt: string;
  endAt: string;
  description: string;
  projectLabel: string;
}

/** The export payload for a single hire + date window. */
export interface TimesheetExport {
  hireKey: string;
  hireLabel: string;
  from: string;
  to: string;
  availableHires: Hire[];
  entries: LoggedEntry[];
}

// ── Result of writing into the JobX form ────────────────────────────────────

export interface FillOutcome {
  /** Date label the row targeted, for the results list. */
  date: string;
  status: "filled" | "skipped" | "error";
  detail?: string;
}
