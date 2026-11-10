import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/room-display.server", async (importOriginal) => ({
  displayRoom: (await importOriginal<typeof import("~/lib/room-display.server")>()).displayRoom,
  requireRoomDisplay: vi.fn(),
  displayUnauthorized: vi.fn(() => Response.json({ error: "Display not paired" }, { status: 401 })),
}));
vi.mock("~/lib/db.server", () => ({ prisma: { roomBooking: { findUnique: vi.fn() } } }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/display-check-ins.server", () => ({ isCheckedIn: vi.fn() }));
vi.mock("~/lib/wallet-token", () => ({ walletTokensConfigured: vi.fn() }));
vi.mock("~/lib/wallet-scan.server", () => ({ resolveScannedMember: vi.fn() }));
vi.mock("~/lib/scheduled-meeting", () => ({ markMeetingAttendance: vi.fn() }));
vi.mock("~/lib/rooms.server", () => ({
  getRoomSchedule: vi.fn(),
  currentEvent: vi.fn(),
  createRoomBooking: vi.fn(),
  cancelRoomBooking: vi.fn(),
  extendRoomBooking: vi.fn(),
}));
vi.mock("~/lib/validate", () => ({ parseJson: vi.fn() }));
vi.mock("~/lib/display-scan.server", () => ({ getActiveDisplayScan: vi.fn() }));

import { requireRoomDisplay } from "~/lib/room-display.server";
import { walletTokensConfigured } from "~/lib/wallet-token";
import { resolveScannedMember } from "~/lib/wallet-scan.server";
import { markMeetingAttendance } from "~/lib/scheduled-meeting";
import { cancelRoomBooking, createRoomBooking, currentEvent, extendRoomBooking, getRoomSchedule } from "~/lib/rooms.server";
import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
import { isCheckedIn } from "~/lib/display-check-ins.server";
import { parseJson } from "~/lib/validate";
import { getActiveDisplayScan } from "~/lib/display-scan.server";
import { action as scan } from "~/rooms/routes/api.room-display.scan";
import { action as book } from "~/rooms/routes/api.room-display.book";
import { action as changeBooking } from "~/rooms/routes/api.room-display.bookings.$id";

const lab = { id: "r1", name: "Lab", description: null, capacity: 8 };
const garage = { id: "r2", name: "Garage", description: null, capacity: 14 };
const display = { id: "d1", label: "Door", room: lab, rooms: [lab, garage] };
const member = { id: "u2", firstName: "Ada", lastName: "Lovelace", photoUrl: null, isDaliMember: true };
const post = (path: string) =>
  ({ request: new Request(`http://localhost${path}`, { method: "POST" }), params: {} }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRoomDisplay).mockResolvedValue(display);
  vi.mocked(walletTokensConfigured).mockReturnValue(true);
  vi.mocked(resolveScannedMember).mockResolvedValue(member);
  vi.mocked(getRoomSchedule).mockResolvedValue([]);
  vi.mocked(markMeetingAttendance).mockResolvedValue({ ok: true });
  vi.mocked(getActiveDisplayScan).mockResolvedValue(null);
  vi.mocked(isCheckedIn).mockResolvedValue(false);
});

