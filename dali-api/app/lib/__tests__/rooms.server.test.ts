import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => {
  const prisma = {
    room: { findUnique: vi.fn(), findMany: vi.fn() },
    roomBooking: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn() },
    roomBookingException: { upsert: vi.fn(), deleteMany: vi.fn() },
    scheduledMeeting: { findMany: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
  return { prisma };
});
vi.mock("~/lib/scheduled-meeting", () => ({ CHECK_IN_GRACE_MIN: 15 }));
vi.mock("~/lib/roles", () => ({ currentTerm: vi.fn() }));

import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import {
  assertMeetingRoomsFree,
  bookRoomsForEvent,
  cancelRoomBooking,
  claimEventRoomBookings,
  createRoomBooking,
  currentEvent,
  getRoomSchedule,
  releaseEventRoomBookings,
  retimeEventRoomBookings,
  truncateEventRoomBookings,
  listRoomConflicts,
  serializeScheduleItem,
  type RoomScheduleItem,
} from "~/lib/rooms.server";

const m = prisma as unknown as {
  room: { findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  roomBooking: {
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  roomBookingException: { upsert: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
  scheduledMeeting: { findMany: ReturnType<typeof vi.fn> };
};
const mockTerm = currentTerm as unknown as ReturnType<typeof vi.fn>;

const ada = { id: "u1", firstName: "Ada", lastName: "Lovelace", photoUrl: null };
const H = 60 * 60_000;
const DAY = 24 * H;
const at = (iso: string) => new Date(iso);
// buildRule's RRULE anchor drops milliseconds, so an occurrence resolved by
// exact originalStart match needs a whole-second "now" to compare against.
const nowSec = () => new Date(Math.floor(Date.now() / 1000) * 1000);

function meeting(over: Record<string, unknown> = {}) {
  return {
    id: "m1",
    title: "Standup",
    selectedAt: at("2026-09-21T14:00:00Z"),
    durationMinutes: 30,
    recurrenceRule: null,
    attendanceMode: "Roster",
    organizer: ada,
    exceptions: [],
    ...over,
  };
}

function booking(over: Record<string, unknown> = {}) {
  return {
    id: "b1",
    title: null,
    start: at("2026-09-21T14:00:00Z"),
    end: at("2026-09-21T15:00:00Z"),
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
  m.room.findUnique.mockResolvedValue({ archivedAt: null });
  m.room.findMany.mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.map((id) => ({ id, name: id === "r2" ? "Lounge" : "Studio", archivedAt: null })),
  );
  m.roomBooking.create.mockImplementation(({ data }: { data: { start: Date; end: Date; recurrenceRule?: string | null } }) => ({
    id: "b-new",
    start: data.start,
    end: data.end,
  }));
  m.roomBookingException.upsert.mockResolvedValue({});
  m.roomBookingException.deleteMany.mockResolvedValue({ count: 0 });
  // No Term rows by default: resolveBookingSeries falls back to the 180-day cap.
  mockTerm.mockResolvedValue(null);
});

describe("getRoomSchedule", () => {
  it("merges bookings and meeting occurrences, sorted by start", async () => {
    m.roomBooking.findMany.mockResolvedValue([
      { id: "b1", title: null, start: at("2026-09-24T16:00:00Z"), end: at("2026-09-24T17:00:00Z"), user: ada },
    ]);
    m.scheduledMeeting.findMany.mockResolvedValue([
      meeting({ selectedAt: at("2026-09-24T14:00:00Z"), attendanceMode: "SelfCheckIn", title: "Lab night" }),
    ]);
    const items = await getRoomSchedule("r1", at("2026-09-24T04:00:00Z"), at("2026-09-25T04:00:00Z"));
    expect(items.map((i) => [i.kind, i.title, i.isEvent])).toEqual([
      ["meeting", "Lab night", true],
      ["booking", "Ada's booking", false],
    ]);
  });

  it("expands a recurring meeting to the occurrence in the window", async () => {
    m.scheduledMeeting.findMany.mockResolvedValue([
      meeting({ recurrenceRule: "FREQ=DAILY" }), // first sitting Sep 21
    ]);
    const items = await getRoomSchedule("r1", at("2026-09-24T04:00:00Z"), at("2026-09-25T04:00:00Z"));
    expect(items).toHaveLength(1);
    expect(items[0]!.start.toISOString()).toBe("2026-09-24T14:00:00.000Z");
  });

  it("drops a cancelled occurrence and only queries live bookings", async () => {
    m.scheduledMeeting.findMany.mockResolvedValue([
      meeting({
        recurrenceRule: "FREQ=DAILY",
        exceptions: [
          { originalStart: at("2026-09-24T14:00:00Z"), overrideStart: null, overrideDurationMin: null, cancelled: true },
        ],
      }),
    ]);
    const items = await getRoomSchedule("r1", at("2026-09-24T04:00:00Z"), at("2026-09-25T04:00:00Z"));
    expect(items).toEqual([]);
    expect(m.roomBooking.findMany.mock.calls[0]![0].where.cancelledAt).toBeNull();
    expect(m.scheduledMeeting.findMany.mock.calls[0]![0].where.status).toBe("Confirmed");
  });

  it("expands a weekly booking into per-week items with occurrenceStart and recurring", async () => {
    m.roomBooking.findMany.mockResolvedValue([booking({ recurrenceRule: "FREQ=WEEKLY;COUNT=4" })]); // first sitting Sep 21
    const items = await getRoomSchedule("r1", at("2026-09-28T00:00:00Z"), at("2026-10-12T00:00:00Z"));
    expect(items.map((i) => [i.start.toISOString(), i.occurrenceStart.toISOString(), i.recurring])).toEqual([
      ["2026-09-28T14:00:00.000Z", "2026-09-28T14:00:00.000Z", true],
      ["2026-10-05T14:00:00.000Z", "2026-10-05T14:00:00.000Z", true],
    ]);
  });

  it("drops a cancelled occurrence of a recurring booking", async () => {
    m.roomBooking.findMany.mockResolvedValue([
      booking({
        recurrenceRule: "FREQ=WEEKLY;COUNT=4",
        exceptions: [
          { originalStart: at("2026-09-28T14:00:00Z"), overrideStart: null, overrideDurationMin: null, cancelled: true },
        ],
      }),
    ]);
    const items = await getRoomSchedule("r1", at("2026-09-28T00:00:00Z"), at("2026-10-06T00:00:00Z"));
    expect(items).toHaveLength(1);
    expect(items[0]!.start.toISOString()).toBe("2026-10-05T14:00:00.000Z");
  });

  it("retimes an overridden occurrence of a recurring booking", async () => {
    m.roomBooking.findMany.mockResolvedValue([
      booking({
        recurrenceRule: "FREQ=WEEKLY;COUNT=4",
        exceptions: [
          {
            originalStart: at("2026-09-28T14:00:00Z"),
            overrideStart: at("2026-09-28T16:00:00Z"),
            overrideDurationMin: 30,
            cancelled: false,
          },
        ],
      }),
    ]);
    const items = await getRoomSchedule("r1", at("2026-09-28T00:00:00Z"), at("2026-10-06T00:00:00Z"));
    const moved = items.find((i) => i.occurrenceStart.toISOString() === "2026-09-28T14:00:00.000Z");
    expect(moved?.start.toISOString()).toBe("2026-09-28T16:00:00.000Z");
    expect(moved?.end.toISOString()).toBe("2026-09-28T16:30:00.000Z");
  });
});

describe("currentEvent", () => {
  const event: RoomScheduleItem = {
    kind: "meeting",
    id: "m1",
    title: "Lab night",
    start: at("2026-09-24T18:00:00Z"),
    end: at("2026-09-24T19:00:00Z"),
    occurrenceStart: at("2026-09-24T18:00:00Z"),
    recurring: false,
    organizer: ada,
    isEvent: true,
    source: null,
    cycleId: null,
  };
  it("opens 15 minutes early and closes 15 minutes late", () => {
    expect(currentEvent([event], at("2026-09-24T17:46:00Z").getTime())).toBe(event);
    expect(currentEvent([event], at("2026-09-24T19:14:00Z").getTime())).toBe(event);
    expect(currentEvent([event], at("2026-09-24T17:40:00Z").getTime())).toBeNull();
    expect(currentEvent([event], at("2026-09-24T19:20:00Z").getTime())).toBeNull();
  });
  it("ignores non-event meetings", () => {
    expect(currentEvent([{ ...event, isEvent: false }], at("2026-09-24T18:30:00Z").getTime())).toBeNull();
  });
});

describe("createRoomBooking", () => {
  const base = () => {
    const start = new Date(Date.now() + H);
    return { roomId: "r1", userId: "u1", start, end: new Date(start.getTime() + H), source: "Web" as const };
  };

  it("books a free slot", async () => {
    const res = await createRoomBooking(base());
    expect(res.ok).toBe(true);
    expect(m.roomBooking.create).toHaveBeenCalled();
  });

  it("rejects end at or before start", async () => {
    const b = base();
    expect(await createRoomBooking({ ...b, end: b.start })).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects bookings over 8 hours", async () => {
    const b = base();
    const res = await createRoomBooking({ ...b, end: new Date(b.start.getTime() + 9 * H) });
    expect(res).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects a start in the past", async () => {
    const start = new Date(Date.now() - 2 * H);
    const res = await createRoomBooking({ ...base(), start, end: new Date(start.getTime() + H) });
    expect(res).toMatchObject({ ok: false, status: 400 });
  });

  it("409s on a conflict", async () => {
    const b = base();
    m.roomBooking.findMany.mockResolvedValue([
      { id: "b1", title: "Design crit", start: b.start, end: b.end, user: ada },
    ]);
    const res = await createRoomBooking(b);
    expect(res).toMatchObject({ ok: false, status: 409 });
    expect(m.roomBooking.create).not.toHaveBeenCalled();
  });

  it("404s an archived room", async () => {
    m.room.findUnique.mockResolvedValue({ archivedAt: new Date() });
    expect(await createRoomBooking(base())).toMatchObject({ ok: false, status: 404 });
  });

  it("rejects a repeat rule with no COUNT or UNTIL", async () => {
    const res = await createRoomBooking({ ...base(), recurrenceRule: "FREQ=WEEKLY" });
    expect(res).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects a series that runs past the end of the current term", async () => {
    const b = base();
    mockTerm.mockResolvedValue({ code: "26F", endDate: new Date(b.start.getTime() + 14 * DAY) } as never);
    const res = await createRoomBooking({ ...b, recurrenceRule: "FREQ=WEEKLY;COUNT=4" });
    expect(res).toMatchObject({ ok: false, status: 400 });
    expect(res.ok === false && res.error).toContain("26F");
  });

  it("stores recurrenceRule for a valid 4-week series and rejects a week-3 collision", async () => {
    m.room.findUnique.mockResolvedValue({ archivedAt: null, name: "Studio" });
    const b = { ...base(), recurrenceRule: "FREQ=WEEKLY;COUNT=4" };

    const ok = await createRoomBooking(b);
    expect(ok).toMatchObject({ ok: true });
    expect(m.roomBooking.create.mock.calls[0]![0].data.recurrenceRule).toBe("FREQ=WEEKLY;COUNT=4");
    // buildRule drops milliseconds from the anchor, so compare to the second.
    const seriesEnd = m.roomBooking.create.mock.calls[0]![0].data.seriesEnd as Date;
    expect(Math.abs(seriesEnd.getTime() - (b.end.getTime() + 21 * DAY))).toBeLessThan(1000);

    // A single booking that only overlaps the third week's occurrence.
    const week3Start = new Date(b.start.getTime() + 14 * DAY);
    m.roomBooking.findMany.mockResolvedValue([
      {
        id: "conflict",
        title: "Design crit",
        start: week3Start,
        end: new Date(week3Start.getTime() + H),
        recurrenceRule: null,
        exceptions: [],
        user: ada,
      },
    ]);
    const res = await createRoomBooking(b);
    expect(res).toMatchObject({ ok: false, status: 409 });
    expect(res.ok === false && res.error).toContain("Studio");
  });
});

describe("hiring bookings (Interview / InterviewHold)", () => {
  const cycle = "cyc1";
  const hold = () =>
    booking({
      id: "hold",
      title: "Reserved for interviews",
      start: at("2026-11-02T13:00:00Z"),
      end: at("2026-11-02T22:00:00Z"),
      source: "InterviewHold",
      applicationCycleId: cycle,
    });

  it("skips the human duration and lead caps for hiring sources", async () => {
    const start = new Date(Date.now() + 120 * DAY);
    const res = await createRoomBooking({
      roomId: "r1",
      userId: "u1",
      start,
      end: new Date(start.getTime() + 9 * H),
      source: "InterviewHold",
      applicationCycleId: cycle,
    });
    expect(res.ok).toBe(true);
    expect(m.roomBooking.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ source: "InterviewHold", applicationCycleId: cycle }) }),
    );
  });

  it("blocks a member booking inside a cycle's hold, naming the hold", async () => {
    m.roomBooking.findMany.mockResolvedValue([hold()]);
    const res = await createRoomBooking({
      roomId: "r1",
      userId: "u2",
      start: at("2026-11-02T15:00:00Z"),
      end: at("2026-11-02T16:00:00Z"),
      source: "Web",
    });
    expect(res).toMatchObject({ ok: false, status: 409 });
    expect((res as { error: string }).error).toContain("Reserved for interviews");
  });

  it("lets the same cycle's interview sit inside its hold but not another cycle's", async () => {
    m.roomBooking.findMany.mockResolvedValue([hold()]);
    const slot = {
      roomId: "r1",
      userId: "u1",
      start: at("2026-11-02T15:00:00Z"),
      end: at("2026-11-02T15:30:00Z"),
      source: "Interview" as const,
    };
    expect((await createRoomBooking({ ...slot, applicationCycleId: cycle })).ok).toBe(true);
    expect(await createRoomBooking({ ...slot, applicationCycleId: "other" })).toMatchObject({ ok: false, status: 409 });
  });

  it("blocks a meeting's room claim during a hold", async () => {
    m.roomBooking.findMany.mockResolvedValue([hold()]);
    const res = await assertMeetingRoomsFree({
      roomIds: ["r1"],
      selectedAt: at("2026-11-02T15:00:00Z"),
      durationMinutes: 30,
      recurrenceRule: null,
    });
    expect(res).toMatchObject({ ok: false, status: 409 });
  });

  it("books through the caller's transaction when one is passed", async () => {
    const tx = { ...m, roomBooking: { ...m.roomBooking } };
    const start = new Date(Date.now() + H);
    await createRoomBooking(
      { roomId: "r1", userId: "u1", start, end: new Date(start.getTime() + H), source: "Interview", applicationCycleId: cycle },
      tx as never,
    );
    expect(m.$transaction).not.toHaveBeenCalled();
    expect(m.roomBooking.create).toHaveBeenCalled();
  });

  it("listRoomConflicts returns each blocking item once across the occurrences", async () => {
    m.roomBooking.findMany.mockResolvedValue([
      booking({ id: "b1", title: "Ada", start: at("2026-11-02T15:00:00Z"), end: at("2026-11-02T16:00:00Z") }),
      booking({ id: "mine", start: at("2026-11-02T17:00:00Z"), end: at("2026-11-02T17:30:00Z"), source: "Interview", applicationCycleId: cycle }),
    ]);
    const items = await listRoomConflicts(
      "r1",
      [
        { start: at("2026-11-02T13:00:00Z"), end: at("2026-11-02T22:00:00Z") },
        { start: at("2026-11-03T13:00:00Z"), end: at("2026-11-03T22:00:00Z") },
      ],
      { source: "InterviewHold", applicationCycleId: cycle },
    );
    expect(items.map((i) => i.id)).toEqual(["b1"]);
  });

  it("serializes the source so clients can tell hiring bookings apart", () => {
    const [item] = [hold()].map((b) => ({
      kind: "booking" as const,
      id: b.id,
      title: b.title!,
      start: b.start,
      end: b.end,
      occurrenceStart: b.start,
      recurring: false,
      organizer: ada,
      isEvent: false,
      source: "InterviewHold" as const,
      cycleId: cycle,
    }));
    expect(serializeScheduleItem(item)).toMatchObject({ source: "InterviewHold" });
  });
});

