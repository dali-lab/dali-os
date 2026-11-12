import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => {
  const prisma = {
    room: { findUnique: vi.fn() },
    roomBooking: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    roomBookingException: { upsert: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    scheduledMeeting: { findMany: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
  return { prisma };
});
vi.mock("~/lib/scheduled-meeting", () => ({ CHECK_IN_GRACE_MIN: 15 }));
vi.mock("~/lib/roles", () => ({ currentTerm: vi.fn(), isCore: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { currentTerm, isCore } from "~/lib/roles";
import { cancelRoomBookingAsMember, updateRoomBookingAsMember } from "~/rooms/lib/rooms.server";

const m = prisma as unknown as {
  room: { findUnique: ReturnType<typeof vi.fn> };
  roomBooking: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  roomBookingException: {
    upsert: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
  };
  scheduledMeeting: { findMany: ReturnType<typeof vi.fn> };
  $executeRaw: ReturnType<typeof vi.fn>;
};
const mockCore = isCore as unknown as ReturnType<typeof vi.fn>;
const mockTerm = currentTerm as unknown as ReturnType<typeof vi.fn>;

// Fixed, so a daily series' times can't happen to land on the real clock and
// read as underway.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2030-01-07T12:00:00Z"));

const H = 60 * 60_000;
const DAY = 24 * H;
const ada = { id: "u1", firstName: "Ada", lastName: "Lovelace", photoUrl: null };
// Whole seconds, because rrule's anchor drops milliseconds, and well clear of
// midnight so a +1h edit stays on the same lab day.
const NOON_UTC = 16;
const inDays = (n: number, hour = NOON_UTC) => {
  const d = new Date(Date.now() + n * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};
const plusHours = (d: Date, n: number) => new Date(d.getTime() + n * H);

function row(over: Record<string, unknown> = {}) {
  const start = inDays(2);
  return {
    id: "b1",
    roomId: "r1",
    userId: "u1",
    title: "Design crit",
    source: "Web",
    sourceEventId: null,
    cancelledAt: null,
    applicationCycleId: null,
    recurrenceRule: null,
    seriesEnd: null,
    start,
    end: plusHours(start, 1),
    exceptions: [],
    ...over,
  };
}

function other(start: Date, end: Date, over: Record<string, unknown> = {}) {
  return {
    id: "other",
    title: "Lab night",
    start,
    end,
    source: "Web",
    recurrenceRule: null,
    exceptions: [],
    user: ada,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.roomBooking.findMany.mockResolvedValue([]);
  m.scheduledMeeting.findMany.mockResolvedValue([]);
  m.room.findUnique.mockResolvedValue({ archivedAt: null, name: "Studio" });
  m.roomBookingException.upsert.mockResolvedValue({});
  m.roomBookingException.deleteMany.mockResolvedValue({ count: 0 });
  m.roomBookingException.createMany.mockResolvedValue({ count: 0 });
  mockCore.mockResolvedValue(false);
  mockTerm.mockResolvedValue(null);
});

describe("updateRoomBookingAsMember: who can edit what", () => {
  const b = row();

  it("404s a missing or cancelled booking", async () => {
    m.roomBooking.findUnique.mockResolvedValueOnce(null);
    await expect(updateRoomBookingAsMember("b1", "u1", b)).resolves.toMatchObject({ ok: false, status: 404 });
    m.roomBooking.findUnique.mockResolvedValueOnce(row({ cancelledAt: new Date() }));
    await expect(updateRoomBookingAsMember("b1", "u1", b)).resolves.toMatchObject({ ok: false, status: 404 });
  });

  it("forbids anyone but the booker or Core", async () => {
    m.roomBooking.findUnique.mockResolvedValue(row());
    await expect(updateRoomBookingAsMember("b1", "u2", b)).resolves.toEqual({
      ok: false,
      error: "Forbidden",
      status: 403,
    });
    expect(m.roomBooking.update).not.toHaveBeenCalled();
  });

  it("lets Core edit someone else's booking", async () => {
    mockCore.mockResolvedValue(true);
    m.roomBooking.findUnique.mockResolvedValue(row());
    await expect(updateRoomBookingAsMember("b1", "u2", { ...b, title: "Moved" })).resolves.toMatchObject({ ok: true });
  });

  it.each(["Interview", "InterviewHold"])("refuses a %s booking, even for Core", async (source) => {
    mockCore.mockResolvedValue(true);
    m.roomBooking.findUnique.mockResolvedValue(row({ source }));
    await expect(updateRoomBookingAsMember("b1", "u1", b)).resolves.toMatchObject({
      ok: false,
      status: 409,
      error: expect.stringContaining("hiring"),
    });
  });

  it("refuses a calendar event's hold, even for Core, because the event owns its time", async () => {
    mockCore.mockResolvedValue(true);
    m.roomBooking.findUnique.mockResolvedValue(row({ sourceEventId: "evt1" }));
    await expect(updateRoomBookingAsMember("b1", "u1", b)).resolves.toMatchObject({
      ok: false,
      status: 409,
      error: expect.stringContaining("calendar"),
    });
  });
});

describe("updateRoomBookingAsMember: a single booking", () => {
  it("saves a new room, title and time", async () => {
    const b = row();
    m.roomBooking.findUnique.mockResolvedValue(b);
    const start = plusHours(b.start, 1);
    const end = plusHours(b.start, 3);
    const res = await updateRoomBookingAsMember("b1", "u1", { start, end, roomId: "r2", title: " Retro " });
    expect(res).toEqual({ ok: true, value: { start, end } });
    expect(m.roomBooking.update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { roomId: "r2", title: "Retro", start, end },
    });
  });

  it("clears the title with null and keeps it when left out", async () => {
    const b = row();
    m.roomBooking.findUnique.mockResolvedValue(b);
    await updateRoomBookingAsMember("b1", "u1", { start: b.start, end: b.end, title: null });
    expect(m.roomBooking.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: null }) }));
    await updateRoomBookingAsMember("b1", "u1", { start: b.start, end: b.end });
    expect(m.roomBooking.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: "Design crit" }) }),
    );
  });

  it("doesn't conflict with itself and asks for the schedule without it", async () => {
    const b = row();
    m.roomBooking.findUnique.mockResolvedValue(b);
    await updateRoomBookingAsMember("b1", "u1", { start: b.start, end: plusHours(b.end, 1) });
    const where = m.roomBooking.findMany.mock.calls[0]![0].where;
    expect(where.id).toEqual({ not: "b1" });
  });

  it("409s on a conflict in the target room, naming it, and changes nothing", async () => {
    const b = row();
    m.roomBooking.findUnique.mockResolvedValue(b);
    m.room.findUnique.mockResolvedValue({ archivedAt: null, name: "Lounge" });
    m.roomBooking.findMany.mockResolvedValue([other(b.start, b.end)]);
    const res = await updateRoomBookingAsMember("b1", "u1", { start: b.start, end: b.end, roomId: "r2" });
    expect(res).toMatchObject({ ok: false, status: 409, error: expect.stringContaining("Lounge") });
    expect(m.roomBooking.update).not.toHaveBeenCalled();
  });

  it("locks both rooms in a fixed order when the room changes", async () => {
    const b = row({ roomId: "z-room" });
    m.roomBooking.findUnique.mockResolvedValue(b);
    await updateRoomBookingAsMember("b1", "u1", { start: b.start, end: b.end, roomId: "a-room" });
    const locked = m.$executeRaw.mock.calls.map((c) => c[1]);
    expect(locked).toEqual(["room:a-room", "room:z-room"]);
  });

  it("404s a move to an archived room", async () => {
    const b = row();
    m.roomBooking.findUnique.mockResolvedValue(b);
    m.room.findUnique.mockResolvedValue({ archivedAt: new Date(), name: "Old" });
    await expect(updateRoomBookingAsMember("b1", "u1", { start: b.start, end: b.end, roomId: "r2" })).resolves.toEqual({
      ok: false,
      error: "Room not found",
      status: 404,
    });
  });

  it("still saves a title on a booking in a room archived since", async () => {
    const b = row();
    m.roomBooking.findUnique.mockResolvedValue(b);
    m.room.findUnique.mockResolvedValue({ archivedAt: new Date(), name: "Old" });
    await expect(updateRoomBookingAsMember("b1", "u1", { start: b.start, end: b.end, title: "New" })).resolves.toMatchObject({ ok: true });
  });

  it("applies the human limits", async () => {
    const b = row();
    m.roomBooking.findUnique.mockResolvedValue(b);
    await expect(updateRoomBookingAsMember("b1", "u1", { start: b.start, end: b.start })).resolves.toMatchObject({
      error: "End must be after start",
    });
    await expect(updateRoomBookingAsMember("b1", "u1", { start: b.start, end: plusHours(b.start, 9) })).resolves.toMatchObject({
      error: "Bookings can be at most 8 hours",
    });
    await expect(
      updateRoomBookingAsMember("b1", "u1", { start: inDays(100), end: plusHours(inDays(100), 1) }),
    ).resolves.toMatchObject({ error: "Bookings open 90 days ahead" });
    await expect(
      updateRoomBookingAsMember("b1", "u1", { start: plusHours(new Date(), -2), end: plusHours(new Date(), 1) }),
    ).resolves.toMatchObject({ error: "Can't book a time that has already started" });
  });
});

