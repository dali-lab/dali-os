// Room schedules and bookings. A room's schedule is the union of its
// RoomBookings and the ScheduledMeetings pointed at it (roomId), expanded per
// occurrence. Bookings may also repeat (RoomBooking.recurrenceRule, same RFC
// 5545 shape as meetings, with RoomBookingException for per-occurrence
// overrides). Every write that claims room time (a booking here, a meeting via
// assertMeetingRoomFree) goes through the same conflict check, serialized per
// room with a transaction-scoped advisory lock so two simultaneous "Book now"s
// can't both win.

import { prisma } from "~/lib/db";
import {
  buildRule,
  expandOccurrences,
  rruleWithUntil,
  type Occurrence,
  type OccurrenceException,
} from "~/lib/meeting-occurrences";
import { CHECK_IN_GRACE_MIN } from "~/lib/scheduled-meeting";
import { currentTerm } from "~/lib/roles";
import { APPLICATION_TZ } from "~/lib/timezone";
import type { Prisma, RoomBookingSource } from "~/generated/prisma/client";

// Longest single booking. Longer holds are what meetings (with a recurrence
// and an organizer on the hook) are for.
export const MAX_BOOKING_MINUTES = 8 * 60;
// How far ahead a booking may start.
export const MAX_BOOKING_LEAD_DAYS = 90;
// A booking may start slightly in the past so "Book now" at 2:00:40 for a slot
// the client computed at 2:00:00 isn't rejected.
const START_SKEW_MS = 5 * 60_000;
// expandOccurrences filters by ORIGINAL start; an exception can move an
// occurrence up to this far from its slot and still be found.
const OCCURRENCE_SCAN_BAND_MS = 7 * 24 * 60 * 60_000;
// How far ahead a recurring meeting's occurrences are checked against room
// bookings when the meeting claims a room. Also the no-term fallback cap for
// a repeating booking's series.
const MEETING_CONFLICT_HORIZON_MS = 180 * 24 * 60 * 60_000;
// A repeating booking may have at most this many occurrences.
const MAX_BOOKING_OCCURRENCES = 200;

export type RoomScheduleItem = {
  kind: "booking" | "meeting";
  // RoomBooking.id or ScheduledMeeting.id.
  id: string;
  title: string;
  start: Date;
  end: Date;
  // The ORIGINAL start of this occurrence (the RoomBookingException /
  // MeetingException key); equals `start` for a single booking or an
  // un-overridden occurrence.
  occurrenceStart: Date;
  // Whether this item's booking/meeting repeats at all, not whether this one
  // occurrence was overridden.
  recurring: boolean;
  // photoUrl is the stored value (maybe an S3 key); resolve before sending.
  organizer: { id: string; firstName: string; lastName: string; photoUrl: string | null };
  // A SelfCheckIn meeting: the door display offers pass scanning while it runs.
  isEvent: boolean;
  // Null for a meeting.
  source: RoomBookingSource | null;
  // The hiring cycle behind an Interview / InterviewHold booking.
  cycleId: string | null;
};

/** Who is claiming room time, for the conflict rule in `blockedBy`. */
export type RoomWriter = { source: RoomBookingSource; applicationCycleId?: string | null };

// Hiring books rooms on the lab's behalf: no human-sized duration or lead
// caps, and the series cap is a flat horizon rather than the current term.
const SYSTEM_SOURCES: ReadonlySet<RoomBookingSource> = new Set(["Interview", "InterviewHold"]);

type Tx = Prisma.TransactionClient;

function overlaps(a: { start: Date; end: Date }, start: Date, end: Date) {
  return a.start < end && a.end > start;
}

/**
 * A schedule item blocks a writer unless one side is a hiring cycle's hold
 * and the other belongs to the same cycle: interviews sit inside their
 * cycle's hold, and a hold may be placed over interviews already booked. Two
 * interviews still collide, as does anything from another cycle.
 */
export function blockedBy(item: RoomScheduleItem, writer: RoomWriter) {
  if (!writer.applicationCycleId || item.cycleId !== writer.applicationCycleId) return true;
  return !(item.source === "InterviewHold" || writer.source === "InterviewHold");
}