describe("cancelRoomBooking", () => {
  it("ends an underway booking now instead of cancelling it", async () => {
    m.roomBooking.findUnique.mockResolvedValue({
      id: "b1",
      cancelledAt: null,
      start: new Date(Date.now() - H),
      end: new Date(Date.now() + H),
    });
    await cancelRoomBooking("b1", "u1");
    expect(m.roomBooking.update.mock.calls[0]![0].data).toHaveProperty("end");
  });

  it("soft-cancels a future booking", async () => {
    m.roomBooking.findUnique.mockResolvedValue({
      id: "b1",
      cancelledAt: null,
      start: new Date(Date.now() + H),
      end: new Date(Date.now() + 2 * H),
    });
    await cancelRoomBooking("b1", "u1");
    expect(m.roomBooking.update.mock.calls[0]![0].data).toMatchObject({ cancelledByUserId: "u1" });
  });

  it("defaults a series cancel (scope all) to soft-cancelling the whole series", async () => {
    m.roomBooking.findUnique.mockResolvedValue({
      id: "b1",
      cancelledAt: null,
      recurrenceRule: "FREQ=WEEKLY;COUNT=4",
      start: new Date(Date.now() + H),
      end: new Date(Date.now() + 2 * H),
      exceptions: [],
    });
    await cancelRoomBooking("b1", "u1");
    expect(m.roomBooking.update.mock.calls[0]![0].data).toMatchObject({ cancelledByUserId: "u1" });
    expect(m.roomBookingException.upsert).not.toHaveBeenCalled();
  });

  it("cancels a series outright even while its first occurrence is underway", async () => {
    // Ending the row "now" would shorten every occurrence, since the series
    // takes its duration from start/end.
    m.roomBooking.findUnique.mockResolvedValue({
      id: "b1",
      cancelledAt: null,
      recurrenceRule: "FREQ=WEEKLY;COUNT=4",
      start: new Date(Date.now() - H),
      end: new Date(Date.now() + H),
      exceptions: [],
    });
    await cancelRoomBooking("b1", "u1", { scope: "all" });
    const data = m.roomBooking.update.mock.calls[0]![0].data;
    expect(data).toMatchObject({ cancelledByUserId: "u1" });
    expect(data).not.toHaveProperty("end");
  });

  it("scope this requires occurrenceStart", async () => {
    m.roomBooking.findUnique.mockResolvedValue({
      id: "b1",
      cancelledAt: null,
      recurrenceRule: "FREQ=WEEKLY;COUNT=4",
      start: new Date(Date.now() + H),
      end: new Date(Date.now() + 2 * H),
      exceptions: [],
    });
    const res = await cancelRoomBooking("b1", "u1", { scope: "this" });
    expect(res).toMatchObject({ ok: false, status: 400 });
  });

  it("scope this cancels a future occurrence via an exception, leaving the row alone", async () => {
    const seriesStart = new Date(nowSec().getTime() + H);
    const occurrenceStart = new Date(seriesStart.getTime() + 7 * DAY);
    m.roomBooking.findUnique.mockResolvedValue({
      id: "b1",
      cancelledAt: null,
      recurrenceRule: "FREQ=WEEKLY;COUNT=4",
      start: seriesStart,
      end: new Date(seriesStart.getTime() + H),
      exceptions: [],
    });
    const res = await cancelRoomBooking("b1", "u1", { scope: "this", occurrenceStart });
    expect(res).toEqual({ ok: true, value: null });
    expect(m.roomBooking.update).not.toHaveBeenCalled();
    expect(m.roomBookingException.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { roomBookingId_originalStart: { roomBookingId: "b1", originalStart: occurrenceStart } },
        update: { cancelled: true },
      }),
    );
  });

  it("scope this ends an underway occurrence now via an override exception", async () => {
    const occurrenceStart = new Date(nowSec().getTime() - 30 * 60_000);
    m.roomBooking.findUnique.mockResolvedValue({
      id: "b1",
      cancelledAt: null,
      recurrenceRule: "FREQ=DAILY;COUNT=5",
      start: occurrenceStart,
      end: new Date(occurrenceStart.getTime() + H),
      exceptions: [],
    });
    const res = await cancelRoomBooking("b1", "u1", { scope: "this", occurrenceStart });
    expect(res).toEqual({ ok: true, value: null });
    expect(m.roomBooking.update).not.toHaveBeenCalled();
    const call = m.roomBookingException.upsert.mock.calls[0]![0];
    expect(call.where).toEqual({ roomBookingId_originalStart: { roomBookingId: "b1", originalStart: occurrenceStart } });
    expect(call.update.cancelled).toBe(false);
    expect(call.update.overrideStart).toEqual(occurrenceStart);
    expect(call.update.overrideDurationMin).toBeGreaterThanOrEqual(29);
    expect(call.update.overrideDurationMin).toBeLessThanOrEqual(31);
  });

  it("scope following truncates the series and deletes later exceptions", async () => {
    const seriesStart = new Date(Date.now() + H);
    const occurrenceStart = new Date(seriesStart.getTime() + 2 * DAY);
    m.roomBooking.findUnique.mockResolvedValue({
      id: "b1",
      cancelledAt: null,
      recurrenceRule: "FREQ=DAILY;COUNT=10",
      start: seriesStart,
      end: new Date(seriesStart.getTime() + H),
      exceptions: [],
    });
    const res = await cancelRoomBooking("b1", "u1", { scope: "following", occurrenceStart });
    expect(res).toEqual({ ok: true, value: null });
    expect(m.roomBooking.update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { recurrenceRule: expect.stringContaining("UNTIL="), seriesEnd: expect.any(Date) },
    });
    expect(m.roomBookingException.deleteMany).toHaveBeenCalledWith({
      where: { roomBookingId: "b1", originalStart: { gte: occurrenceStart } },
    });
  });

  it("scope following on the first occurrence soft-cancels the whole series", async () => {
    const seriesStart = new Date(Date.now() + H);
    m.roomBooking.findUnique.mockResolvedValue({
      id: "b1",
      cancelledAt: null,
      recurrenceRule: "FREQ=DAILY;COUNT=10",
      start: seriesStart,
      end: new Date(seriesStart.getTime() + H),
      exceptions: [],
    });
    const res = await cancelRoomBooking("b1", "u1", { scope: "following", occurrenceStart: seriesStart });
    expect(res).toEqual({ ok: true, value: null });
    expect(m.roomBooking.update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { cancelledByUserId: "u1", cancelledAt: expect.any(Date) },
    });
    expect(m.roomBookingException.deleteMany).not.toHaveBeenCalled();
  });
});