describe("updateRoomBookingAsMember: once it has started", () => {
  const underway = () => {
    const start = plusHours(new Date(), -1);
    return row({ start, end: plusHours(start, 2) });
  };

  it("can change its end and title", async () => {
    const b = underway();
    m.roomBooking.findUnique.mockResolvedValue(b);
    const end = plusHours(b.end, 1);
    await expect(updateRoomBookingAsMember("b1", "u1", { start: b.start, end, title: "Longer" })).resolves.toMatchObject({ ok: true });
  });

  it("can't move its start", async () => {
    const b = underway();
    m.roomBooking.findUnique.mockResolvedValue(b);
    await expect(
      updateRoomBookingAsMember("b1", "u1", { start: plusHours(b.start, 2), end: plusHours(b.end, 2) }),
    ).resolves.toMatchObject({ ok: false, status: 409, error: expect.stringContaining("start") });
  });

  it("can't change room", async () => {
    const b = underway();
    m.roomBooking.findUnique.mockResolvedValue(b);
    await expect(updateRoomBookingAsMember("b1", "u1", { start: b.start, end: b.end, roomId: "r2" })).resolves.toMatchObject({
      ok: false,
      status: 409,
      error: expect.stringContaining("room"),
    });
  });

  it("can't end in the past, which is what End is for", async () => {
    const b = underway();
    m.roomBooking.findUnique.mockResolvedValue(b);
    await expect(
      updateRoomBookingAsMember("b1", "u1", { start: b.start, end: plusHours(new Date(), -0.5) }),
    ).resolves.toMatchObject({ ok: false, status: 400 });
  });

  it("refuses a booking that has already ended", async () => {
    const start = plusHours(new Date(), -3);
    const b = row({ start, end: plusHours(start, 1) });
    m.roomBooking.findUnique.mockResolvedValue(b);
    await expect(updateRoomBookingAsMember("b1", "u1", { start: b.start, end: b.end, title: "Late" })).resolves.toMatchObject({
      ok: false,
      error: "This booking has already ended",
    });
  });
});