const WEB_WRITER: RoomWriter = { source: "Web" };

/** Expand one booking row's occurrences that overlap [windowStart, windowEnd). */
function bookingOccurrences(
  b: { start: Date; end: Date; recurrenceRule: string | null; exceptions?: OccurrenceException[] },
  windowStart: Date,
  windowEnd: Date,
): Occurrence[] {
  const durationMinutes = (b.end.getTime() - b.start.getTime()) / 60_000;
  const occurrences = expandOccurrences(
    { selectedAt: b.start, durationMinutes, recurrenceRule: b.recurrenceRule },
    b.exceptions ?? [],
    new Date(windowStart.getTime() - OCCURRENCE_SCAN_BAND_MS),
    new Date(windowEnd.getTime() + OCCURRENCE_SCAN_BAND_MS),
  );
  return occurrences.filter((occ) => overlaps(occ, windowStart, windowEnd));
}

export async function getRoomSchedule(
  roomId: string,
  windowStart: Date,
  windowEnd: Date,
  opts: { excludeBookingId?: string; excludeMeetingId?: string } = {},
  db: Tx | typeof prisma = prisma,
): Promise<RoomScheduleItem[]> {
  const organizerSelect = { select: { id: true, firstName: true, lastName: true, photoUrl: true } } as const;
  const [bookings, meetings] = await Promise.all([
    db.roomBooking.findMany({
      where: {
        roomId,
        cancelledAt: null,
        ...(opts.excludeBookingId ? { id: { not: opts.excludeBookingId } } : {}),
        OR: [
          { recurrenceRule: null, start: { lt: windowEnd }, end: { gt: windowStart } },
          {
            recurrenceRule: { not: null },
            start: { lt: new Date(windowEnd.getTime() + OCCURRENCE_SCAN_BAND_MS) },
            seriesEnd: { gt: new Date(windowStart.getTime() - OCCURRENCE_SCAN_BAND_MS) },
          },
        ],
      },
      include: {
        user: organizerSelect,
        exceptions: {
          select: { originalStart: true, overrideStart: true, overrideDurationMin: true, cancelled: true },
        },
      },
    }),
    db.scheduledMeeting.findMany({
      where: {
        rooms: { some: { id: roomId } },
        status: "Confirmed",
        selectedAt: { not: null, lt: new Date(windowEnd.getTime() + OCCURRENCE_SCAN_BAND_MS) },
        ...(opts.excludeMeetingId ? { id: { not: opts.excludeMeetingId } } : {}),
      },
      select: {
        id: true,
        title: true,
        selectedAt: true,
        durationMinutes: true,
        recurrenceRule: true,
        attendanceMode: true,
        organizer: organizerSelect,
        exceptions: {
          select: { originalStart: true, overrideStart: true, overrideDurationMin: true, cancelled: true },
        },
      },
    }),
  ]);

  const items: RoomScheduleItem[] = [];

  for (const b of bookings) {
    for (const occ of bookingOccurrences(b, windowStart, windowEnd)) {
      items.push({
        kind: "booking",
        id: b.id,
        title: b.title?.trim() || `${b.user.firstName}'s booking`,
        start: occ.start,
        end: occ.end,
        occurrenceStart: occ.originalStart,
        recurring: !!b.recurrenceRule,
        organizer: b.user,
        isEvent: false,
        source: b.source ?? "Web",
        cycleId: b.applicationCycleId ?? null,
      });
    }
  }

  for (const m of meetings) {
    const occurrences = expandOccurrences(
      m,
      m.exceptions,
      new Date(windowStart.getTime() - OCCURRENCE_SCAN_BAND_MS),
      new Date(windowEnd.getTime() + OCCURRENCE_SCAN_BAND_MS),
    );
    for (const occ of occurrences) {
      if (!overlaps(occ, windowStart, windowEnd)) continue;
      items.push({
        kind: "meeting",
        id: m.id,
        title: m.title,
        start: occ.start,
        end: occ.end,
        occurrenceStart: occ.originalStart,
        recurring: !!m.recurrenceRule,
        organizer: m.organizer,
        isEvent: m.attendanceMode === "SelfCheckIn",
        source: null,
        cycleId: null,
      });
    }
  }

  return items.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** The event (SelfCheckIn meeting) in its check-in window right now, if any. */
export function currentEvent(items: RoomScheduleItem[], now: number = Date.now()) {
  const graceMs = CHECK_IN_GRACE_MIN * 60_000;
  return (
    items.find(
      (i) => i.isEvent && now >= i.start.getTime() - graceMs && now <= i.end.getTime() + graceMs,
    ) ?? null
  );
}

function lockRoom(tx: Tx, roomId: string) {
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"room:" + roomId}))`;
}

export type RoomWriteResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status: number };

function labDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: APPLICATION_TZ });
}

// A series check names the day that collides; a single slot has only one.
function conflictError(c: RoomScheduleItem, roomName = "The room", series = false) {
  const when = series ? `on ${labDate(c.start)}` : "then";
  return { ok: false as const, error: `${roomName} is already booked ${when} ("${c.title}")`, status: 409 };
}

function softCancel(bookingId: string, actorUserId: string, db: Tx | typeof prisma) {
  return db.roomBooking.update({
    where: { id: bookingId },
    data: { cancelledAt: new Date(), cancelledByUserId: actorUserId },
  });
}

/** When a series' last occurrence ends. Rules here always carry UNTIL or COUNT. */
function seriesEndOf(b: { start: Date; end: Date; recurrenceRule: string }): Date | null {
  const rule = buildRule(b.recurrenceRule, b.start);
  if (!rule) return null;
  const last = rule.all((_, i) => i < MAX_BOOKING_OCCURRENCES).at(-1);
  return last ? new Date(last.getTime() + (b.end.getTime() - b.start.getTime())) : null;
}

/**
 * Validate a repeat rule and expand it into the occurrences a new or retimed
 * series would cover, capped to fit inside the current term (or, with no Term
 * rows at all, a flat 180-day cap). Shared by createRoomBooking and
 * retimeEventRoomBookings (scope "all" on a series).
 */
async function resolveBookingSeries(input: {
  start: Date;
  end: Date;
  recurrenceRule: string;
  // System holds (a hiring cycle's interview window) may straddle terms.
  capToTerm?: boolean;
}): Promise<RoomWriteResult<Occurrence[]>> {
  const rule = buildRule(input.recurrenceRule, input.start);
  if (!rule) return { ok: false, error: "That repeat rule isn't valid", status: 400 };
  if (!rule.options.count && !rule.options.until) {
    return { ok: false, error: "A repeating booking needs an end", status: 400 };
  }

  const term = input.capToTerm === false ? null : await currentTerm();
  // Term.endDate is the last day of term (stored at midnight), so the series
  // may run through the end of that day.
  const limit = term
    ? new Date(term.endDate.getTime() + 24 * 60 * 60_000)
    : new Date(input.start.getTime() + MEETING_CONFLICT_HORIZON_MS);
  const limitError = term
    ? `Repeats can run through the end of ${term.code} (${labDate(term.endDate)})`
    : "Repeats can run at most 180 days";

  const durationMinutes = (input.end.getTime() - input.start.getTime()) / 60_000;
  const occurrences = expandOccurrences(
    { selectedAt: input.start, durationMinutes, recurrenceRule: input.recurrenceRule },
    [],
    input.start,
    new Date(limit.getTime() + 7 * 24 * 60 * 60_000),
  );

  if (occurrences.some((occ) => occ.end.getTime() > limit.getTime())) {
    return { ok: false, error: limitError, status: 400 };
  }
  if (occurrences.length > MAX_BOOKING_OCCURRENCES) {
    return { ok: false, error: "That's too many repeats", status: 400 };
  }
  if (occurrences.length === 0) {
    return { ok: false, error: "That repeat rule has no dates", status: 400 };
  }
  return { ok: true, value: occurrences };
}

export async function createRoomBooking(
  input: {
    roomId: string;
    userId: string;
    start: Date;
    end: Date;
    title?: string | null;
    source: RoomBookingSource;
    recurrenceRule?: string | null;
    applicationCycleId?: string | null;
  },
  // A caller already inside a transaction (interview reschedule cancels the
  // old interview and books the new slot atomically) passes it here.
  tx?: Tx,
): Promise<RoomWriteResult<{ id: string; start: Date; end: Date }>> {
  const { roomId, start, end, recurrenceRule } = input;
  const system = SYSTEM_SOURCES.has(input.source);
  const writer: RoomWriter = { source: input.source, applicationCycleId: input.applicationCycleId ?? null };
  const now = Date.now();
  const minutes = (end.getTime() - start.getTime()) / 60_000;
  // These checks apply to the first occurrence only; a series' later
  // occurrences are checked for term fit by resolveBookingSeries below.
  if (!(minutes > 0)) return { ok: false, error: "End must be after start", status: 400 };
  if (!system) {
    if (minutes > MAX_BOOKING_MINUTES) {
      return { ok: false, error: `Bookings can be at most ${MAX_BOOKING_MINUTES / 60} hours`, status: 400 };
    }
    if (start.getTime() < now - START_SKEW_MS) {
      return { ok: false, error: "Can't book a time that has already started", status: 400 };
    }
    if (start.getTime() > now + MAX_BOOKING_LEAD_DAYS * 24 * 60 * 60_000) {
      return { ok: false, error: `Bookings open ${MAX_BOOKING_LEAD_DAYS} days ahead`, status: 400 };
    }
  }

  let series: Occurrence[] | null = null;
  if (recurrenceRule) {
    const resolved = await resolveBookingSeries({ start, end, recurrenceRule, capToTerm: !system });
    if (!resolved.ok) return resolved;
    series = resolved.value;
  }

  const run = async (db: Tx): Promise<RoomWriteResult<{ id: string; start: Date; end: Date }>> => {
    const room = await db.room.findUnique({ where: { id: roomId }, select: { archivedAt: true, name: true } });
    if (!room || room.archivedAt) return { ok: false, error: "Room not found", status: 404 };

    await lockRoom(db, roomId);

    if (series) {
      const schedule = await getRoomSchedule(roomId, series[0]!.start, series[series.length - 1]!.end, {}, db);
      for (const occ of series) {
        const conflict = schedule.find((s) => overlaps(s, occ.start, occ.end) && blockedBy(s, writer));
        if (conflict) return conflictError(conflict, room.name, true);
      }
    } else {
      const conflict = (await getRoomSchedule(roomId, start, end, {}, db)).find((s) => blockedBy(s, writer));
      if (conflict) return conflictError(conflict, room.name);
    }

    const booking = await db.roomBooking.create({
      data: {
        roomId,
        userId: input.userId,
        start,
        end,
        title: input.title?.trim() || null,
        source: input.source,
        recurrenceRule: recurrenceRule ?? null,
        seriesEnd: series ? series[series.length - 1]!.end : null,
        applicationCycleId: input.applicationCycleId ?? null,
      },
      select: { id: true, start: true, end: true },
    });
    return { ok: true, value: booking };
  };

  return tx ? run(tx) : prisma.$transaction(run);
}

/**
 * Every schedule item that would block `writer` from holding `roomId` over
 * `occurrences`, each once. The cycle-setup hold toggle shows these so the
 * lead can ask people to move (or override).
 */
export async function listRoomConflicts(
  roomId: string,
  occurrences: { start: Date; end: Date }[],
  writer: RoomWriter,
): Promise<RoomScheduleItem[]> {
  if (occurrences.length === 0) return [];
  const schedule = await getRoomSchedule(
    roomId,
    occurrences[0]!.start,
    occurrences[occurrences.length - 1]!.end,
  );
  const seen = new Set<string>();
  const out: RoomScheduleItem[] = [];
  for (const s of schedule) {
    if (!blockedBy(s, writer)) continue;
    if (!occurrences.some((occ) => overlaps(s, occ.start, occ.end))) continue;
    const key = `${s.kind}:${s.id}:${s.occurrenceStart.getTime()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** Expand a repeat rule the way a system hold will be stored, without writing. */
export async function previewBookingSeries(input: { start: Date; end: Date; recurrenceRule: string }) {
  return resolveBookingSeries({ ...input, capToTerm: false });
}

/**
 * Hold every room for a plain calendar event (one with no ScheduledMeeting to
 * claim them): all of the rooms or none. The caller releases the holds with
 * releaseRoomBookings if the event itself then fails to save.
 */
export async function bookRoomsForEvent(input: {
  roomIds: string[];
  userId: string;
  start: Date;
  end: Date;
  title: string;
  recurrenceRule?: string | null;
}): Promise<RoomWriteResult<string[]>> {
  const bookingIds: string[] = [];
  for (const roomId of input.roomIds) {
    const booked = await createRoomBooking({ ...input, roomId, source: "Web" });
    if (!booked.ok) {
      await releaseRoomBookings(bookingIds);
      return booked;
    }
    bookingIds.push(booked.value.id);
  }
  return { ok: true, value: bookingIds };
}

export async function releaseRoomBookings(bookingIds: string[]) {
  if (bookingIds.length === 0) return;
  await prisma.roomBooking.deleteMany({ where: { id: { in: bookingIds } } });
}

/**
 * Tie the holds bookRoomsForEvent made to the Google event that now exists,
 * so releaseEventRoomBookings / retimeEventRoomBookings can find them later.
 */
export async function claimEventRoomBookings(bookingIds: string[], sourceEventId: string) {
  if (bookingIds.length === 0) return;
  await prisma.roomBooking.updateMany({ where: { id: { in: bookingIds } }, data: { sourceEventId } });
}

type BookingWithExceptions = {
  id: string;
  start: Date;
  end: Date;
  recurrenceRule: string | null;
  exceptions: OccurrenceException[];
};

/** End-now-if-underway-else-soft-cancel, applied to the booking row itself. */
async function cancelBookingNow(
  booking: { id: string; start: Date; end: Date },
  actorUserId: string,
  db: Tx | typeof prisma,
): Promise<RoomWriteResult<null>> {
  const now = new Date();
  if (booking.start < now && booking.end > now) {
    await db.roomBooking.update({ where: { id: booking.id }, data: { end: now } });
  } else {
    await db.roomBooking.update({
      where: { id: booking.id },
      data: { cancelledAt: now, cancelledByUserId: actorUserId },
    });
  }
  return { ok: true, value: null };
}

function resolveBookingOccurrence(booking: BookingWithExceptions, occurrenceStart: Date): Occurrence | null {
  const durationMinutes = (booking.end.getTime() - booking.start.getTime()) / 60_000;
  const occurrences = expandOccurrences(
    { selectedAt: booking.start, durationMinutes, recurrenceRule: booking.recurrenceRule },
    booking.exceptions,
    new Date(occurrenceStart.getTime() - OCCURRENCE_SCAN_BAND_MS),
    new Date(occurrenceStart.getTime() + OCCURRENCE_SCAN_BAND_MS),
  );
  return occurrences.find((occ) => occ.originalStart.getTime() === occurrenceStart.getTime()) ?? null;
}

/**
 * Scoped cancel for one booking row — single or series. Shared by
 * cancelRoomBooking (one booking) and releaseEventRoomBookings /
 * truncateEventRoomBookings (every hold of an event, one call each).
 */
async function cancelBookingOccurrence(
  booking: BookingWithExceptions,
  actorUserId: string,
  opts: { scope?: "this" | "following" | "all"; occurrenceStart?: Date },
  db: Tx | typeof prisma,
): Promise<RoomWriteResult<null>> {
  if (!booking.recurrenceRule) return cancelBookingNow(booking, actorUserId, db);

  // A series' start/end set every occurrence's duration, so "end now" can't
  // apply to the row: the whole series is cancelled outright.
  const scope = opts.scope ?? "all";
  if (scope === "all") {
    await softCancel(booking.id, actorUserId, db);
    return { ok: true, value: null };
  }

  const occurrenceStart = opts.occurrenceStart;
  if (!occurrenceStart) return { ok: false, error: "occurrenceStart is required", status: 400 };

  if (scope === "following") {
    if (occurrenceStart.getTime() === booking.start.getTime()) {
      await softCancel(booking.id, actorUserId, db);
      return { ok: true, value: null };
    }
    const truncated = rruleWithUntil(booking.recurrenceRule, new Date(occurrenceStart.getTime() - 1000));
    if (truncated) {
      await db.roomBooking.update({
        where: { id: booking.id },
        data: {
          recurrenceRule: truncated,
          seriesEnd: seriesEndOf({ start: booking.start, end: booking.end, recurrenceRule: truncated }),
        },
      });
    }
    await db.roomBookingException.deleteMany({
      where: { roomBookingId: booking.id, originalStart: { gte: occurrenceStart } },
    });
    return { ok: true, value: null };
  }

  // scope === "this"
  const occ = resolveBookingOccurrence(booking, occurrenceStart);
  if (!occ) return { ok: false, error: "That time isn't part of this booking", status: 404 };

  const now = new Date();
  if (occ.start < now && occ.end > now) {
    const minutes = Math.max(1, Math.round((now.getTime() - occ.start.getTime()) / 60_000));
    await db.roomBookingException.upsert({
      where: { roomBookingId_originalStart: { roomBookingId: booking.id, originalStart: occ.originalStart } },
      create: {
        roomBookingId: booking.id,
        originalStart: occ.originalStart,
        overrideStart: occ.start,
        overrideDurationMin: minutes,
        cancelled: false,
      },
      update: { overrideStart: occ.start, overrideDurationMin: minutes, cancelled: false },
    });
  } else {
    await db.roomBookingException.upsert({
      where: { roomBookingId_originalStart: { roomBookingId: booking.id, originalStart: occ.originalStart } },
      create: { roomBookingId: booking.id, originalStart: occ.originalStart, cancelled: true },
      update: { cancelled: true },
    });
  }
  return { ok: true, value: null };
}

const exceptionSelect = {
  select: { originalStart: true, overrideStart: true, overrideDurationMin: true, cancelled: true },
} as const;

/**
 * Cancel a booking, or — if it's already underway — end it now so the rest of
 * the slot frees up. The caller checks who may do this. For a recurring
 * booking, `opts.scope` picks "this" occurrence, "following" ones (truncates
 * the series), or "all" (default) — the whole series, cancelled as today.
 */
export async function cancelRoomBooking(
  bookingId: string,
  actorUserId: string,
  opts?: { scope?: "this" | "following" | "all"; occurrenceStart?: Date },
  db: Tx | typeof prisma = prisma,
): Promise<RoomWriteResult<null>> {
  const booking = await db.roomBooking.findUnique({
    where: { id: bookingId },
    include: { exceptions: exceptionSelect },
  });
  if (!booking || booking.cancelledAt) return { ok: true, value: null };
  return cancelBookingOccurrence(booking, actorUserId, opts ?? {}, db);
}

/** Cancel every live booking a hiring cycle holds with `source`. */
export async function releaseCycleRoomBookings(
  applicationCycleId: string,
  source: RoomBookingSource,
  actorUserId: string,
  db: Tx | typeof prisma = prisma,
) {
  await db.roomBooking.updateMany({
    where: { applicationCycleId, source, cancelledAt: null },
    data: { cancelledAt: new Date(), cancelledByUserId: actorUserId },
  });
}

/**
 * The event is gone: cancel its holds so the rooms free up. `opts` scopes the
 * cancel the same way cancelRoomBooking does, applied to every live hold.
 */
export async function releaseEventRoomBookings(
  userId: string,
  sourceEventId: string,
  opts?: { scope?: "this" | "following" | "all"; occurrenceStart?: Date },
): Promise<RoomWriteResult<null>> {
  const holds = await prisma.roomBooking.findMany({
    where: { userId, sourceEventId, cancelledAt: null },
    include: { exceptions: exceptionSelect },
  });
  for (const hold of holds) {
    const res = await cancelBookingOccurrence(hold, userId, opts ?? {}, prisma);
    if (!res.ok) return res;
  }
  return { ok: true, value: null };
}

/**
 * Truncate every live hold of an event to end just before `before` — scope
 * "following" at that point, soft-cancelling a hold outright when `before` is
 * its first occurrence. Used by the calendar's "this and following" split,
 * which then books a fresh series under a new event id.
 */
export async function truncateEventRoomBookings(
  userId: string,
  sourceEventId: string,
  before: Date,
): Promise<RoomWriteResult<null>> {
  const holds = await prisma.roomBooking.findMany({
    where: { userId, sourceEventId, cancelledAt: null },
    include: { exceptions: exceptionSelect },
  });
  for (const hold of holds) {
    const res = await cancelBookingOccurrence(hold, userId, { scope: "following", occurrenceStart: before }, prisma);
    if (!res.ok) return res;
  }
  return { ok: true, value: null };
}

/**
 * The event moved: move its holds with it, all or none. A room that's taken
 * at the new time rejects the move (409) and leaves every hold where it was.
 * Scope "all" (default) re-anchors a series hold's whole recurrence at the new
 * start/end, checking every occurrence; scope "this" (series only) overrides
 * just one occurrence via an exception, checking only [start, end).
 */
export async function retimeEventRoomBookings(input: {
  userId: string;
  sourceEventId: string;
  start: Date;
  end: Date;
  scope?: "this" | "all";
  occurrenceStart?: Date;
}): Promise<RoomWriteResult<number>> {
  const { userId, sourceEventId, start, end, occurrenceStart } = input;
  const scope = input.scope ?? "all";
  if (!(end.getTime() > start.getTime())) return { ok: false, error: "End must be after start", status: 400 };
  if (scope === "this" && !occurrenceStart) {
    return { ok: false, error: "occurrenceStart is required", status: 400 };
  }

  return prisma.$transaction(async (tx) => {
    const holds = await tx.roomBooking.findMany({
      where: { userId, sourceEventId, cancelledAt: null },
      select: { id: true, roomId: true, recurrenceRule: true, room: { select: { name: true } } },
    });

    type Plan = { holdId: string } & ({ kind: "update"; seriesEnd?: Date } | { kind: "exception"; occ: Occurrence });
    const plans: Plan[] = [];

    for (const hold of holds) {
      await lockRoom(tx, hold.roomId);
      const isSeries = !!hold.recurrenceRule;

      if (isSeries && scope === "this") {
        const conflict = (await getRoomSchedule(hold.roomId, start, end, { excludeBookingId: hold.id }, tx)).find((s) => blockedBy(s, WEB_WRITER));
        if (conflict) return conflictError(conflict, hold.room.name);
        plans.push({ holdId: hold.id, kind: "exception", occ: { originalStart: occurrenceStart!, start, end } });
        continue;
      }

      if (isSeries) {
        // scope "all": re-anchor the whole series at the new start/end.
        const resolved = await resolveBookingSeries({ start, end, recurrenceRule: hold.recurrenceRule! });
        if (!resolved.ok) return resolved;
        const schedule = await getRoomSchedule(
          hold.roomId,
          resolved.value[0]!.start,
          resolved.value[resolved.value.length - 1]!.end,
          { excludeBookingId: hold.id },
          tx,
        );
        for (const occ of resolved.value) {
          const conflict = schedule.find((s) => overlaps(s, occ.start, occ.end) && blockedBy(s, WEB_WRITER));
          if (conflict) return conflictError(conflict, hold.room.name, true);
        }
        plans.push({ holdId: hold.id, kind: "update", seriesEnd: resolved.value[resolved.value.length - 1]!.end });
        continue;
      }

      // A plain (non-repeating) hold, either scope.
      const conflict = (await getRoomSchedule(hold.roomId, start, end, { excludeBookingId: hold.id }, tx)).find((s) => blockedBy(s, WEB_WRITER));
      if (conflict) return conflictError(conflict, hold.room.name);
      plans.push({ holdId: hold.id, kind: "update" });
    }

    for (const plan of plans) {
      if (plan.kind === "update") {
        await tx.roomBooking.update({
          where: { id: plan.holdId },
          data: { start, end, ...(plan.seriesEnd ? { seriesEnd: plan.seriesEnd } : {}) },
        });
      } else {
        const minutes = (plan.occ.end.getTime() - plan.occ.start.getTime()) / 60_000;
        await tx.roomBookingException.upsert({
          where: {
            roomBookingId_originalStart: { roomBookingId: plan.holdId, originalStart: plan.occ.originalStart },
          },
          create: {
            roomBookingId: plan.holdId,
            originalStart: plan.occ.originalStart,
            overrideStart: plan.occ.start,
            overrideDurationMin: minutes,
            cancelled: false,
          },
          update: { overrideStart: plan.occ.start, overrideDurationMin: minutes, cancelled: false },
        });
      }
    }
    return { ok: true, value: holds.length };
  });
}

/**
 * Reject a meeting's room claims if any of its occurrences (the next
 * MEETING_CONFLICT_HORIZON for a series) collides with any of the rooms'
 * schedules. Called by the meeting create/update routes before they write the
 * rooms. `newRoomIds` are the rooms this write adds: only those must exist and
 * be unarchived, so a room archived after it was picked doesn't block
 * unrelated edits (defaults to all of `roomIds`).
 */
export async function assertMeetingRoomsFree(input: {
  roomIds: string[];
  newRoomIds?: string[];
  meetingId?: string;
  selectedAt: Date;
  durationMinutes: number;
  recurrenceRule: string | null;
}): Promise<RoomWriteResult<null>> {
  const adding = new Set(input.newRoomIds ?? input.roomIds);
  const rooms = await prisma.room.findMany({
    where: { id: { in: input.roomIds } },
    select: { id: true, name: true, archivedAt: true },
  });
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const active = [];
  for (const id of input.roomIds) {
    const room = byId.get(id);
    if (room && !room.archivedAt) active.push(room);
    else if (adding.has(id)) return { ok: false, error: "Room not found", status: 404 };
  }

  const horizonStart = new Date(Math.max(input.selectedAt.getTime(), Date.now()) - 60 * 60_000);
  const horizonEnd = input.recurrenceRule
    ? new Date(horizonStart.getTime() + MEETING_CONFLICT_HORIZON_MS)
    : new Date(input.selectedAt.getTime() + input.durationMinutes * 60_000);
  const occurrences = expandOccurrences(input, [], horizonStart, horizonEnd);
  if (occurrences.length === 0) return { ok: true, value: null };

  for (const room of active) {
    const schedule = await getRoomSchedule(
      room.id,
      occurrences[0].start,
      occurrences[occurrences.length - 1].end,
      { excludeMeetingId: input.meetingId },
    );
    for (const occ of occurrences) {
      const conflict = schedule.find((s) => overlaps(s, occ.start, occ.end) && blockedBy(s, WEB_WRITER));
      if (conflict) return conflictError(conflict, room.name, !!input.recurrenceRule);
    }
  }
  return { ok: true, value: null };
}

export function serializeScheduleItem(i: RoomScheduleItem) {
  return {
    kind: i.kind,
    id: i.id,
    title: i.title,
    start: i.start.toISOString(),
    end: i.end.toISOString(),
    occurrenceStart: i.occurrenceStart.toISOString(),
    recurring: i.recurring,
    organizer: { id: i.organizer.id, firstName: i.organizer.firstName, lastName: i.organizer.lastName },
    isEvent: i.isEvent,
    source: i.source,
  };
}

/** Parse ?start&end ISO instants (the client's local day), capped at 8 days. */
export function parseWindow(url: URL): { start: Date; end: Date } | null {
  const start = new Date(url.searchParams.get("start") ?? "");
  const end = new Date(url.searchParams.get("end") ?? "");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
  if (end.getTime() - start.getTime() > 8 * 24 * 60 * 60_000) return null;
  return { start, end };
}
