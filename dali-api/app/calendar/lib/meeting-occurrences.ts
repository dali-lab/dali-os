// Shared RRULE occurrence expansion for ScheduledMeeting, exception-aware.
// Used by the MCP list_my_upcoming_meetings tool, the meeting-reminders job,
// and resolveOccurrence (the per-occurrence key for attendance, hours and
// notes). Occurrences carry their ORIGINAL start (the MeetingException key and
// the reminder-log idempotency key) alongside the effective start/end after
// any override.

import rrulePkg from "rrule";
import { APPLICATION_TZ, fromWallClock, toWallClock } from "~/lib/timezone";
import type { MeetingType } from "~/generated/prisma/client";

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

export type MeetingRule = {
  between(after: Date, before: Date, inc?: boolean): Date[];
  all(iterator?: (d: Date, i: number) => boolean): Date[];
  options: { count: number | null; until: Date | null };
};

// Floating time: the lab wall clock written into a UTC Date, which is the frame
// rrule expands in. BYDAY and the time of day are Eastern (RepeatField and
// Google both mean them that way), so expanding the real UTC instant puts an
// evening series on the wrong day and keeps its UTC hour across DST.
const toFloating = (d: Date) => toWallClock(d, APPLICATION_TZ);
const fromFloating = (f: Date) => fromWallClock(f, APPLICATION_TZ);

// Wider than any zone offset, so a floating window covers the real one.
const FLOATING_PAD_MS = 24 * 60 * 60_000;