describe("updateRoomBookingAsMember: one time of a series", () => {
  const anchor = inDays(1);
  const series = (over: Record<string, unknown> = {}) =>
    row({ start: anchor, end: plusHours(anchor, 1), recurrenceRule: "FREQ=DAILY;COUNT=10", ...over });
  const third = new Date(anchor.getTime() + 2 * DAY);
  const moved = { start: plusHours(third, 1), end: plusHours(third, 2) };

  it("needs occurrenceStart", async () => {
    m.roomBooking.findUnique.mockResolvedValue(series());
    await expect(updateRoomBookingAsMember("b1", "u1", { ...moved, scope: "this" })).resolves.toEqual({
      ok: false,
      error: "occurrenceStart is required",
      status: 400,
    });
  });

  it("404s a time that isn't in the series", async () => {
    m.roomBooking.findUnique.mockResolvedValue(series());
    await expect(
      updateRoomBookingAsMember("b1", "u1", { ...moved, scope: "this", occurrenceStart: plusHours(third, 3) }),
    ).resolves.toMatchObject({ ok: false, status: 404 });
  });

  it("writes an override and leaves the row alone", async () => {
    m.roomBooking.findUnique.mockResolvedValue(series());
    const res = await updateRoomBookingAsMember("b1", "u1", { ...moved, scope: "this", occurrenceStart: third });
    expect(res).toEqual({ ok: true, value: moved });
    expect(m.roomBooking.update).not.toHaveBeenCalled();
    expect(m.roomBookingException.upsert).toHaveBeenCalledWith({
      where: { roomBookingId_originalStart: { roomBookingId: "b1", originalStart: third } },
      create: { roomBookingId: "b1", originalStart: third, overrideStart: moved.start, overrideDurationMin: 60, cancelled: false },
      update: { overrideStart: moved.start, overrideDurationMin: 60, cancelled: false },
    });
  });

  it("can't carry a room or title, which an exception has nowhere to store", async () => {
    m.roomBooking.findUnique.mockResolvedValue(series());
    const edit = { ...moved, scope: "this" as const, occurrenceStart: third };
    await expect(updateRoomBookingAsMember("b1", "u1", { ...edit, roomId: "r2" })).resolves.toMatchObject({ ok: false, status: 400 });
    await expect(updateRoomBookingAsMember("b1", "u1", { ...edit, title: "Other" })).resolves.toMatchObject({ ok: false, status: 400 });
    expect(m.roomBookingException.upsert).not.toHaveBeenCalled();
  });

  it("collides with the series' own other dates but not with itself", async () => {
    const b = series();
    m.roomBooking.findUnique.mockResolvedValue(b);
    m.roomBooking.findMany.mockResolvedValue([{ ...b, user: ada }]);

    const ontoItself = await updateRoomBookingAsMember("b1", "u1", {
      start: plusHours(third, 0.5),
      end: plusHours(third, 1.5),
      scope: "this",
      occurrenceStart: third,
    });
    expect(ontoItself).toMatchObject({ ok: true });

    const fourth = new Date(third.getTime() + DAY);
    const ontoNextDay = await updateRoomBookingAsMember("b1", "u1", {
      start: fourth,
      end: plusHours(fourth, 1),
      scope: "this",
      occurrenceStart: third,
    });
    expect(ontoNextDay).toMatchObject({ ok: false, status: 409 });
  });
});