describe("room-display scan", () => {
  beforeEach(() => {
    vi.mocked(parseJson).mockResolvedValue({ memberToken: "tok" } as never);
    vi.mocked(currentEvent).mockReturnValue({
      id: "m1",
      title: "Lab night",
      occurrenceStart: new Date("2026-10-23T22:00:00Z"),
    } as never);
  });

  it("401s without a paired display", async () => {
    vi.mocked(requireRoomDisplay).mockResolvedValue(null);
    expect((await scan(post("/api/room-display/scan"))).status).toBe(401);
  });

  it("409s when no event is checking in", async () => {
    vi.mocked(currentEvent).mockReturnValue(null);
    const res = await scan(post("/api/room-display/scan"));
    expect(res.status).toBe(409);
    expect(markMeetingAttendance).not.toHaveBeenCalled();
  });

  it("400s an invalid pass", async () => {
    vi.mocked(resolveScannedMember).mockResolvedValue(null);
    expect((await scan(post("/api/room-display/scan"))).status).toBe(400);
  });

  it("checks a DALI member in as a walk-in, marked by themselves", async () => {
    const res = await scan(post("/api/room-display/scan"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, event: { id: "m1" }, member: { id: "u2" } });
    expect(markMeetingAttendance).toHaveBeenCalledWith("m1", "u2", true, "u2", new Date("2026-10-23T22:00:00Z"), {
      addIfMissing: true,
    });
  });

  it("checks in to the event in the room asked for", async () => {
    vi.mocked(parseJson).mockResolvedValue({ memberToken: "tok", roomId: "r2" } as never);
    await scan(post("/api/room-display/scan"));
    expect(vi.mocked(getRoomSchedule).mock.calls[0]![0]).toBe("r2");
  });

  it("refuses a room the display isn't paired to", async () => {
    vi.mocked(parseJson).mockResolvedValue({ memberToken: "tok", roomId: "r9" } as never);
    expect((await scan(post("/api/room-display/scan"))).status).toBe(404);
    expect(markMeetingAttendance).not.toHaveBeenCalled();
  });

  it("says when the member was already checked in", async () => {
    vi.mocked(isCheckedIn).mockResolvedValue(true);
    const res = await scan(post("/api/room-display/scan"));
    expect(await res.json()).toMatchObject({ alreadyCheckedIn: true });
    expect(isCheckedIn).toHaveBeenCalledWith("m1", new Date("2026-10-23T22:00:00Z"), "u2");
  });

  it("doesn't add a non-member who wasn't invited", async () => {
    vi.mocked(resolveScannedMember).mockResolvedValue({ ...member, isDaliMember: false });
    await scan(post("/api/room-display/scan"));
    expect(markMeetingAttendance).toHaveBeenCalledWith("m1", "u2", true, "u2", expect.any(Date), { addIfMissing: false });
  });
  describe("with iPad scanning switched on from a meeting", () => {
    const occurrenceStart = new Date("2026-09-30T22:00:00Z");
    const labScan = {
      meetingId: "m9",
      occurrenceStart,
      title: "Project sync",
      start: occurrenceStart,
      end: new Date("2026-09-30T23:00:00Z"),
      isEvent: false,
      startedBy: null,
      expiresAt: new Date("2026-09-30T23:15:00Z"),
    };

    it("checks in to that event's occurrence instead of the room's", async () => {
      vi.mocked(getActiveDisplayScan).mockResolvedValue(labScan);
      const res = await scan(post("/api/room-display/scan"));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ event: { id: "m9", title: "Project sync" } });
      expect(markMeetingAttendance).toHaveBeenCalledWith("m9", "u2", true, "u2", occurrenceStart, {
        addIfMissing: false,
      });
      expect(getRoomSchedule).not.toHaveBeenCalled();
    });

    it("works in a room with no event of its own", async () => {
      vi.mocked(currentEvent).mockReturnValue(null);
      vi.mocked(getActiveDisplayScan).mockResolvedValue(labScan);
      expect((await scan(post("/api/room-display/scan"))).status).toBe(200);
    });

    it("takes DALI walk-ins at a self check-in event", async () => {
      vi.mocked(getActiveDisplayScan).mockResolvedValue({ ...labScan, isEvent: true });
      await scan(post("/api/room-display/scan"));
      expect(markMeetingAttendance).toHaveBeenCalledWith("m9", "u2", true, "u2", occurrenceStart, {
        addIfMissing: true,
      });
    });
  });
});

describe("room-display book", () => {
  beforeEach(() => {
    vi.mocked(parseJson).mockResolvedValue({ memberToken: "tok", minutes: 30 } as never);
  });

  it("books the display's room now, as the scanned member", async () => {
    vi.mocked(createRoomBooking).mockResolvedValue({
      ok: true,
      value: { id: "b1", start: new Date(), end: new Date() },
    });
    const res = await book(post("/api/room-display/book"));
    expect(res.status).toBe(201);
    const input = vi.mocked(createRoomBooking).mock.calls[0]![0];
    expect(input).toMatchObject({ roomId: "r1", userId: "u2", source: "Display" });
    expect(input.end.getTime() - input.start.getTime()).toBe(30 * 60_000);
  });

  it("books an explicit slot dragged out on the timeline", async () => {
    const start = new Date("2026-09-24T18:00:00Z");
    const end = new Date("2026-09-24T19:00:00Z");
    vi.mocked(parseJson).mockResolvedValue({ memberToken: "tok", start, end } as never);
    vi.mocked(createRoomBooking).mockResolvedValue({ ok: true, value: { id: "b1", start, end } });
    expect((await book(post("/api/room-display/book"))).status).toBe(201);
    expect(vi.mocked(createRoomBooking).mock.calls[0]![0]).toMatchObject({ roomId: "r1", userId: "u2", start, end });
  });

  it("books the second room when asked", async () => {
    vi.mocked(parseJson).mockResolvedValue({ memberToken: "tok", roomId: "r2", minutes: 30 } as never);
    vi.mocked(createRoomBooking).mockResolvedValue({ ok: true, value: { id: "b1", start: new Date(), end: new Date() } });
    await book(post("/api/room-display/book"));
    expect(vi.mocked(createRoomBooking).mock.calls[0]![0]).toMatchObject({ roomId: "r2" });
  });

  it("won't book a room the display isn't paired to", async () => {
    vi.mocked(parseJson).mockResolvedValue({ memberToken: "tok", roomId: "r9", minutes: 30 } as never);
    expect((await book(post("/api/room-display/book"))).status).toBe(404);
    expect(createRoomBooking).not.toHaveBeenCalled();
  });

  it("passes a conflict through", async () => {
    vi.mocked(createRoomBooking).mockResolvedValue({ ok: false, error: "The room is already booked then", status: 409 });
    expect((await book(post("/api/room-display/book"))).status).toBe(409);
  });

  it("400s an invalid pass without booking", async () => {
    vi.mocked(resolveScannedMember).mockResolvedValue(null);
    expect((await book(post("/api/room-display/book"))).status).toBe(400);
    expect(createRoomBooking).not.toHaveBeenCalled();
  });

  it("503s when wallet passes aren't configured", async () => {
    vi.mocked(walletTokensConfigured).mockReturnValue(false);
    expect((await book(post("/api/room-display/book"))).status).toBe(503);
  });
});

