import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { room: { findUnique: vi.fn() } } }));
vi.mock("~/lib/roles", () => ({ isLabMember: vi.fn() }));
vi.mock("~/lib/meeting-occurrences", () => ({ buildRule: vi.fn() }));
vi.mock("~/lib/rooms.server", () => {
  const parseWindowParams = (start: string, end: string) => {
    const window = { start: new Date(start), end: new Date(end) };
    return window.end > window.start ? window : null;
  };
  return {
    cancelRoomBookingAsMember: vi.fn(),
    createRoomBooking: vi.fn(),
    getRoomSchedule: vi.fn(),
    listBookableRooms: vi.fn(),
    listRoomAvailability: vi.fn(),
    parseWindowParams,
    serializeScheduleItem: (item: { id: string }) => ({ id: item.id }),
  };
});

import { prisma } from "~/lib/db.server";
import { buildRule } from "~/lib/meeting-occurrences";
import { isLabMember } from "~/lib/roles";
import {
  cancelRoomBookingAsMember,
  createRoomBooking,
  getRoomSchedule,
  listBookableRooms,
  listRoomAvailability,
} from "~/lib/rooms.server";
import {
  BOOK_ROOM_DEF,
  CANCEL_ROOM_BOOKING_DEF,
  GET_ROOM_SCHEDULE_DEF,
  LIST_ROOMS_DEF,
  runBookRoom,
  runCancelRoomBooking,
  runGetRoomSchedule,
  runListRooms,
} from "../rooms";

const START = "2026-11-03T14:00:00-05:00";
const END = "2026-11-03T15:00:00-05:00";
const window = { start: new Date(START), end: new Date(END) };
const roomFindUnique = prisma.room.findUnique as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isLabMember).mockResolvedValue(true);
});

describe("room tool scopes", () => {
  it("reads need mcp:read and writes need mcp:write", () => {
    expect(LIST_ROOMS_DEF.requiredScope).toBe("mcp:read");
    expect(GET_ROOM_SCHEDULE_DEF.requiredScope).toBe("mcp:read");
    expect(BOOK_ROOM_DEF.requiredScope).toBe("mcp:write");
    expect(CANCEL_ROOM_BOOKING_DEF.requiredScope).toBe("mcp:write");
  });
});

describe("lab membership", () => {
  it.each([
    ["list_rooms", () => runListRooms("u1", {})],
    ["get_room_schedule", () => runGetRoomSchedule("u1", { roomId: "r1", start: START, end: END })],
    ["book_room", () => runBookRoom("u1", { roomId: "r1", start: START, end: END })],
    ["cancel_room_booking", () => runCancelRoomBooking("u1", { bookingId: "b1" })],
  ])("%s refuses a non-member", async (_name, call) => {
    vi.mocked(isLabMember).mockResolvedValue(false);
    await expect(call()).rejects.toMatchObject({ status: 403 });
    expect(createRoomBooking).not.toHaveBeenCalled();
    expect(cancelRoomBookingAsMember).not.toHaveBeenCalled();
  });
});

describe("list_rooms", () => {
  it("lists rooms without availability when no window is given", async () => {
    vi.mocked(listBookableRooms).mockResolvedValue([{ id: "r1" }] as never);
    await expect(runListRooms("u1", {})).resolves.toEqual({ rooms: [{ id: "r1" }] });
    expect(listRoomAvailability).not.toHaveBeenCalled();
  });

  it("checks a window", async () => {
    vi.mocked(listRoomAvailability).mockResolvedValue([{ id: "r1", conflict: null }] as never);
    await expect(runListRooms("u1", { start: START, end: END })).resolves.toEqual({
      rooms: [{ id: "r1", conflict: null }],
    });
    expect(listRoomAvailability).toHaveBeenCalledWith(window, { recurrenceRule: undefined });
  });

  it("checks a series when the repeat rule is valid", async () => {
    vi.mocked(buildRule).mockReturnValue({} as never);
    vi.mocked(listRoomAvailability).mockResolvedValue([] as never);
    await runListRooms("u1", { start: START, end: END, recurrenceRule: "FREQ=WEEKLY;COUNT=4" });
    expect(listRoomAvailability).toHaveBeenCalledWith(window, { recurrenceRule: "FREQ=WEEKLY;COUNT=4" });
  });

  it("rejects a repeat rule that doesn't parse rather than checking one slot", async () => {
    vi.mocked(buildRule).mockReturnValue(null);
    await expect(runListRooms("u1", { start: START, end: END, recurrenceRule: "nope" })).rejects.toMatchObject({
      status: 400,
    });
    expect(listRoomAvailability).not.toHaveBeenCalled();
  });

  it.each([
    ["only start", { start: START }],
    ["only end", { end: END }],
    ["a repeat rule with no window", { recurrenceRule: "FREQ=WEEKLY;COUNT=4" }],
  ])("rejects %s", async (_name, input) => {
    await expect(runListRooms("u1", input)).rejects.toMatchObject({ status: 400 });
  });

  it("rejects an end before the start", async () => {
    await expect(runListRooms("u1", { start: END, end: START })).rejects.toMatchObject({ status: 400 });
  });
});

