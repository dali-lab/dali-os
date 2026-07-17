// Shared RRULE occurrence expansion for ScheduledMeeting, exception-aware.
// Used by the MCP list_my_upcoming_meetings tool and the meeting-reminders
// job. Occurrences carry their ORIGINAL start (the MeetingException key and
// the reminder-log idempotency key) alongside the effective start/end after
// any override.

import rrulePkg from "rrule";
import type { RRule as RRuleType } from "rrule";

const { RRule, rrulestr } = rrulePkg as unknown as {
  RRule: typeof import("rrule").RRule;
  rrulestr: typeof import("rrule").rrulestr;
};

export type OccurrenceException = {
  originalStart: Date;
  overrideStart: Date | null;
  overrideDurationMin: number | null;
  cancelled: boolean;
};

export type Occurrence = {
  // The pre-override start — stable key even when an exception moves it.
  originalStart: Date;
  start: Date;
  end: Date;
};

export function buildRule(rule: string, dtstart: Date): RRuleType | null {
  try {
    const trimmed = rule.trim();
    const rrulePart = trimmed.toUpperCase().startsWith("RRULE:") ? trimmed : `RRULE:${trimmed}`;
    const pad = (n: number) => String(n).padStart(2, "0");
    const dt =
      `${dtstart.getUTCFullYear()}${pad(dtstart.getUTCMonth() + 1)}${pad(dtstart.getUTCDate())}` +
      `T${pad(dtstart.getUTCHours())}${pad(dtstart.getUTCMinutes())}${pad(dtstart.getUTCSeconds())}Z`;
    const parsed = rrulestr(`DTSTART:${dt}\n${rrulePart}`);
    return parsed instanceof RRule ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Expand a meeting's occurrences whose ORIGINAL start falls in
 * [windowStart, windowEnd] (recurring; inclusive, matching rrule.between) or
 * whose span intersects the window (single). Cancelled exceptions are
 * dropped; overrides retime the occurrence. Callers filter effective
 * start/end themselves — an override can move an occurrence outside the
 * scanned window, so scan with a guard band wider than what you keep.
 */
export function expandOccurrences(
  meeting: {
    selectedAt: Date | null;
    durationMinutes: number;
    recurrenceRule: string | null;
  },
  exceptions: OccurrenceException[],
  windowStart: Date,
  windowEnd: Date,
): Occurrence[] {
  if (!meeting.selectedAt) return [];

  const exceptionsByStart = new Map<number, OccurrenceException>();
  for (const ex of exceptions) {
    exceptionsByStart.set(ex.originalStart.getTime(), ex);
  }

  const apply = (originalStart: Date): Occurrence | null => {
    const ex = exceptionsByStart.get(originalStart.getTime());
    if (ex?.cancelled) return null;
    const start = ex?.overrideStart ?? originalStart;
    const dur = ex?.overrideDurationMin ?? meeting.durationMinutes;
    return { originalStart, start, end: new Date(start.getTime() + dur * 60_000) };
  };

  if (meeting.recurrenceRule) {
    const rule = buildRule(meeting.recurrenceRule, meeting.selectedAt);
    if (!rule) return [];
    const out: Occurrence[] = [];
    for (const occStart of rule.between(windowStart, windowEnd, true)) {
      const occ = apply(occStart);
      if (occ) out.push(occ);
    }
    return out;
  }

  const baseEnd = new Date(meeting.selectedAt.getTime() + meeting.durationMinutes * 60_000);
  if (meeting.selectedAt < windowEnd && baseEnd > windowStart) {
    const occ = apply(meeting.selectedAt);
    return occ ? [occ] : [];
  }
  return [];
}
