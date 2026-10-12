import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/roles");
vi.mock("~/hiring/lib/interview-room-holds.server", () => ({
  applyRoomHolds: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { applyRoomHolds } from "~/hiring/lib/interview-room-holds.server";
import { action } from "~/hiring/routes/api.cycles.$cycleId.interview-config";

const mockPrisma = prisma as unknown as {
  interviewConfig: {
    upsert: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  room: {
    findMany: ReturnType<typeof vi.fn>;
  };
};
const mockApplyRoomHolds = applyRoomHolds as unknown as ReturnType<typeof vi.fn>;

const HIRING_LEAD_ID = "hiring-lead-1";
const CYCLE_ID = "cycle-1";

const BASE_BODY = {
  slotDurationMinutes: 30,
  bufferMinutes: 15,
  dayStartHour: 9,
  dayEndHour: 18,
  interviewStartDate: "2026-05-01T00:00:00.000Z",
  interviewEndDate: "2026-05-07T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).interviewConfig = {
    upsert: vi.fn().mockResolvedValue({ id: "config-1" }),
    findUnique: vi.fn().mockResolvedValue(null),
  };
  (mockPrisma as any).room = { findMany: vi.fn().mockResolvedValue([]) };
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: HIRING_LEAD_ID, email: "lead@x.com", type: "user" },
  } as any);
  vi.mocked(isCore).mockResolvedValue(true);
  mockApplyRoomHolds.mockResolvedValue({ ok: true });
});

function makeRequest(body: unknown) {
  return new Request(`http://localhost/api/cycles/${CYCLE_ID}/interview-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/hiring/cycles/:cycleId/interview-config — timezone validation", () => {
  it("accepts a valid IANA timezone and persists it", async () => {
    const res = await action({
      request: makeRequest({ ...BASE_BODY, timezone: "America/Los_Angeles" }),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);

    expect(res.status).toBe(200);
    expect(mockPrisma.interviewConfig.upsert).toHaveBeenCalledTimes(1);
    const call = mockPrisma.interviewConfig.upsert.mock.calls[0][0];
    expect(call.update.timezone).toBe("America/Los_Angeles");
    expect(call.create.timezone).toBe("America/Los_Angeles");
  });

  it("returns 400 and does not upsert when timezone is invalid", async () => {
    const res = await action({
      request: makeRequest({ ...BASE_BODY, timezone: "America/New_Yorq" }),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/timezone/i);
    expect(mockPrisma.interviewConfig.upsert).not.toHaveBeenCalled();
  });

  it("falls back to America/New_York when timezone is omitted", async () => {
    const res = await action({
      request: makeRequest({ ...BASE_BODY }),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);

    expect(res.status).toBe(200);
    expect(mockPrisma.interviewConfig.upsert).toHaveBeenCalledTimes(1);
    const call = mockPrisma.interviewConfig.upsert.mock.calls[0][0];
    expect(call.update.timezone).toBe("America/New_York");
    expect(call.create.timezone).toBe("America/New_York");
  });
});

describe("POST /api/hiring/cycles/:cycleId/interview-config — schema validation", () => {
  it("rejects out-of-range dayStartHour", async () => {
    const res = await action({
      request: makeRequest({ ...BASE_BODY, dayStartHour: -1 }),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);
    expect(res.status).toBe(400);
    expect(mockPrisma.interviewConfig.upsert).not.toHaveBeenCalled();
  });

  it("rejects out-of-range slotDurationMinutes", async () => {
    const res = await action({
      request: makeRequest({ ...BASE_BODY, slotDurationMinutes: 999_999 }),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);
    expect(res.status).toBe(400);
    expect(mockPrisma.interviewConfig.upsert).not.toHaveBeenCalled();
  });

  it("rejects when dayStartHour >= dayEndHour", async () => {
    const res = await action({
      request: makeRequest({ ...BASE_BODY, dayStartHour: 15, dayEndHour: 10 }),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);
    expect(res.status).toBe(400);
    expect(mockPrisma.interviewConfig.upsert).not.toHaveBeenCalled();
  });

  it("rejects malformed interviewStartDate", async () => {
    const res = await action({
      request: makeRequest({ ...BASE_BODY, interviewStartDate: "not-a-date" }),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);
    expect(res.status).toBe(400);
    expect(mockPrisma.interviewConfig.upsert).not.toHaveBeenCalled();
  });
});

describe("POST /api/hiring/cycles/:cycleId/interview-config — room holds", () => {
  it("saves rooms and holdRooms, applying the hold", async () => {
    mockPrisma.room.findMany.mockResolvedValue([{ id: "room-1", name: "Pod Appa" }]);

    const res = await action({
      request: makeRequest({ ...BASE_BODY, roomIds: ["room-1"], holdRooms: true }),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);

    expect(res.status).toBe(200);
    expect(mockApplyRoomHolds).toHaveBeenCalledTimes(1);
    const applyArgs = mockApplyRoomHolds.mock.calls[0][0];
    expect(applyArgs.cycleId).toBe(CYCLE_ID);
    expect(applyArgs.config.holdRooms).toBe(true);
    expect(applyArgs.config.rooms).toEqual([{ id: "room-1", name: "Pod Appa" }]);
    expect(applyArgs.override).toBe(false);

    const call = mockPrisma.interviewConfig.upsert.mock.calls[0][0];
    expect(call.update.holdRooms).toBe(true);
    expect(call.update.rooms).toEqual({ set: [{ id: "room-1" }] });
  });

  it("returns 409 with conflicts and does not persist when the hold overlaps bookings", async () => {
    const conflicts = [
      {
        roomId: "room-1",
        roomName: "Pod Appa",
        items: [
          {
            kind: "booking" as const,
            id: "booking-1",
            title: "Team sync",
            start: new Date("2026-05-04T13:00:00.000Z"),
            end: new Date("2026-05-04T14:00:00.000Z"),
            occurrenceStart: new Date("2026-05-04T13:00:00.000Z"),
            recurring: false,
            organizer: { id: "u1", firstName: "Ada", lastName: "Lovelace", photoUrl: null },
            isEvent: false,
            source: "Web" as const,
            cycleId: null,
          },
        ],
      },
    ];
    mockApplyRoomHolds.mockResolvedValue({ ok: false, conflicts });
    mockPrisma.room.findMany.mockResolvedValue([{ id: "room-1", name: "Pod Appa" }]);

    const res = await action({
      request: makeRequest({ ...BASE_BODY, roomIds: ["room-1"], holdRooms: true }),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/overlap/i);
    expect(json.conflicts).toEqual([
      {
        roomId: "room-1",
        roomName: "Pod Appa",
        items: [
          {
            kind: "booking",
            id: "booking-1",
            title: "Team sync",
            start: "2026-05-04T13:00:00.000Z",
            end: "2026-05-04T14:00:00.000Z",
            organizer: { firstName: "Ada", lastName: "Lovelace" },
            recurring: false,
          },
        ],
      },
    ]);
    expect(mockPrisma.interviewConfig.upsert).not.toHaveBeenCalled();
  });

  it("passes overrideConflicts through to applyRoomHolds", async () => {
    mockPrisma.room.findMany.mockResolvedValue([{ id: "room-1", name: "Pod Appa" }]);

    await action({
      request: makeRequest({ ...BASE_BODY, roomIds: ["room-1"], holdRooms: true, overrideConflicts: true }),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);

    const applyArgs = mockApplyRoomHolds.mock.calls[0][0];
    expect(applyArgs.override).toBe(true);
  });
});