describe("get_room_schedule", () => {
  it("returns the room and its serialized items", async () => {
    roomFindUnique.mockResolvedValue({ id: "r1", name: "Pod", description: null, capacity: 4, archivedAt: null });
    vi.mocked(getRoomSchedule).mockResolvedValue([{ id: "b1" }] as never);
    await expect(runGetRoomSchedule("u1", { roomId: "r1", start: START, end: END })).resolves.toEqual({
      room: { id: "r1", name: "Pod", description: null, capacity: 4 },
      items: [{ id: "b1" }],
    });
    expect(getRoomSchedule).toHaveBeenCalledWith("r1", window.start, window.end);
  });

  it.each([
    ["missing", null],
    ["archived", { id: "r1", archivedAt: new Date() }],
  ])("404s a room that is %s", async (_name, room) => {
    roomFindUnique.mockResolvedValue(room);
    await expect(runGetRoomSchedule("u1", { roomId: "r1", start: START, end: END })).rejects.toMatchObject({
      status: 404,
    });
    expect(getRoomSchedule).not.toHaveBeenCalled();
  });
});

describe("book_room", () => {
  it("books for the caller and returns the booking", async () => {
    vi.mocked(createRoomBooking).mockResolvedValue({
      ok: true,
      value: { id: "b1", start: window.start, end: window.end },
    });
    await expect(
      runBookRoom("u1", { roomId: "r1", start: START, end: END, title: "Standup", recurrenceRule: "FREQ=DAILY;COUNT=2" }),
    ).resolves.toEqual({
      bookingId: "b1",
      roomId: "r1",
      start: "2026-11-03T19:00:00.000Z",
      end: "2026-11-03T20:00:00.000Z",
    });
    expect(createRoomBooking).toHaveBeenCalledWith({
      roomId: "r1",
      userId: "u1",
      start: window.start,
      end: window.end,
      title: "Standup",
      source: "App",
      recurrenceRule: "FREQ=DAILY;COUNT=2",
    });
  });

  it("accepts a Z time", async () => {
    vi.mocked(createRoomBooking).mockResolvedValue({
      ok: true,
      value: { id: "b1", start: window.start, end: window.end },
    });
    await runBookRoom("u1", { roomId: "r1", start: "2026-11-03T19:00:00Z", end: "2026-11-03T20:00:00.000Z" });
    expect(vi.mocked(createRoomBooking).mock.calls[0]![0].start).toEqual(window.start);
  });

  it.each(["2026-11-03T14:00:00", "2026-11-03", "tomorrow at 2", "2026-13-40T14:00:00Z"])(
    "refuses a start of %s instead of guessing its zone",
    async (start) => {
      await expect(runBookRoom("u1", { roomId: "r1", start, end: END })).rejects.toMatchObject({ status: 400 });
      expect(createRoomBooking).not.toHaveBeenCalled();
    },
  );

  it("carries a conflict through with its status and message", async () => {
    vi.mocked(createRoomBooking).mockResolvedValue({
      ok: false,
      error: 'Pod is already booked then ("Standup")',
      status: 409,
    });
    await expect(runBookRoom("u1", { roomId: "r1", start: START, end: END })).rejects.toMatchObject({
      message: 'Pod is already booked then ("Standup")',
      status: 409,
    });
  });
});

describe("cancel_room_booking", () => {
  it("cancels as the caller, leaving the scope to default to the whole series", async () => {
    vi.mocked(cancelRoomBookingAsMember).mockResolvedValue({ ok: true, value: null });
    await expect(runCancelRoomBooking("u1", { bookingId: "b1" })).resolves.toEqual({ ok: true });
    expect(cancelRoomBookingAsMember).toHaveBeenCalledWith("b1", "u1", { scope: undefined, occurrenceStart: undefined });
  });

  it("forwards a scoped occurrence", async () => {
    vi.mocked(cancelRoomBookingAsMember).mockResolvedValue({ ok: true, value: null });
    await runCancelRoomBooking("u1", { bookingId: "b1", scope: "this", occurrenceStart: START });
    expect(cancelRoomBookingAsMember).toHaveBeenCalledWith("b1", "u1", { scope: "this", occurrenceStart: window.start });
  });

  it("refuses an occurrenceStart with no offset", async () => {
    await expect(
      runCancelRoomBooking("u1", { bookingId: "b1", scope: "this", occurrenceStart: "2026-11-03T14:00:00" }),
    ).rejects.toMatchObject({ status: 400 });
    expect(cancelRoomBookingAsMember).not.toHaveBeenCalled();
  });

  it.each([403, 404, 409])("carries a %i through", async (status) => {
    vi.mocked(cancelRoomBookingAsMember).mockResolvedValue({ ok: false, error: "No", status });
    await expect(runCancelRoomBooking("u1", { bookingId: "b1" })).rejects.toMatchObject({ status });
  });
});