export function buildRule(rule: string, dtstart: Date): MeetingRule | null {
  try {
    const trimmed = rule.trim();
    const rrulePart = trimmed.toUpperCase().startsWith("RRULE:") ? trimmed : `RRULE:${trimmed}`;
    const parsed = rrulestr(rrulePart);
    if (!(parsed instanceof RRule)) return null;
    const until = parsed.options.until;
    const floating = new RRule({
      ...parsed.origOptions,
      dtstart: toFloating(new Date(Math.floor(dtstart.getTime() / 1000) * 1000)),
      until: until ? toFloating(until) : null,
    });
    return {
      between(after, before, inc = false) {
        return floating
          .between(new Date(after.getTime() - FLOATING_PAD_MS), new Date(before.getTime() + FLOATING_PAD_MS), true)
          .map(fromFloating)
          .filter((d) => (inc ? d >= after && d <= before : d > after && d < before));
      },
      all(iterator) {
        return floating.all(iterator && ((d, i) => iterator(fromFloating(d), i))).map(fromFloating);
      },
      options: { count: parsed.options.count, until },
    };
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

const SERIES_SPLIT_SUFFIX = /_R\d{8}(?:T\d{6}Z?)?$/;

/** Google's "this and following" split ids append `_R<stamp>` to the original series id. */
export function googleSeriesBase(id: string): string {
  return id.replace(SERIES_SPLIT_SUFFIX, "");
}

export function googleSeriesBaseUID(uid: string): string {
  const at = uid.indexOf("@");
  if (at < 0) return googleSeriesBase(uid);
  return googleSeriesBase(uid.slice(0, at)) + uid.slice(at);
}

/**
 * Resolve which DALI meeting a fetched Google event belongs to.
 *
 * `iCalUID` (the RFC5545 UID) is the primary key: Google shares it across every
 * attendee's copy of an event AND across every instance of a recurring series,
 * so it holds even when Google hands one copy a *detached* instance — the
 * instance id but no `recurringEventId` — which is exactly the case that makes a
 * meeting silently fall back to a plain Google event on the calendar.
 *
 * `externalEventId` (the mutable Google event id / recurring-master id) stays as
 * the fallback for meeting rows whose `iCalUID` hasn't been backfilled yet.
 */
export function matchMeetingForEvent<M>(
  event: { eventId?: string | null; recurringEventId?: string | null; iCalUID?: string | null },
  byICalUID: Map<string, M>,
  byExternalId: Map<string, M>,
): M | null {
  if (event.iCalUID) {
    const byUid = byICalUID.get(event.iCalUID);
    if (byUid) return byUid;
  }
  if (event.eventId) {
    const byId = byExternalId.get(event.eventId);
    if (byId) return byId;
  }
  if (event.recurringEventId) {
    const byMaster = byExternalId.get(event.recurringEventId);
    if (byMaster) return byMaster;
  }
  if (event.iCalUID) {
    const byBaseUid = byICalUID.get(googleSeriesBaseUID(event.iCalUID));
    if (byBaseUid) return byBaseUid;
  }
  const seriesId = event.recurringEventId ?? event.eventId;
  if (seriesId) {
    const byBase = byExternalId.get(googleSeriesBase(seriesId));
    if (byBase) return byBase;
  }
  return null;
}

/** The note among a meeting's notePages that belongs to one occurrence. */
export function noteForOccurrence<T extends { meetingOccurrenceStart: Date | null }>(
  notes: T[],
  occurrenceStart: Date,
): T | null {
  return notes.find((n) => n.meetingOccurrenceStart?.getTime() === occurrenceStart.getTime()) ?? null;
}

/** The first occurrence still ahead (or under way) that has no note yet; null
 *  when every upcoming one has its note. `occurrences` is in time order. */
export function nextOpenOccurrence(
  occurrences: Occurrence[],
  notes: { meetingOccurrenceStart: Date | null }[],
  now: Date,
): Occurrence | null {
  return occurrences.find((o) => o.end >= now && noteForOccurrence(notes, o.originalStart) === null) ?? null;
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

export function followingRule(recurrence: string | string[], seriesStart: Date, splitAt: Date): string | null {
  const arr = typeof recurrence === "string" ? [recurrence] : recurrence;
  const rule = arr.map((r) => r.replace(/^RRULE:/i, "")).find((r) => /FREQ=/i.test(r));
  if (!rule) return null;
  const parts = rule.split(";");
  const base = parts.filter((p) => !/^(UNTIL|COUNT)=/i.test(p));
  const until = parts.find((p) => /^UNTIL=/i.test(p));
  if (until) return [...base, until].join(";");
  const count = parts.find((p) => /^COUNT=/i.test(p));
  if (!count) return base.join(";");
  const built = buildRule(rule, seriesStart);
  if (!built) return base.join(";");
  const before = built.all().filter((d) => d < splitAt).length;
  const remaining = Number(count.split("=")[1]) - before;
  return [...base, `COUNT=${Math.max(remaining, 1)}`].join(";");
}


/**
 * Whether a meeting keeps an attendance roster: it has a type, a notebook, a
 * self check-in, or invited people. Shared by the roster reconcile on edit and
 * the manual attendance route and MCP tool.
 */
export function tracksAttendance(meeting: {
  meetingType: MeetingType | null;
  notebookId: string | null;
  attendanceMode: string | null;
  participantUserIds: string[];
}): boolean {
  return (
    meeting.meetingType != null ||
    meeting.notebookId != null ||
    meeting.attendanceMode === "SelfCheckIn" ||
    meeting.participantUserIds.length > 0
  );
}

// Grace on either side of a meeting during which self-check-in / wallet-pass
// scan is accepted: from CHECK_IN_GRACE_MIN before the scheduled start to
// CHECK_IN_GRACE_MIN after the scheduled end.
export const CHECK_IN_GRACE_MIN = 15;

// How far either side of `now` to look for an occurrence. An exception can move
// an occurrence off its original slot, and expandOccurrences filters by ORIGINAL
// start, so the scan band has to be wider than the window being tested — a week
// covers "we moved this Tuesday's meeting to Thursday" without expanding a
// pointless number of occurrences.
const OCCURRENCE_SCAN_BAND_MS = 7 * 24 * 60 * 60_000;

/**
 * Whether `now` falls within the check-in window of ANY occurrence of a meeting.
 * Shared by the self-check-in route (api.scheduled-meetings.$id.check-in.ts),
 * the wallet-pass scan route (api.scheduled-meetings.$id.scan-attendee.ts) and
 * the equivalent MCP tools so the window math has one definition.
 *
 * Recurrence is the whole reason this takes a meeting rather than a bare date.
 * `selectedAt` is the FIRST occurrence and never advances, so testing it
 * directly meant a weekly meeting only accepted check-ins during its very first
 * sitting — every occurrence after that reported "window closed" while the
 * meeting was in progress. Exceptions matter for the same reason: a rescheduled
 * occurrence has to be judged at its new time, not its original slot.
 *
 * A meeting with no scheduled time yet has no window (nothing to be early or
 * late for), so this returns false — callers that want to distinguish "no time
 * set" from "window closed" check selectedAt first.
 */
export function isWithinCheckInWindow(
  meeting: {
    selectedAt: Date | null;
    durationMinutes: number;
    recurrenceRule?: string | null;
  },
  exceptions: OccurrenceException[] = [],
  now: number = Date.now(),
): boolean {
  if (!meeting.selectedAt) return false;
  const graceMs = CHECK_IN_GRACE_MIN * 60_000;
  const occurrences = expandOccurrences(
    {
      selectedAt: meeting.selectedAt,
      durationMinutes: meeting.durationMinutes,
      recurrenceRule: meeting.recurrenceRule ?? null,
    },
    exceptions,
    new Date(now - OCCURRENCE_SCAN_BAND_MS),
    new Date(now + OCCURRENCE_SCAN_BAND_MS),
  );
  return occurrences.some(
    (occ) => now >= occ.start.getTime() - graceMs && now <= occ.end.getTime() + graceMs,
  );
}

/** An `occurrence` query/body param (ISO instant) → Date; anything else → null,
 *  which resolves to the first occurrence. */
export function parseOccurrenceParam(raw: unknown): Date | null {
  if (typeof raw !== "string" || !raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** DALI only writes to a Google event it created. Null origin is a legacy row, treated as created. */
export function ownsGoogleEvent(meeting: {
  googleEventOrigin?: "Created" | "Tracked" | null;
  externalEventId: string | null;
}): boolean {
  if (meeting.googleEventOrigin === "Tracked") return false;
  return !(meeting.externalEventId && googleSeriesBase(meeting.externalEventId) !== meeting.externalEventId);
}

/** Whether a meeting still has an occurrence ahead of `now`. A series is treated
 *  as ongoing; an unscheduled (Searching) meeting hasn't happened yet. */
export function meetingIsUpcoming(
  meeting: { selectedAt: Date | null; durationMinutes: number; recurrenceRule: string | null },
  now: Date,
): boolean {
  if (meeting.recurrenceRule || !meeting.selectedAt) return true;
  return meeting.selectedAt.getTime() + meeting.durationMinutes * 60_000 > now.getTime();
}