describe("assertMeetingRoomsFree", () => {
  it("409s when a meeting occurrence collides with a booking, naming the room", async () => {
    const start = new Date(Date.now() + 24 * H);
    m.roomBooking.findMany.mockImplementation(({ where }: { where: { roomId: string } }) =>
      where.roomId === "r2" ? [{ id: "b1", title: null, start, end: new Date(start.getTime() + H), user: ada }] : [],
    );
    const res = await assertMeetingRoomsFree({
      roomIds: ["r1", "r2"],
      selectedAt: new Date(start.getTime() + 30 * 60_000),
      durationMinutes: 60,
      recurrenceRule: null,
    });
    expect(res).toMatchObject({ ok: false, status: 409 });
    expect(res.ok === false && res.error).toContain("Lounge");
  });

  it("passes when every room is free and excludes the meeting itself", async () => {
    const res = await assertMeetingRoomsFree({
      roomIds: ["r1", "r2"],
      meetingId: "m1",
      selectedAt: new Date(Date.now() + 24 * H),
      durationMinutes: 60,
      recurrenceRule: "FREQ=WEEKLY",
    });
    expect(res.ok).toBe(true);
    expect(m.scheduledMeeting.findMany).toHaveBeenCalledTimes(2);
    expect(m.scheduledMeeting.findMany.mock.calls[0]![0].where.id).toEqual({ not: "m1" });
    expect(m.scheduledMeeting.findMany.mock.calls[1]![0].where.rooms).toEqual({ some: { id: "r2" } });
  });

  it("404s a newly added archived room but tolerates one already on the meeting", async () => {
    m.room.findMany.mockResolvedValue([{ id: "r1", name: "Studio", archivedAt: new Date() }]);
    const base = { selectedAt: new Date(Date.now() + 24 * H), durationMinutes: 60, recurrenceRule: null };
    expect(await assertMeetingRoomsFree({ ...base, roomIds: ["r1"] })).toMatchObject({ ok: false, status: 404 });
    expect((await assertMeetingRoomsFree({ ...base, roomIds: ["r1"], newRoomIds: [] })).ok).toBe(true);
  });
});

