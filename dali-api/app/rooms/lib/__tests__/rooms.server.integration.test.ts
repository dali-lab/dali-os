import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "~/lib/db.server";
import {
  assertMeetingRoomsFree,
  bookRoomsForEvent,
  cancelRoomBooking,
  createRoomBooking,
  extendRoomBooking,
  getRoomSchedule,
  releaseEventRoomBookings,
  retimeEventRoomBookings,
  truncateEventRoomBookings,
} from "~/rooms/lib/rooms.server";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Midnight UTC tomorrow: Web bookings must start in the future and within 90 days.
const DAY0 = new Date(Math.ceil((Date.now() + HOUR) / DAY) * DAY + DAY);
const at = (day: number, hour: number, min = 0) => new Date(DAY0.getTime() + day * DAY + hour * HOUR + min * 60_000);

let userId: string;
let roomId: string;
let otherRoomId: string;

async function makeUser(firstName = "Ada", lastName = "Lovelace", email = "ada@example.edu") {
  return (await prisma.user.create({ data: { firstName, lastName, daliEmail: email } })).id;
}

beforeEach(async () => {
  userId = await makeUser();
  roomId = (await prisma.room.create({ data: { name: "Room A" } })).id;
  otherRoomId = (await prisma.room.create({ data: { name: "Room B" } })).id;
});

function book(over: Partial<Parameters<typeof createRoomBooking>[0]> & { start: Date; end: Date }) {
  return createRoomBooking({ roomId, userId, source: "Web", ...over });
}

const live = (rid = roomId) => prisma.roomBooking.findMany({ where: { roomId: rid, cancelledAt: null }, orderBy: { start: "asc" } });

describe("createRoomBooking conflicts", () => {
  it("rejects every kind of overlap with a 409 naming the existing booking", async () => {
    await book({ start: at(0, 10), end: at(0, 12), title: "Standup" });
    const overlaps: [Date, Date][] = [
      [at(0, 9), at(0, 10, 30)], // overlaps the head
      [at(0, 11), at(0, 13)], // overlaps the tail
      [at(0, 10, 30), at(0, 11, 30)], // inside
      [at(0, 9), at(0, 13)], // around
      [at(0, 10), at(0, 12)], // identical
    ];
    for (const [start, end] of overlaps) {
      const res = await book({ start, end });
      expect(res).toMatchObject({ ok: false, status: 409 });
      expect(res.ok === false && res.error).toContain("Standup");
    }
    expect(await live()).toHaveLength(1);
  });

  it("allows back-to-back bookings (end == next start) on both sides", async () => {
    await book({ start: at(0, 10), end: at(0, 11) });
    expect((await book({ start: at(0, 11), end: at(0, 12) })).ok).toBe(true);
    expect((await book({ start: at(0, 9), end: at(0, 10) })).ok).toBe(true);
    expect(await live()).toHaveLength(3);
  });

  it("ignores cancelled bookings and does not conflict across rooms", async () => {
    const first = await book({ start: at(0, 10), end: at(0, 11) });
    expect(first.ok).toBe(true);
    expect((await book({ roomId: otherRoomId, start: at(0, 10), end: at(0, 11) })).ok).toBe(true);
    await prisma.roomBooking.update({ where: { id: first.ok ? first.value.id : "" }, data: { cancelledAt: new Date() } });

    expect((await book({ start: at(0, 10), end: at(0, 11) })).ok).toBe(true);
  });

  it("rejects archived and unknown rooms", async () => {
    await prisma.room.update({ where: { id: otherRoomId }, data: { archivedAt: new Date() } });
    expect(await book({ roomId: otherRoomId, start: at(0, 10), end: at(0, 11) })).toMatchObject({ ok: false, status: 404 });
    expect(await book({ roomId: "missing", start: at(0, 10), end: at(0, 11) })).toMatchObject({ ok: false, status: 404 });
  });

  it("a confirmed meeting in the room blocks a booking; a still-searching one does not", async () => {
    const meeting = (status: "Confirmed" | "Searching", selectedAt: Date) =>
      prisma.scheduledMeeting.create({
        data: {
          organizerId: userId,
          title: "Weekly sync",
          durationMinutes: 60,
          scopeType: "None",
          status,
          selectedAt,
          ownerCalendarEmail: "ada@example.edu",
          rooms: { connect: { id: roomId } },
        },
      });
    await meeting("Confirmed", at(0, 10));
    await meeting("Searching", at(0, 14));

    const blocked = await book({ start: at(0, 10, 30), end: at(0, 11, 30) });
    expect(blocked).toMatchObject({ ok: false, status: 409 });
    expect(blocked.ok === false && blocked.error).toContain("Weekly sync");
    expect((await book({ start: at(0, 14), end: at(0, 15) })).ok).toBe(true);
  });

  it("hiring: interviews may sit inside a hold and holds may overlap, but everyone else is blocked", async () => {
    expect((await book({ source: "InterviewHold", start: at(1, 9), end: at(1, 17) })).ok).toBe(true);
    expect((await book({ source: "InterviewHold", start: at(1, 12), end: at(1, 18) })).ok).toBe(true);
    expect((await book({ source: "Interview", start: at(1, 10), end: at(1, 11) })).ok).toBe(true);

    expect(await book({ source: "Web", start: at(1, 13), end: at(1, 14) })).toMatchObject({ ok: false, status: 409 });
    // Two interviews at the same time still collide.
    expect(await book({ source: "Interview", start: at(1, 10, 30), end: at(1, 11, 30) })).toMatchObject({ ok: false, status: 409 });
  });

  it("applies human limits to Web bookings but not to hiring's system bookings", async () => {
    expect(await book({ start: at(0, 0), end: at(0, 9, 1) })).toMatchObject({ ok: false, status: 400 });
    expect(await book({ start: new Date(Date.now() - DAY), end: new Date(Date.now() - DAY + HOUR) })).toMatchObject({ ok: false, status: 400 });
    expect(await book({ start: at(100, 10), end: at(100, 11) })).toMatchObject({ ok: false, status: 400 });
    expect(await book({ start: at(0, 11), end: at(0, 10) })).toMatchObject({ ok: false, status: 400 });

    expect((await book({ source: "InterviewHold", start: at(100, 8), end: at(100, 20) })).ok).toBe(true);
  });
});

