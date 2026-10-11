import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db", () => {
  const prisma = {
    applicationCycle: { findUnique: vi.fn() },
    scheduledMeeting: { update: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma };
});
vi.mock("~/lib/rooms.server", () => ({
  createRoomBooking: vi.fn(),
  cancelRoomBooking: vi.fn(),
  listRoomConflicts: vi.fn(),
  previewBookingSeries: vi.fn(),
  releaseCycleRoomBookings: vi.fn(),
}));
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));

import { prisma } from "~/lib/db";
import {
  createRoomBooking,
  cancelRoomBooking,
  listRoomConflicts,
  previewBookingSeries,
  releaseCycleRoomBookings,
  type RoomScheduleItem,
} from "~/lib/rooms.server";
import { notify } from "~/lib/notify.server";
import { zonedDayStartUtc, zonedWallTimeUtc } from "~/lib/timezone";
import { applyRoomHolds, holdOccurrencesFor } from "~/hiring/lib/interview-room-holds.server";

const mockDb = prisma as unknown as {
  applicationCycle: { findUnique: ReturnType<typeof vi.fn> };
  scheduledMeeting: { update: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};
const mockRooms = {
  createRoomBooking: createRoomBooking as unknown as ReturnType<typeof vi.fn>,
  cancelRoomBooking: cancelRoomBooking as unknown as ReturnType<typeof vi.fn>,
  listRoomConflicts: listRoomConflicts as unknown as ReturnType<typeof vi.fn>,
  previewBookingSeries: previewBookingSeries as unknown as ReturnType<typeof vi.fn>,
  releaseCycleRoomBookings: releaseCycleRoomBookings as unknown as ReturnType<typeof vi.fn>,
};
const mockNotify = notify as unknown as ReturnType<typeof vi.fn>;

const TZ = "America/New_York";

function makeItem(over: Partial<RoomScheduleItem> = {}): RoomScheduleItem {
  return {
    kind: "booking",
    id: "item-1",
    title: "Existing booking",
    start: new Date("2026-05-04T13:00:00Z"),
    end: new Date("2026-05-04T14:00:00Z"),
    occurrenceStart: new Date("2026-05-04T13:00:00Z"),
    recurring: false,
    organizer: { id: "u1", firstName: "Ada", lastName: "Lovelace", photoUrl: null },
    isEvent: false,
    source: "Web",
    cycleId: null,
    ...over,
  };
}

describe("holdOccurrencesFor", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clamps the start to today and skips the weekend", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-02T15:00:00Z")); // Saturday, 11am ET

    const occ = holdOccurrencesFor({
      interviewStartDate: zonedDayStartUtc(2026, 4, 1, TZ),
      interviewEndDate: zonedDayStartUtc(2026, 5, 8, TZ),
      dayStartHour: 9,
      dayEndHour: 18,
      timezone: TZ,
    });

    expect(occ).not.toBeNull();
    // Today (Saturday) is later than interviewStartDate (April 1), and the
    // next weekday on or after it is Monday May 4 — Saturday/Sunday skipped.
    expect(occ!.start).toEqual(zonedWallTimeUtc(2026, 5, 4, 9, 0, TZ));
    expect(occ!.end).toEqual(zonedWallTimeUtc(2026, 5, 4, 18, 0, TZ));
    expect(occ!.recurrenceRule).toMatch(
      /^FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;UNTIL=\d{8}T\d{6}Z$/,
    );
  });

  it("returns null when the interview window has no weekday left to hold", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T12:00:00Z"));

    // A one-day window that falls entirely on a Saturday.
    const occ = holdOccurrencesFor({
      interviewStartDate: zonedDayStartUtc(2026, 5, 9, TZ),
      interviewEndDate: zonedDayStartUtc(2026, 5, 9, TZ),
      dayStartHour: 9,
      dayEndHour: 18,
      timezone: TZ,
    });

    expect(occ).toBeNull();
  });
});