describe("bookRoomsForEvent", () => {
  const base = () => {
    const start = new Date(Date.now() + H);
    return { userId: "u1", start, end: new Date(start.getTime() + H), title: "Demo night" };
  };

  it("books every room", async () => {
    const res = await bookRoomsForEvent({ ...base(), roomIds: ["r1", "r2"] });
    expect(res).toMatchObject({ ok: true, value: ["b-new", "b-new"] });
    expect(m.roomBooking.create).toHaveBeenCalledTimes(2);
    expect(m.roomBooking.deleteMany).not.toHaveBeenCalled();
  });

  it("releases the rooms already held when a later one is taken", async () => {
    const b = base();
    m.roomBooking.findMany.mockImplementation(({ where }: { where: { roomId: string } }) =>
      where.roomId === "r2" ? [{ id: "b1", title: "Design crit", start: b.start, end: b.end, user: ada }] : [],
    );
    const res = await bookRoomsForEvent({ ...b, roomIds: ["r1", "r2"] });
    expect(res).toMatchObject({ ok: false, status: 409 });
    expect(m.roomBooking.create).toHaveBeenCalledTimes(1);
    expect(m.roomBooking.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["b-new"] } } });
  });
});

describe("event room holds", () => {
  const start = at("2026-09-21T15:00:00Z");
  const end = at("2026-09-21T16:00:00Z");
  const holds = [
    { id: "b1", roomId: "r1", room: { name: "Studio" } },
    { id: "b2", roomId: "r2", room: { name: "Lounge" } },
  ];

  it("claims the holds for the event once it exists", async () => {
    await claimEventRoomBookings(["b1", "b2"], "evt1");
    expect(m.roomBooking.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["b1", "b2"] } },
      data: { sourceEventId: "evt1" },
    });
  });

  it("cancels the event's live holds when the event is deleted", async () => {
    m.roomBooking.findMany.mockResolvedValueOnce([
      { id: "b1", start: new Date(Date.now() + H), end: new Date(Date.now() + 2 * H), recurrenceRule: null, exceptions: [] },
      { id: "b2", start: new Date(Date.now() + H), end: new Date(Date.now() + 2 * H), recurrenceRule: null, exceptions: [] },
    ]);
    const res = await releaseEventRoomBookings("u1", "evt1");
    expect(res).toEqual({ ok: true, value: null });
    expect(m.roomBooking.findMany).toHaveBeenCalledWith({
      where: { userId: "u1", sourceEventId: "evt1", cancelledAt: null },
      include: { exceptions: expect.anything() },
    });
    expect(m.roomBooking.update).toHaveBeenCalledTimes(2);
    expect(m.roomBooking.update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { cancelledByUserId: "u1", cancelledAt: expect.any(Date) },
    });
  });

  it("moves every hold with the event when the new slot is free", async () => {
    // First call lists the event's holds; the schedule checks that follow find nothing.
    m.roomBooking.findMany.mockResolvedValueOnce(holds).mockResolvedValue([]);
    const res = await retimeEventRoomBookings({ userId: "u1", sourceEventId: "evt1", start, end });
    expect(res).toEqual({ ok: true, value: 2 });
    expect(m.roomBooking.update).toHaveBeenCalledTimes(2);
    expect(m.roomBooking.update).toHaveBeenCalledWith({ where: { id: "b1" }, data: { start, end } });
    // The hold being moved is excluded from its own conflict check.
    expect(m.roomBooking.findMany.mock.calls[1][0].where.id).toEqual({ not: "b1" });
  });

  it("409s naming the room when the new slot is taken, and moves nothing", async () => {
    m.roomBooking.findMany
      .mockResolvedValueOnce(holds)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "b9", title: "Design crit", start, end, user: ada }]);
    const res = await retimeEventRoomBookings({ userId: "u1", sourceEventId: "evt1", start, end });
    expect(res).toMatchObject({ ok: false, status: 409, error: expect.stringContaining("Lounge") });
    expect(m.roomBooking.update).not.toHaveBeenCalled();
  });

  it("rejects an end at or before the start", async () => {
    const res = await retimeEventRoomBookings({ userId: "u1", sourceEventId: "evt1", start: end, end: start });
    expect(res).toMatchObject({ ok: false, status: 400 });
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("scope all re-anchors a series hold and re-checks every occurrence", async () => {
    const newStart = new Date(Date.now() + H);
    const newEnd = new Date(newStart.getTime() + H);
    const seriesHold = { id: "b1", roomId: "r1", recurrenceRule: "FREQ=WEEKLY;COUNT=3", room: { name: "Studio" } };
    m.roomBooking.findMany.mockResolvedValueOnce([seriesHold]).mockResolvedValue([]);
    const res = await retimeEventRoomBookings({ userId: "u1", sourceEventId: "evt1", start: newStart, end: newEnd });
    expect(res).toEqual({ ok: true, value: 1 });
    expect(m.roomBooking.update).toHaveBeenCalledWith({ where: { id: "b1" }, data: { start: newStart, end: newEnd, seriesEnd: expect.any(Date) } });
  });

  it("scope all 409s naming the room when a later occurrence of the retimed series collides", async () => {
    const newStart = new Date(Date.now() + H);
    const newEnd = new Date(newStart.getTime() + H);
    const week2Start = new Date(newStart.getTime() + 7 * DAY);
    const seriesHold = { id: "b1", roomId: "r1", recurrenceRule: "FREQ=WEEKLY;COUNT=3", room: { name: "Studio" } };
    m.roomBooking.findMany
      .mockResolvedValueOnce([seriesHold])
      .mockResolvedValueOnce([
        { id: "conflict", title: "Design crit", start: week2Start, end: new Date(week2Start.getTime() + H), user: ada },
      ]);
    const res = await retimeEventRoomBookings({ userId: "u1", sourceEventId: "evt1", start: newStart, end: newEnd });
    expect(res).toMatchObject({ ok: false, status: 409, error: expect.stringContaining("Studio") });
    expect(m.roomBooking.update).not.toHaveBeenCalled();
  });

  it("scope this writes an override exception for a series hold instead of moving the row", async () => {
    const occurrenceStart = new Date(Date.now() + 7 * DAY);
    const newStart = new Date(Date.now() + 2 * H);
    const newEnd = new Date(newStart.getTime() + H);
    const seriesHold = { id: "b1", roomId: "r1", recurrenceRule: "FREQ=WEEKLY;COUNT=3", room: { name: "Studio" } };
    m.roomBooking.findMany.mockResolvedValueOnce([seriesHold]).mockResolvedValue([]);
    const res = await retimeEventRoomBookings({
      userId: "u1",
      sourceEventId: "evt1",
      start: newStart,
      end: newEnd,
      scope: "this",
      occurrenceStart,
    });
    expect(res).toEqual({ ok: true, value: 1 });
    expect(m.roomBooking.update).not.toHaveBeenCalled();
    expect(m.roomBookingException.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { roomBookingId_originalStart: { roomBookingId: "b1", originalStart: occurrenceStart } },
        update: { overrideStart: newStart, overrideDurationMin: 60, cancelled: false },
      }),
    );
  });
});