describe("room-display booking end / extend", () => {
  const now = new Date("2026-10-23T15:00:00Z");
  const underway = {
    kind: "booking",
    id: "b1",
    start: new Date("2026-10-23T14:30:00Z"),
    end: new Date("2026-10-23T15:30:00Z"),
    occurrenceStart: new Date("2026-10-23T14:30:00Z"),
  };
  const change = (c: "end" | "extend") => {
    vi.mocked(parseJson).mockResolvedValue({ memberToken: "tok", change: c } as never);
    return changeBooking({
      request: new Request("http://localhost/api/room-display/bookings/b1", { method: "POST" }),
      params: { id: "b1" },
    } as never);
  };

  beforeEach(() => {
    vi.useFakeTimers({ now, toFake: ["Date"] });
    vi.mocked(prisma.roomBooking.findUnique).mockResolvedValue({
      roomId: "r2",
      userId: "u2",
      source: "Display",
      cancelledAt: null,
    } as never);
    vi.mocked(getRoomSchedule).mockResolvedValue([underway] as never);
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(cancelRoomBooking).mockResolvedValue({ ok: true, value: null });
    vi.mocked(extendRoomBooking).mockResolvedValue({
      ok: true,
      value: { start: underway.start, end: new Date("2026-10-23T15:45:00Z") },
    });
  });
  afterEach(() => vi.useRealTimers());

  it("ends the booker's own booking now, as them", async () => {
    const res = await change("end");
    expect(res.status).toBe(200);
    expect(cancelRoomBooking).toHaveBeenCalledWith("b1", "u2", { scope: "this", occurrenceStart: underway.occurrenceStart });
    expect(await res.json()).toMatchObject({ member: { id: "u2" }, booking: { end: now.toISOString() } });
  });

  it("extends by 15 minutes", async () => {
    const res = await change("extend");
    expect(res.status).toBe(200);
    expect(extendRoomBooking).toHaveBeenCalledWith("b1", underway.occurrenceStart, 15);
    expect(await res.json()).toMatchObject({ booking: { end: "2026-10-23T15:45:00.000Z" } });
  });

  it("refuses someone else's pass", async () => {
    vi.mocked(resolveScannedMember).mockResolvedValue({ ...member, id: "u3" });
    expect((await change("end")).status).toBe(403);
    expect(cancelRoomBooking).not.toHaveBeenCalled();
  });

  it("lets Core change anyone's booking", async () => {
    vi.mocked(resolveScannedMember).mockResolvedValue({ ...member, id: "core" });
    vi.mocked(isCore).mockResolvedValue(true);
    expect((await change("end")).status).toBe(200);
    expect(cancelRoomBooking).toHaveBeenCalledWith("b1", "core", expect.anything());
  });

  it("404s a booking in a room the display doesn't show", async () => {
    vi.mocked(prisma.roomBooking.findUnique).mockResolvedValue({
      roomId: "r9",
      userId: "u2",
      source: "Display",
      cancelledAt: null,
    } as never);
    expect((await change("end")).status).toBe(404);
    expect(resolveScannedMember).not.toHaveBeenCalled();
  });

  it("404s a cancelled booking", async () => {
    vi.mocked(prisma.roomBooking.findUnique).mockResolvedValue({
      roomId: "r2",
      userId: "u2",
      source: "Display",
      cancelledAt: new Date(),
    } as never);
    expect((await change("end")).status).toBe(404);
  });

  it("leaves interview holds alone", async () => {
    vi.mocked(prisma.roomBooking.findUnique).mockResolvedValue({
      roomId: "r2",
      userId: "u2",
      source: "InterviewHold",
      cancelledAt: null,
    } as never);
    expect((await change("end")).status).toBe(409);
  });

  it("409s a booking that isn't underway", async () => {
    vi.mocked(getRoomSchedule).mockResolvedValue([]);
    expect((await change("extend")).status).toBe(409);
    expect(extendRoomBooking).not.toHaveBeenCalled();
  });

  it("passes a conflict on extend through", async () => {
    vi.mocked(extendRoomBooking).mockResolvedValue({ ok: false, error: "Lab is already booked then", status: 409 });
    const res = await change("extend");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Lab is already booked then" });
  });

  it("400s an invalid pass", async () => {
    vi.mocked(resolveScannedMember).mockResolvedValue(null);
    expect((await change("end")).status).toBe(400);
  });
});
