import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => {
  const prisma = {
    room: { findUnique: vi.fn() },
    roomBooking: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    scheduledMeeting: { findMany: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
  return { prisma };
});
vi.mock("~/lib/scheduled-meeting", () => ({ CHECK_IN_GRACE_MIN: 15 }));

import { prisma } from "~/lib/db";
import {
  assertMeetingRoomFree,
  cancelRoomBooking,
  createRoomBooking,
  currentEvent,
  getRoomSchedule,
  type RoomScheduleItem,
} from "~/lib/rooms.server";

const m = prisma as unknown as {
  room: { findUnique: ReturnType<typeof vi.fn> };
  roomBooking: {
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  scheduledMeeting: { findMany: ReturnType<typeof vi.fn> };
};

const ada = { id: "u1", firstName: "Ada", lastName: "Lovelace" };
const H = 60 * 60_000;
const at = (iso: string) => new Date(iso);

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

beforeEach(() => {
  vi.clearAllMocks();
  m.roomBooking.findMany.mockResolvedValue([]);
  m.scheduledMeeting.findMany.mockResolvedValue([]);
  m.room.findUnique.mockResolvedValue({ archivedAt: null });
  m.roomBooking.create.mockImplementation(({ data }: { data: { start: Date; end: Date } }) => ({
    id: "b-new",
    start: data.start,
    end: data.end,
  }));
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
});

describe("currentEvent", () => {
  const event: RoomScheduleItem = {
    kind: "meeting",
    id: "m1",
    title: "Lab night",
    start: at("2026-09-24T18:00:00Z"),
    end: at("2026-09-24T19:00:00Z"),
    organizer: ada,
    isEvent: true,
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
});

describe("assertMeetingRoomFree", () => {
  it("409s when a meeting occurrence collides with a booking", async () => {
    const start = new Date(Date.now() + 24 * H);
    m.roomBooking.findMany.mockResolvedValue([
      { id: "b1", title: null, start, end: new Date(start.getTime() + H), user: ada },
    ]);
    const res = await assertMeetingRoomFree({
      roomId: "r1",
      selectedAt: new Date(start.getTime() + 30 * 60_000),
      durationMinutes: 60,
      recurrenceRule: null,
    });
    expect(res).toMatchObject({ ok: false, status: 409 });
  });

  it("passes when the room is free and excludes the meeting itself", async () => {
    const res = await assertMeetingRoomFree({
      roomId: "r1",
      meetingId: "m1",
      selectedAt: new Date(Date.now() + 24 * H),
      durationMinutes: 60,
      recurrenceRule: "FREQ=WEEKLY",
    });
    expect(res.ok).toBe(true);
    expect(m.scheduledMeeting.findMany.mock.calls[0]![0].where.id).toEqual({ not: "m1" });
  });
});