describe("truncateEventRoomBookings", () => {
  it("truncates a live hold's series to end just before the split point", async () => {
    const seriesStart = new Date(Date.now() + H);
    const before = new Date(seriesStart.getTime() + 2 * DAY);
    m.roomBooking.findMany.mockResolvedValue([
      {
        id: "b1",
        start: seriesStart,
        end: new Date(seriesStart.getTime() + H),
        recurrenceRule: "FREQ=DAILY;COUNT=10",
        exceptions: [],
      },
    ]);
    const res = await truncateEventRoomBookings("u1", "evt1", before);
    expect(res).toEqual({ ok: true, value: null });
    expect(m.roomBooking.update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { recurrenceRule: expect.stringContaining("UNTIL="), seriesEnd: expect.any(Date) },
    });
    expect(m.roomBookingException.deleteMany).toHaveBeenCalledWith({
      where: { roomBookingId: "b1", originalStart: { gte: before } },
    });
  });

  it("soft-cancels a hold outright when the split point is its first occurrence", async () => {
    const seriesStart = new Date(Date.now() + H);
    m.roomBooking.findMany.mockResolvedValue([
      {
        id: "b1",
        start: seriesStart,
        end: new Date(seriesStart.getTime() + H),
        recurrenceRule: "FREQ=DAILY;COUNT=10",
        exceptions: [],
      },
    ]);
    const res = await truncateEventRoomBookings("u1", "evt1", seriesStart);
    expect(res).toEqual({ ok: true, value: null });
    expect(m.roomBooking.update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { cancelledByUserId: "u1", cancelledAt: expect.any(Date) },
    });
  });
});
