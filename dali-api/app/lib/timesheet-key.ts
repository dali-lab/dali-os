import { createHash } from "node:crypto";

// Deterministic key identifying a Google Calendar event for timesheet-import
// dedup. The BusyEvent shape has no stable Google event id, so we hash the
// fields we do have. Same event → same key, so re-importing a week is a no-op
// (enforced by TimesheetSection's (userId, sourceEventKey) unique). Editing an
// event's time/title yields a new key (it re-imports as a fresh section) — an
// accepted limitation shared with the JobX extension.
export function timesheetEventKey(opts: {
  title?: string | null;
  startIso: string;
  endIso: string;
}): string {
  const raw = `${opts.startIso}|${opts.endIso}|${opts.title ?? ""}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}