describe("applyRoomHolds", () => {
  const config = () => ({
    interviewStartDate: zonedDayStartUtc(2026, 5, 4, TZ),
    interviewEndDate: zonedDayStartUtc(2026, 5, 4, TZ),
    dayStartHour: 9,
    dayEndHour: 18,
    timezone: TZ,
    holdRooms: true,
    rooms: [{ id: "room-1", name: "Pod Appa" }],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T15:00:00Z")); // Monday, 11am ET

    mockDb.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
    mockDb.applicationCycle.findUnique.mockResolvedValue({ name: "Fall 2026" });
    mockRooms.previewBookingSeries.mockResolvedValue({
      ok: true,
      value: [{ start: new Date("2026-05-04T13:00:00Z"), end: new Date("2026-05-04T22:00:00Z") }],
    });
    mockRooms.listRoomConflicts.mockResolvedValue([]);
    mockRooms.releaseCycleRoomBookings.mockResolvedValue(undefined);
    mockRooms.createRoomBooking.mockResolvedValue({
      ok: true,
      value: { id: "hold-1", start: new Date(), end: new Date() },
    });
    mockRooms.cancelRoomBooking.mockResolvedValue({ ok: true, value: null });
    mockNotify.mockResolvedValue({ inApp: 0, emailed: 0, slackDmed: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("without override, returns the conflicts and writes nothing", async () => {
    const conflictItem = makeItem({ kind: "booking", id: "b1", recurring: false });
    mockRooms.listRoomConflicts.mockResolvedValue([conflictItem]);

    const result = await applyRoomHolds({
      cycleId: "cycle-1",
      config: config(),
      actorUserId: "actor-1",
      override: false,
    });

    expect(result).toEqual({
      ok: false,
      conflicts: [{ roomId: "room-1", roomName: "Pod Appa", items: [conflictItem] }],
    });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(mockRooms.releaseCycleRoomBookings).not.toHaveBeenCalled();
    expect(mockRooms.createRoomBooking).not.toHaveBeenCalled();
  });

  it("override cancels a recurring booking (scope \"this\") and disconnects a conflicting meeting, then creates one hold per room", async () => {
    const bookingItem = makeItem({
      kind: "booking",
      id: "b1",
      recurring: true,
      occurrenceStart: new Date("2026-05-04T13:00:00Z"),
      organizer: { id: "u1", firstName: "Ada", lastName: "Lovelace", photoUrl: null },
    });
    const meetingItem = makeItem({
      kind: "meeting",
      id: "m1",
      recurring: false,
      organizer: { id: "u2", firstName: "Sam", lastName: "Rivera", photoUrl: null },
    });
    mockRooms.listRoomConflicts.mockResolvedValue([bookingItem, meetingItem]);

    const result = await applyRoomHolds({
      cycleId: "cycle-1",
      config: config(),
      actorUserId: "actor-1",
      override: true,
    });

    expect(result).toEqual({ ok: true });
    expect(mockRooms.releaseCycleRoomBookings).toHaveBeenCalledWith(
      "cycle-1",
      "InterviewHold",
      "actor-1",
      prisma,
    );
    expect(mockRooms.cancelRoomBooking).toHaveBeenCalledWith(
      "b1",
      "actor-1",
      { scope: "this", occurrenceStart: bookingItem.occurrenceStart },
      prisma,
    );
    expect(mockDb.scheduledMeeting.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { rooms: { disconnect: { id: "room-1" } } },
    });
    expect(mockRooms.createRoomBooking).toHaveBeenCalledTimes(1);
    expect(mockRooms.createRoomBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: "room-1",
        userId: "actor-1",
        source: "InterviewHold",
        applicationCycleId: "cycle-1",
      }),
      prisma,
    );

    await vi.waitFor(() => expect(mockNotify).toHaveBeenCalledTimes(1));
    const notifyArgs = mockNotify.mock.calls[0][0];
    expect(notifyArgs.eventType).toBe("room.booking_bumped");
    expect(notifyArgs.recipients.map((r: { userId: string }) => r.userId).sort()).toEqual([
      "u1",
      "u2",
    ]);
  });

  it("holdRooms false releases existing holds and creates nothing", async () => {
    const result = await applyRoomHolds({
      cycleId: "cycle-1",
      config: { ...config(), holdRooms: false },
      actorUserId: "actor-1",
      override: false,
    });

    expect(result).toEqual({ ok: true });
    expect(mockRooms.releaseCycleRoomBookings).toHaveBeenCalledWith(
      "cycle-1",
      "InterviewHold",
      "actor-1",
      prisma,
    );
    expect(mockRooms.listRoomConflicts).not.toHaveBeenCalled();
    expect(mockRooms.createRoomBooking).not.toHaveBeenCalled();
  });
});
