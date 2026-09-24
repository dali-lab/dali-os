// Room schedules and bookings. A room's schedule is the union of its
// RoomBookings and the ScheduledMeetings pointed at it (roomId), expanded per
// occurrence. Every write that claims room time (a booking here, a meeting via
// assertMeetingRoomFree) goes through the same conflict check, serialized per
// room with a transaction-scoped advisory lock so two simultaneous "Book now"s
// can't both win.

import { prisma } from "~/lib/db";
import { expandOccurrences } from "~/lib/meeting-occurrences";
import { CHECK_IN_GRACE_MIN } from "~/lib/scheduled-meeting";
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
// bookings when the meeting claims a room.
const MEETING_CONFLICT_HORIZON_MS = 180 * 24 * 60 * 60_000;

export type RoomScheduleItem = {
  kind: "booking" | "meeting";
  // RoomBooking.id or ScheduledMeeting.id.
  id: string;
  title: string;
  start: Date;
  end: Date;
  organizer: { id: string; firstName: string; lastName: string };
  // A SelfCheckIn meeting: the door display offers pass scanning while it runs.
  isEvent: boolean;
};

type Tx = Prisma.TransactionClient;

function overlaps(a: { start: Date; end: Date }, start: Date, end: Date) {
  return a.start < end && a.end > start;
}

export async function getRoomSchedule(
  roomId: string,
  windowStart: Date,
  windowEnd: Date,
  opts: { excludeBookingId?: string; excludeMeetingId?: string } = {},
  db: Tx | typeof prisma = prisma,
): Promise<RoomScheduleItem[]> {
  const organizerSelect = { select: { id: true, firstName: true, lastName: true } } as const;
  const [bookings, meetings] = await Promise.all([
    db.roomBooking.findMany({
      where: {
        roomId,
        cancelledAt: null,
        start: { lt: windowEnd },
        end: { gt: windowStart },
        ...(opts.excludeBookingId ? { id: { not: opts.excludeBookingId } } : {}),
      },
      include: { user: organizerSelect },
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

  const items: RoomScheduleItem[] = bookings.map((b) => ({
    kind: "booking",
    id: b.id,
    title: b.title?.trim() || `${b.user.firstName}'s booking`,
    start: b.start,
    end: b.end,
    organizer: b.user,
    isEvent: false,
  }));

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
        organizer: m.organizer,
        isEvent: m.attendanceMode === "SelfCheckIn",
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

function conflictError(c: RoomScheduleItem, roomName = "The room") {
  return { ok: false as const, error: `${roomName} is already booked then ("${c.title}")`, status: 409 };
}

export async function createRoomBooking(input: {
  roomId: string;
  userId: string;
  start: Date;
  end: Date;
  title?: string | null;
  source: RoomBookingSource;
}): Promise<RoomWriteResult<{ id: string; start: Date; end: Date }>> {
  const { roomId, start, end } = input;
  const now = Date.now();
  const minutes = (end.getTime() - start.getTime()) / 60_000;
  if (!(minutes > 0)) return { ok: false, error: "End must be after start", status: 400 };
  if (minutes > MAX_BOOKING_MINUTES) {
    return { ok: false, error: `Bookings can be at most ${MAX_BOOKING_MINUTES / 60} hours`, status: 400 };
  }
  if (start.getTime() < now - START_SKEW_MS) {
    return { ok: false, error: "Can't book a time that has already started", status: 400 };
  }
  if (start.getTime() > now + MAX_BOOKING_LEAD_DAYS * 24 * 60 * 60_000) {
    return { ok: false, error: `Bookings open ${MAX_BOOKING_LEAD_DAYS} days ahead`, status: 400 };
  }

  return prisma.$transaction(async (tx) => {
    const room = await tx.room.findUnique({ where: { id: roomId }, select: { archivedAt: true } });
    if (!room || room.archivedAt) return { ok: false, error: "Room not found", status: 404 };

    await lockRoom(tx, roomId);
    const conflict = (await getRoomSchedule(roomId, start, end, {}, tx))[0];
    if (conflict) return conflictError(conflict);

    const booking = await tx.roomBooking.create({
      data: {
        roomId,
        userId: input.userId,
        start,
        end,
        title: input.title?.trim() || null,
        source: input.source,
      },
      select: { id: true, start: true, end: true },
    });
    return { ok: true, value: booking };
  });
}

/**
 * Cancel a booking, or — if it's already underway — end it now so the rest of
 * the slot frees up. The caller checks who may do this.
 */
export async function cancelRoomBooking(bookingId: string, actorUserId: string) {
  const booking = await prisma.roomBooking.findUnique({ where: { id: bookingId } });
  if (!booking || booking.cancelledAt) return;
  const now = new Date();
  if (booking.start < now && booking.end > now) {
    await prisma.roomBooking.update({ where: { id: bookingId }, data: { end: now } });
  } else {
    await prisma.roomBooking.update({
      where: { id: bookingId },
      data: { cancelledAt: now, cancelledByUserId: actorUserId },
    });
  }
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
      const conflict = schedule.find((s) => overlaps(s, occ.start, occ.end));
      if (conflict) return conflictError(conflict, room.name);
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
    organizer: i.organizer,
    isEvent: i.isEvent,
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