describe("createRoomBooking races", () => {
  it("lets exactly one of N simultaneous identical bookings win", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => book({ start: at(0, 10), end: at(0, 11) })),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.status === 409)).toHaveLength(7);
    expect(await live()).toHaveLength(1);
  });

  it("lets only one of two simultaneous partially-overlapping bookings win", async () => {
    const results = await Promise.all([
      book({ start: at(0, 10), end: at(0, 11, 30) }),
      book({ start: at(0, 11), end: at(0, 12, 30) }),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await live()).toHaveLength(1);
  });

  it("does not serialize bookings of different rooms, nor adjacent slots in one room", async () => {
    const results = await Promise.all([
      book({ roomId, start: at(0, 10), end: at(0, 11) }),
      book({ roomId, start: at(0, 11), end: at(0, 12) }),
      book({ roomId: otherRoomId, start: at(0, 10), end: at(0, 11) }),
    ]);

    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("a recurring series and a single booking racing for the same occurrence: one wins", async () => {
    const results = await Promise.all([
      book({ start: at(0, 10), end: at(0, 11), recurrenceRule: "FREQ=DAILY;COUNT=3" }),
      book({ start: at(1, 10), end: at(1, 11) }),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const rows = await live();
    expect(rows).toHaveLength(1);
  });
});

describe("recurring series", () => {
  it("stores seriesEnd as the end of the last occurrence", async () => {
    const res = await book({ start: at(0, 10), end: at(0, 11), recurrenceRule: "FREQ=DAILY;COUNT=3" });
    expect(res.ok).toBe(true);
    const row = (await live())[0]!;
    expect(row.recurrenceRule).toBe("FREQ=DAILY;COUNT=3");
    expect(row.seriesEnd).toEqual(at(2, 11));
  });

  it("rejects a series with no end and an invalid rule without writing anything", async () => {
    expect(await book({ start: at(0, 10), end: at(0, 11), recurrenceRule: "FREQ=DAILY" })).toMatchObject({ ok: false, status: 400 });
    expect(await book({ start: at(0, 10), end: at(0, 11), recurrenceRule: "garbage" })).toMatchObject({ ok: false, status: 400 });
    expect(await prisma.roomBooking.count()).toBe(0);
  });

  it("a single booking on any later occurrence blocks the series, and nothing is written", async () => {
    await book({ start: at(2, 10, 30), end: at(2, 11, 30), title: "Review" });

    const res = await book({ start: at(0, 10), end: at(0, 11), recurrenceRule: "FREQ=DAILY;COUNT=3" });

    expect(res).toMatchObject({ ok: false, status: 409 });
    expect(res.ok === false && res.error).toContain("Review");
    expect(await prisma.roomBooking.count()).toBe(1);
  });

  it("a series blocks a later single booking on one of its days but not in the gaps between", async () => {
    await book({ start: at(0, 10), end: at(0, 11), recurrenceRule: "FREQ=DAILY;COUNT=3" });

    expect(await book({ start: at(1, 10, 30), end: at(1, 11, 30) })).toMatchObject({ ok: false, status: 409 });
    expect((await book({ start: at(1, 12), end: at(1, 13) })).ok).toBe(true);
    expect((await book({ start: at(3, 10), end: at(3, 11) })).ok).toBe(true); // after the series ended
  });

  it("two series conflict only if some occurrence collides", async () => {
    await book({ start: at(0, 10), end: at(0, 11), recurrenceRule: "FREQ=DAILY;COUNT=3" });

    expect((await book({ start: at(0, 11), end: at(0, 12), recurrenceRule: "FREQ=DAILY;COUNT=3" })).ok).toBe(true);
    expect(await book({ start: at(2, 10), end: at(2, 11), recurrenceRule: "FREQ=DAILY;COUNT=2" })).toMatchObject({ ok: false, status: 409 });
  });

  it("an occurrence cancelled with scope 'this' frees just that slot", async () => {
    const series = await book({ start: at(0, 10), end: at(0, 11), recurrenceRule: "FREQ=DAILY;COUNT=3" });
    const id = series.ok ? series.value.id : "";
    expect(await cancelRoomBooking(id, userId, { scope: "this", occurrenceStart: at(1, 10) })).toEqual({ ok: true, value: null });

    expect((await book({ start: at(1, 10), end: at(1, 11) })).ok).toBe(true);
    expect(await book({ start: at(2, 10), end: at(2, 11) })).toMatchObject({ ok: false, status: 409 });
    expect(await prisma.roomBookingException.findMany({ where: { roomBookingId: id } })).toMatchObject([{ cancelled: true, originalStart: at(1, 10) }]);
  });
});

describe("getRoomSchedule", () => {
  it("lists occurrences in the window only, skipping cancelled bookings and cancelled occurrences", async () => {
    const series = await book({ start: at(0, 10), end: at(0, 11), recurrenceRule: "FREQ=DAILY;COUNT=4" });
    await cancelRoomBooking(series.ok ? series.value.id : "", userId, { scope: "this", occurrenceStart: at(1, 10) });
    const gone = await book({ start: at(0, 14), end: at(0, 15) });
    await cancelRoomBooking(gone.ok ? gone.value.id : "", userId);

    const items = await getRoomSchedule(roomId, at(0, 0), at(3, 0));

    expect(items.map((i) => i.start)).toEqual([at(0, 10), at(2, 10)]);
  });

  it("excludeBookingId leaves the named booking out", async () => {
    const a = await book({ start: at(0, 10), end: at(0, 11) });
    await book({ start: at(0, 12), end: at(0, 13) });

    const items = await getRoomSchedule(roomId, at(0, 0), at(1, 0), { excludeBookingId: a.ok ? a.value.id : "" });

    expect(items.map((i) => i.start)).toEqual([at(0, 12)]);
  });
});

describe("cancelRoomBooking", () => {
  it("soft-cancels a future booking and records who did it", async () => {
    const res = await book({ start: at(0, 10), end: at(0, 11) });
    const id = res.ok ? res.value.id : "";

    await cancelRoomBooking(id, userId);

    expect(await prisma.roomBooking.findUniqueOrThrow({ where: { id } })).toMatchObject({ cancelledByUserId: userId });
    expect((await prisma.roomBooking.findUniqueOrThrow({ where: { id } })).cancelledAt).not.toBeNull();
    expect((await book({ start: at(0, 10), end: at(0, 11) })).ok).toBe(true);
  });

  it("ends an underway booking now instead of cancelling it", async () => {
    const row = await prisma.roomBooking.create({
      data: { roomId, userId, start: new Date(Date.now() - HOUR), end: new Date(Date.now() + HOUR) },
    });
    const before = Date.now();

    await cancelRoomBooking(row.id, userId);

    const after = await prisma.roomBooking.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.cancelledAt).toBeNull();
    expect(after.end.getTime()).toBeGreaterThanOrEqual(before);
    expect(after.end.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("is a no-op for an already-cancelled booking and for a missing one", async () => {
    const res = await book({ start: at(0, 10), end: at(0, 11) });
    const id = res.ok ? res.value.id : "";
    await cancelRoomBooking(id, userId);
    const first = (await prisma.roomBooking.findUniqueOrThrow({ where: { id } })).cancelledAt;

    expect(await cancelRoomBooking(id, userId)).toEqual({ ok: true, value: null });
    expect(await cancelRoomBooking("missing", userId)).toEqual({ ok: true, value: null });
    expect((await prisma.roomBooking.findUniqueOrThrow({ where: { id } })).cancelledAt).toEqual(first);
  });

  it("scope 'all' cancels the whole series", async () => {
    const res = await book({ start: at(0, 10), end: at(0, 11), recurrenceRule: "FREQ=DAILY;COUNT=3" });

    await cancelRoomBooking(res.ok ? res.value.id : "", userId, { scope: "all" });

    expect(await live()).toHaveLength(0);
    expect((await book({ start: at(1, 10), end: at(1, 11) })).ok).toBe(true);
  });

  it("scope 'following' truncates the series, rewrites seriesEnd and drops later exceptions", async () => {
    const res = await book({ start: at(0, 10), end: at(0, 11), recurrenceRule: "FREQ=DAILY;COUNT=5" });
    const id = res.ok ? res.value.id : "";
    await cancelRoomBooking(id, userId, { scope: "this", occurrenceStart: at(3, 10) });

    await cancelRoomBooking(id, userId, { scope: "following", occurrenceStart: at(2, 10) });

    const row = await prisma.roomBooking.findUniqueOrThrow({ where: { id }, include: { exceptions: true } });
    expect(row.cancelledAt).toBeNull();
    expect(row.recurrenceRule).toContain("UNTIL=");
    expect(row.seriesEnd).toEqual(at(1, 11));
    expect(row.exceptions).toHaveLength(0);
    expect((await getRoomSchedule(roomId, at(0, 0), at(6, 0))).map((i) => i.start)).toEqual([at(0, 10), at(1, 10)]);
    expect((await book({ start: at(2, 10), end: at(2, 11) })).ok).toBe(true);
  });

  it("scope 'following' from the first occurrence cancels the whole series", async () => {
    const res = await book({ start: at(0, 10), end: at(0, 11), recurrenceRule: "FREQ=DAILY;COUNT=3" });
    const id = res.ok ? res.value.id : "";

    await cancelRoomBooking(id, userId, { scope: "following", occurrenceStart: at(0, 10) });

    expect((await prisma.roomBooking.findUniqueOrThrow({ where: { id } })).cancelledAt).not.toBeNull();
  });

  it("rejects a scoped cancel with no occurrence, or one that is not part of the series", async () => {
    const res = await book({ start: at(0, 10), end: at(0, 11), recurrenceRule: "FREQ=DAILY;COUNT=3" });
    const id = res.ok ? res.value.id : "";

    expect(await cancelRoomBooking(id, userId, { scope: "this" })).toMatchObject({ ok: false, status: 400 });
    expect(await cancelRoomBooking(id, userId, { scope: "this", occurrenceStart: at(0, 12) })).toMatchObject({ ok: false, status: 404 });
    expect(await prisma.roomBookingException.count()).toBe(0);
  });
});

describe("extendRoomBooking", () => {
  it("extends a single booking when the room is free", async () => {
    const res = await book({ start: at(0, 10), end: at(0, 11) });
    const id = res.ok ? res.value.id : "";

    const out = await extendRoomBooking(id, at(0, 10), 30);

    expect(out).toEqual({ ok: true, value: { start: at(0, 10), end: at(0, 11, 30) } });
    expect((await prisma.roomBooking.findUniqueOrThrow({ where: { id } })).end).toEqual(at(0, 11, 30));
  });

  it("refuses to run into the next booking and leaves the end untouched", async () => {
    const res = await book({ start: at(0, 10), end: at(0, 11) });
    await book({ start: at(0, 11, 15), end: at(0, 12), title: "Next up" });

    const out = await extendRoomBooking(res.ok ? res.value.id : "", at(0, 10), 30);

    expect(out).toMatchObject({ ok: false, status: 409 });
    expect((await prisma.roomBooking.findUniqueOrThrow({ where: { id: res.ok ? res.value.id : "" } })).end).toEqual(at(0, 11));
  });

  it("extends one occurrence of a series through an exception, leaving the rest alone", async () => {
    const res = await book({ start: at(0, 10), end: at(0, 11), recurrenceRule: "FREQ=DAILY;COUNT=3" });
    const id = res.ok ? res.value.id : "";

    await extendRoomBooking(id, at(1, 10), 30);

    const row = await prisma.roomBooking.findUniqueOrThrow({ where: { id }, include: { exceptions: true } });
    expect(row.end).toEqual(at(0, 11));
    expect(row.exceptions).toMatchObject([{ originalStart: at(1, 10), overrideDurationMin: 90 }]);
    expect((await getRoomSchedule(roomId, at(0, 0), at(3, 0))).map((i) => [i.start, i.end])).toEqual([
      [at(0, 10), at(0, 11)],
      [at(1, 10), at(1, 11, 30)],
      [at(2, 10), at(2, 11)],
    ]);
  });

  it("caps an extension at the longest allowed booking", async () => {
    const res = await book({ start: at(0, 10), end: at(0, 17) });
    expect(await extendRoomBooking(res.ok ? res.value.id : "", at(0, 10), 120)).toMatchObject({ ok: false, status: 400 });
  });

  it("an extend racing a booking for the gap: exactly one wins and nothing overlaps", async () => {
    const res = await book({ start: at(0, 10), end: at(0, 11) });
    const id = res.ok ? res.value.id : "";

    const [ext, other] = await Promise.all([
      extendRoomBooking(id, at(0, 10), 30),
      book({ start: at(0, 11), end: at(0, 11, 30) }),
    ]);

    expect([ext.ok, other.ok].filter(Boolean)).toHaveLength(1);
    const rows = await live();
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.start.getTime()).toBeGreaterThanOrEqual(rows[i - 1]!.end.getTime());
  });
});

describe("calendar-event holds", () => {
  async function eventHolds(rooms: string[], over: { start?: Date; end?: Date; recurrenceRule?: string } = {}) {
    const res = await bookRoomsForEvent({
      roomIds: rooms,
      userId,
      start: over.start ?? at(0, 10),
      end: over.end ?? at(0, 11),
      title: "Event",
      recurrenceRule: over.recurrenceRule,
    });
    if (!res.ok) throw new Error(res.error);
    await prisma.roomBooking.updateMany({ where: { id: { in: res.value } }, data: { sourceEventId: "evt-1" } });
    return res.value;
  }

  it("bookRoomsForEvent is all or none: a conflict in a later room removes the earlier hold", async () => {
    await book({ roomId: otherRoomId, start: at(0, 10, 30), end: at(0, 11, 30) });

    const res = await bookRoomsForEvent({ roomIds: [roomId, otherRoomId], userId, start: at(0, 10), end: at(0, 11), title: "Event" });

    expect(res).toMatchObject({ ok: false, status: 409 });
    expect(await live(roomId)).toHaveLength(0);
    expect(await live(otherRoomId)).toHaveLength(1);
  });

  it("retime moves every hold of the event", async () => {
    await eventHolds([roomId, otherRoomId]);

    const res = await retimeEventRoomBookings({ userId, sourceEventId: "evt-1", start: at(0, 14), end: at(0, 15) });

    expect(res).toEqual({ ok: true, value: 2 });
    expect((await live(roomId))[0]!.start).toEqual(at(0, 14));
    expect((await live(otherRoomId))[0]!.start).toEqual(at(0, 14));
  });

  it("retime is all or none: a taken room at the new time rejects the move and nothing changes", async () => {
    await eventHolds([roomId, otherRoomId]);
    await book({ roomId: otherRoomId, start: at(0, 14), end: at(0, 15), title: "Taken" });

    const res = await retimeEventRoomBookings({ userId, sourceEventId: "evt-1", start: at(0, 14), end: at(0, 15) });

    expect(res).toMatchObject({ ok: false, status: 409 });
    expect((await live(roomId))[0]!.start).toEqual(at(0, 10));
    expect((await live(otherRoomId))[0]!.start).toEqual(at(0, 10));
  });

  it("retime may overlap the event's own old slot", async () => {
    await eventHolds([roomId]);
    expect(await retimeEventRoomBookings({ userId, sourceEventId: "evt-1", start: at(0, 10, 30), end: at(0, 11, 30) })).toEqual({ ok: true, value: 1 });
  });

  it("retiming a whole series re-anchors it, shifts its exceptions and recomputes seriesEnd", async () => {
    const [id] = await eventHolds([roomId], { recurrenceRule: "FREQ=DAILY;COUNT=3" });
    await cancelRoomBooking(id!, userId, { scope: "this", occurrenceStart: at(1, 10) });

    const res = await retimeEventRoomBookings({ userId, sourceEventId: "evt-1", start: at(0, 14), end: at(0, 15) });

    expect(res).toEqual({ ok: true, value: 1 });
    const row = await prisma.roomBooking.findUniqueOrThrow({ where: { id: id! }, include: { exceptions: true } });
    expect(row.start).toEqual(at(0, 14));
    expect(row.seriesEnd).toEqual(at(2, 15));
    expect(row.exceptions).toMatchObject([{ originalStart: at(1, 14), cancelled: true }]);
    expect((await getRoomSchedule(roomId, at(0, 0), at(4, 0))).map((i) => i.start)).toEqual([at(0, 14), at(2, 14)]);
  });

  it("retiming one occurrence checks only that slot and writes an exception", async () => {
    const [id] = await eventHolds([roomId], { recurrenceRule: "FREQ=DAILY;COUNT=3" });
    await book({ start: at(1, 16), end: at(1, 17), title: "Taken" });

    const blocked = await retimeEventRoomBookings({ userId, sourceEventId: "evt-1", scope: "this", occurrenceStart: at(1, 10), start: at(1, 16), end: at(1, 17) });
    expect(blocked).toMatchObject({ ok: false, status: 409 });
    expect(await prisma.roomBookingException.count()).toBe(0);

    const ok = await retimeEventRoomBookings({ userId, sourceEventId: "evt-1", scope: "this", occurrenceStart: at(1, 10), start: at(1, 12), end: at(1, 13) });
    expect(ok).toEqual({ ok: true, value: 1 });
    expect((await prisma.roomBooking.findUniqueOrThrow({ where: { id: id! } })).start).toEqual(at(0, 10));
    expect((await getRoomSchedule(roomId, at(1, 0), at(2, 0)))[0]!.start).toEqual(at(1, 12));
  });

  it("retime scope 'this' needs an occurrenceStart; an inverted range is rejected", async () => {
    await eventHolds([roomId], { recurrenceRule: "FREQ=DAILY;COUNT=3" });
    expect(await retimeEventRoomBookings({ userId, sourceEventId: "evt-1", scope: "this", start: at(1, 12), end: at(1, 13) })).toMatchObject({ ok: false, status: 400 });
    expect(await retimeEventRoomBookings({ userId, sourceEventId: "evt-1", start: at(1, 13), end: at(1, 12) })).toMatchObject({ ok: false, status: 400 });
  });

  it("release cancels every hold of the event and only that user's", async () => {
    await eventHolds([roomId, otherRoomId]);
    const otherUser = await makeUser("Grace", "Hopper", "grace@example.edu");
    const theirs = await prisma.roomBooking.create({
      data: { roomId, userId: otherUser, start: at(3, 10), end: at(3, 11), sourceEventId: "evt-1" },
    });

    await releaseEventRoomBookings(userId, "evt-1");

    expect(await live(otherRoomId)).toHaveLength(0);
    expect((await live(roomId)).map((b) => b.id)).toEqual([theirs.id]);
  });

  it("truncate ends an event's series just before the split point", async () => {
    const [id] = await eventHolds([roomId], { recurrenceRule: "FREQ=DAILY;COUNT=4" });

    await truncateEventRoomBookings(userId, "evt-1", at(2, 10));

    const row = await prisma.roomBooking.findUniqueOrThrow({ where: { id: id! } });
    expect(row.seriesEnd).toEqual(at(1, 11));
    expect((await getRoomSchedule(roomId, at(0, 0), at(5, 0))).map((i) => i.start)).toEqual([at(0, 10), at(1, 10)]);
  });
});

describe("assertMeetingRoomsFree", () => {
  it("reports a booking that collides with the meeting and passes when it is clear", async () => {
    await book({ start: at(0, 10), end: at(0, 11), title: "Focus time" });

    const clash = await assertMeetingRoomsFree({ roomIds: [roomId], selectedAt: at(0, 10, 30), durationMinutes: 30, recurrenceRule: null });
    expect(clash).toMatchObject({ ok: false, status: 409 });
    expect(clash.ok === false && clash.error).toContain("Focus time");

    expect(await assertMeetingRoomsFree({ roomIds: [roomId], selectedAt: at(0, 11), durationMinutes: 30, recurrenceRule: null })).toEqual({ ok: true, value: null });
    expect(await assertMeetingRoomsFree({ roomIds: [otherRoomId], selectedAt: at(0, 10, 30), durationMinutes: 30, recurrenceRule: null })).toEqual({ ok: true, value: null });
  });

  it("checks every occurrence of a recurring meeting", async () => {
    await book({ start: at(2, 10), end: at(2, 11) });

    const res = await assertMeetingRoomsFree({ roomIds: [roomId], selectedAt: at(0, 10), durationMinutes: 60, recurrenceRule: "FREQ=DAILY;COUNT=4" });

    expect(res).toMatchObject({ ok: false, status: 409 });
  });

  it("ignores the meeting being edited, and a room archived after it was picked", async () => {
    const meeting = await prisma.scheduledMeeting.create({
      data: {
        organizerId: userId,
        title: "Mine",
        durationMinutes: 60,
        scopeType: "None",
        status: "Confirmed",
        selectedAt: at(0, 10),
        ownerCalendarEmail: "ada@example.edu",
        rooms: { connect: { id: roomId } },
      },
    });
    const input = { roomIds: [roomId], selectedAt: at(0, 10), durationMinutes: 60, recurrenceRule: null };

    expect(await assertMeetingRoomsFree(input)).toMatchObject({ ok: false, status: 409 });
    expect(await assertMeetingRoomsFree({ ...input, meetingId: meeting.id })).toEqual({ ok: true, value: null });

    await prisma.room.update({ where: { id: roomId }, data: { archivedAt: new Date() } });
    expect(await assertMeetingRoomsFree({ ...input, meetingId: meeting.id, newRoomIds: [] })).toEqual({ ok: true, value: null });
    expect(await assertMeetingRoomsFree({ ...input, meetingId: meeting.id })).toMatchObject({ ok: false, status: 404 });
  });
});
