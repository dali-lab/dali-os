import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/room-display.server", () => ({
  requireRoomDisplay: vi.fn(),
  displayUnauthorized: vi.fn(() => Response.json({ error: "Display not paired" }, { status: 401 })),
}));
vi.mock("~/lib/wallet-token", () => ({ walletTokensConfigured: vi.fn() }));
vi.mock("~/lib/wallet-scan.server", () => ({ resolveScannedMember: vi.fn() }));
vi.mock("~/lib/scheduled-meeting", () => ({ markMeetingAttendance: vi.fn() }));
vi.mock("~/lib/rooms.server", () => ({
  getRoomSchedule: vi.fn(),
  currentEvent: vi.fn(),
  createRoomBooking: vi.fn(),
}));
vi.mock("~/lib/validate", () => ({ parseJson: vi.fn() }));

import { requireRoomDisplay } from "~/lib/room-display.server";
import { walletTokensConfigured } from "~/lib/wallet-token";
import { resolveScannedMember } from "~/lib/wallet-scan.server";
import { markMeetingAttendance } from "~/lib/scheduled-meeting";
import { createRoomBooking, currentEvent, getRoomSchedule } from "~/lib/rooms.server";
import { parseJson } from "~/lib/validate";
import { action as scan } from "~/rooms/routes/api.room-display.scan";
import { action as book } from "~/rooms/routes/api.room-display.book";

const display = { id: "d1", label: "Door", room: { id: "r1", name: "Lab", description: null, capacity: 8 } };
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
});

describe("room-display scan", () => {
  beforeEach(() => {
    vi.mocked(parseJson).mockResolvedValue({ memberToken: "tok" } as never);
    vi.mocked(currentEvent).mockReturnValue({ id: "m1", title: "Lab night" } as never);
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
    expect(markMeetingAttendance).toHaveBeenCalledWith("m1", "u2", true, "u2", { addIfMissing: true });
  });

  it("doesn't add a non-member who wasn't invited", async () => {
    vi.mocked(resolveScannedMember).mockResolvedValue({ ...member, isDaliMember: false });
    await scan(post("/api/room-display/scan"));
    expect(markMeetingAttendance).toHaveBeenCalledWith("m1", "u2", true, "u2", { addIfMissing: false });
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