describe("updateRoomBookingAsMember: a whole series", () => {
  const anchor = inDays(1);
  const series = (over: Record<string, unknown> = {}) =>
    row({ start: anchor, end: plusHours(anchor, 1), recurrenceRule: "FREQ=DAILY;COUNT=10", ...over });
  const third = new Date(anchor.getTime() + 2 * DAY);

  it("moves the anchor by the time edited on a later date, not onto that date", async () => {
    m.roomBooking.findUnique.mockResolvedValue(series());
    const res = await updateRoomBookingAsMember("b1", "u1", {
      start: plusHours(third, 1),
      end: plusHours(third, 3),
      scope: "all",
      occurrenceStart: third,
    });
    expect(res).toMatchObject({ ok: true });
    expect(m.roomBooking.update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: expect.objectContaining({
        start: plusHours(anchor, 1),
        end: plusHours(anchor, 3),
        seriesEnd: new Date(anchor.getTime() + 9 * DAY + 3 * H),
      }),
    });
  });

  it("changes a title or room without touching the times or exceptions", async () => {
    const exceptions = [{ originalStart: third, overrideStart: null, overrideDurationMin: null, cancelled: true }];
    m.roomBooking.findUnique.mockResolvedValue(series({ exceptions }));
    const second = new Date(anchor.getTime() + DAY);
    await updateRoomBookingAsMember("b1", "u1", {
      start: second,
      end: plusHours(second, 1),
      title: "Renamed",
      roomId: "r2",
      scope: "all",
      occurrenceStart: second,
    });
    expect(m.roomBooking.update).toHaveBeenCalledWith({ where: { id: "b1" }, data: { roomId: "r2", title: "Renamed" } });
    expect(m.roomBookingException.deleteMany).not.toHaveBeenCalled();
  });

  it("carries cancelled dates along with the move", async () => {
    const fifth = new Date(anchor.getTime() + 4 * DAY);
    m.roomBooking.findUnique.mockResolvedValue(
      series({ exceptions: [{ originalStart: fifth, overrideStart: null, overrideDurationMin: null, cancelled: true }] }),
    );
    await updateRoomBookingAsMember("b1", "u1", {
      start: plusHours(third, 1),
      end: plusHours(third, 2),
      scope: "all",
      occurrenceStart: third,
    });
    expect(m.roomBookingException.deleteMany).toHaveBeenCalledWith({ where: { roomBookingId: "b1" } });
    expect(m.roomBookingException.createMany).toHaveBeenCalledWith({
      data: [
        { roomBookingId: "b1", originalStart: plusHours(fifth, 1), overrideStart: null, overrideDurationMin: null, cancelled: true },
      ],
    });
  });

  it("absorbs an override on the date being edited", async () => {
    m.roomBooking.findUnique.mockResolvedValue(
      series({
        exceptions: [{ originalStart: third, overrideStart: plusHours(third, 2), overrideDurationMin: 60, cancelled: false }],
      }),
    );
    const res = await updateRoomBookingAsMember("b1", "u1", {
      start: plusHours(third, 1),
      end: plusHours(third, 2),
      scope: "all",
      occurrenceStart: third,
    });
    expect(res).toMatchObject({ ok: true });
    expect(m.roomBooking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ start: plusHours(anchor, 1) }) }),
    );
    expect(m.roomBookingException.createMany).not.toHaveBeenCalled();
  });

  it("409s on a collision at any later date, naming the day", async () => {
    m.roomBooking.findUnique.mockResolvedValue(series());
    const eighth = new Date(anchor.getTime() + 7 * DAY);
    m.roomBooking.findMany.mockResolvedValue([other(plusHours(eighth, 1), plusHours(eighth, 2))]);
    const res = await updateRoomBookingAsMember("b1", "u1", {
      start: plusHours(third, 1),
      end: plusHours(third, 2),
      scope: "all",
      occurrenceStart: third,
    });
    expect(res).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('on ') });
    expect(m.roomBooking.update).not.toHaveBeenCalled();
  });

  it("ignores collisions on dates already past", async () => {
    const pastAnchor = inDays(-3);
    const today = new Date(pastAnchor.getTime() + 5 * DAY);
    m.roomBooking.findUnique.mockResolvedValue(
      row({ start: pastAnchor, end: plusHours(pastAnchor, 1), recurrenceRule: "FREQ=DAILY;COUNT=10" }),
    );
    const yesterdayIsh = new Date(pastAnchor.getTime() + DAY);
    m.roomBooking.findMany.mockResolvedValue([other(plusHours(yesterdayIsh, 1), plusHours(yesterdayIsh, 2))]);
    const res = await updateRoomBookingAsMember("b1", "u1", {
      start: plusHours(today, 1),
      end: plusHours(today, 2),
      scope: "all",
      occurrenceStart: today,
    });
    expect(res).toMatchObject({ ok: true });
  });

  it("can't move to another day, which would fight the repeat rule", async () => {
    m.roomBooking.findUnique.mockResolvedValue(series());
    const res = await updateRoomBookingAsMember("b1", "u1", {
      start: plusHours(third, 24),
      end: plusHours(third, 25),
      scope: "all",
      occurrenceStart: third,
    });
    expect(res).toMatchObject({ ok: false, status: 400, error: expect.stringContaining("day") });
  });

  it("waits out an underway date for a room or time change, but not a title", async () => {
    const start = plusHours(new Date(), -0.5);
    start.setMilliseconds(0);
    const b = row({ start, end: plusHours(start, 1), recurrenceRule: "FREQ=DAILY;COUNT=5" });
    m.roomBooking.findUnique.mockResolvedValue(b);
    const tomorrow = new Date(start.getTime() + DAY);
    const edit = { start: tomorrow, end: plusHours(tomorrow, 1), scope: "all" as const, occurrenceStart: tomorrow };
    await expect(updateRoomBookingAsMember("b1", "u1", { ...edit, roomId: "r2" })).resolves.toMatchObject({
      ok: false,
      status: 409,
      error: expect.stringContaining("underway"),
    });
    await expect(updateRoomBookingAsMember("b1", "u1", { ...edit, title: "Renamed" })).resolves.toMatchObject({ ok: true });
  });
});

describe("cancelRoomBookingAsMember on a calendar event's hold", () => {
  const hold = { userId: "u1", source: "Web", sourceEventId: "evt1" };

  it("sends the booker to the calendar so the event doesn't go out of step", async () => {
    m.roomBooking.findUnique.mockResolvedValue(hold);
    await expect(cancelRoomBookingAsMember("b1", "u1")).resolves.toMatchObject({
      ok: false,
      status: 409,
      error: expect.stringContaining("calendar"),
    });
    expect(m.roomBooking.update).not.toHaveBeenCalled();
  });

  it("lets Core free the room", async () => {
    mockCore.mockResolvedValue(true);
    m.roomBooking.findUnique.mockResolvedValueOnce(hold).mockResolvedValueOnce(row({ sourceEventId: "evt1" }));
    await expect(cancelRoomBookingAsMember("b1", "core-1")).resolves.toEqual({ ok: true, value: null });
    expect(m.roomBooking.update).toHaveBeenCalled();
  });
});
