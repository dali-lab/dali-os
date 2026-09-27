// Shared RRULE occurrence expansion for ScheduledMeeting, exception-aware.
// Used by the MCP list_my_upcoming_meetings tool, the meeting-reminders job,
// and resolveOccurrence (the per-occurrence key for attendance, hours and
// notes). Occurrences carry their ORIGINAL start (the MeetingException key and
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

// How far either side of `at` resolveOccurrence looks for the occurrence it
// means. Wider than any sane recurrence gap, so a monthly meeting still finds
// its neighbour.
const RESOLVE_BAND_MS = 40 * 24 * 60 * 60_000;
// A meeting with no usable RRULE has one occurrence, and anything this close to
// it is that occurrence.
const SINGLE_MATCH_MS = 12 * 60 * 60_000;

export type OccurrenceMeeting = {
  selectedAt: Date | null;
  createdAt: Date;
  durationMinutes: number;
  recurrenceRule: string | null;
  /** A tracked Google series can arrive with no RRULE; its Google id is what
   *  says it may still have more than one occurrence. */
  externalEventId?: string | null;
};

/**
 * The occurrence of a meeting that `at` refers to — the key attendance, meeting
 * hours and meeting notes are stored under (its ORIGINAL start) plus its
 * effective start/end after any exception.
 *
 * `at` is whatever the caller has in hand: a calendar instance's start or
 * original start, or "now" for check-in. It snaps to the occurrence whose
 * original or effective start is nearest, so an instance Google reports an
 * hour off across a DST change still lands on the same key. No `at` means the
 * first occurrence, which is also the only key a one-off meeting has.
 *
 * A Google-backed meeting whose RRULE DALI can't expand (a series tracked
 * from one instance comes in without one) keys each distinct `at` on its own,
 * so its occurrences still stay apart.
 */
export function resolveOccurrence(
  meeting: OccurrenceMeeting,
  exceptions: OccurrenceException[],
  at?: Date | null,
): Occurrence {
  const base = meeting.selectedAt ?? meeting.createdAt;
  const single = (start: Date): Occurrence => ({
    originalStart: start,
    start,
    end: new Date(start.getTime() + meeting.durationMinutes * 60_000),
  });
  if (!at || !meeting.selectedAt) return single(base);

  const rule = meeting.recurrenceRule ? buildRule(meeting.recurrenceRule, meeting.selectedAt) : null;
  if (!rule) {
    if (Math.abs(at.getTime() - base.getTime()) <= SINGLE_MATCH_MS) return single(base);
    if (!meeting.recurrenceRule && !meeting.externalEventId) return single(base);
    const minute = new Date(Math.floor(at.getTime() / 60_000) * 60_000);
    return single(minute);
  }

  const occurrences = expandOccurrences(
    meeting,
    exceptions,
    new Date(at.getTime() - RESOLVE_BAND_MS),
    new Date(at.getTime() + RESOLVE_BAND_MS),
  );
  let best: Occurrence | null = null;
  let bestGap = Infinity;
  for (const occ of occurrences) {
    const gap = Math.min(
      Math.abs(occ.originalStart.getTime() - at.getTime()),
      Math.abs(occ.start.getTime() - at.getTime()),
    );
    if (gap < bestGap) {
      best = occ;
      bestGap = gap;
    }
  }
  return best ?? single(base);
}

/**
 * The original start of one instance of a recurring Google event, read from its
 * instance id (`<masterId>_<YYYYMMDDTHHMMSSZ>`, or `_<YYYYMMDD>` all-day). Null
 * for anything else — a one-off event, or an id Google didn't mint that way.
 */
export function googleInstanceOriginalStart(eventId: string, recurringEventId?: string | null): Date | null {
  if (!recurringEventId || !eventId.startsWith(`${recurringEventId}_`)) return null;
  const m = eventId.slice(recurringEventId.length + 1).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The note among a meeting's notePages that belongs to one occurrence. */
export function noteForOccurrence<T extends { meetingOccurrenceStart: Date | null }>(
  notes: T[],
  occurrenceStart: Date,
): T | null {
  return notes.find((n) => n.meetingOccurrenceStart?.getTime() === occurrenceStart.getTime()) ?? null;
}

/** RRULE UTC "UNTIL" in basic format (YYYYMMDDTHHMMSSZ). */
export function rruleUntilBasic(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/**
 * Take a recurring event's recurrence rule (as a string or string[]) and
 * return one bare RRULE string with UNTIL set (existing UNTIL/COUNT stripped).
 * Used for splitting/truncating a series. Returns null when no FREQ rule found.
 */
export function rruleWithUntil(recurrence: string | string[], until: Date): string | null {
  const arr = typeof recurrence === "string" ? [recurrence] : recurrence;
  const rule = arr.map((r) => r.replace(/^RRULE:/i, "")).find((r) => /FREQ=/i.test(r));
  if (!rule) return null;
  const parts = rule.split(";").filter((p) => !/^(UNTIL|COUNT)=/i.test(p));
  parts.push(`UNTIL=${rruleUntilBasic(until)}`);
  return parts.join(";");
}

/**
 * Strip UNTIL from a recurrence rule, returning the bare repeating rule.
 * Used when spinning up a new series from a "following" split — the new
 * series has no end date unless the user sets one.
 */
export function bareRrule(recurrence: string | string[]): string | null {
  const arr = typeof recurrence === "string" ? [recurrence] : recurrence;
  const rule = arr.map((r) => r.replace(/^RRULE:/i, "")).find((r) => /FREQ=/i.test(r));
  return rule ? rule.split(";").filter((p) => !/^UNTIL=/i.test(p)).join(";") : null;
}
