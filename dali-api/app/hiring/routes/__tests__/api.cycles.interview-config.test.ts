import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/roles");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/hiring/lib/interview-room-holds.server", () => ({
  applyRoomHolds: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { applyRoomHolds } from "~/hiring/lib/interview-room-holds.server";
import { action, loader } from "~/hiring/routes/api.cycles.$cycleId.interview-config";
import { hasCycleAccess } from "~/lib/roles";

const mockPrisma = prisma as unknown as {
  interviewConfig: {
    upsert: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  applicationCycle: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  room: {
    findMany: ReturnType<typeof vi.fn>;
  };
};
const mockApplyRoomHolds = applyRoomHolds as unknown as ReturnType<typeof vi.fn>;

const HIRING_LEAD_ID = "hiring-lead-1";
const CYCLE_ID = "cycle-1";

const TWO_ROUND_TIMELINE = [
  { kind: "phase", key: "setup", weeks: [1, 5] },
  { kind: "phase", key: "review", weeks: [6, 6] },
  { kind: "delib", id: "first", label: "First delib", weeks: [6, 6] },
  { kind: "phase", key: "interviews", weeks: [7, 7] },
  { kind: "delib", id: "r3", label: "Delib 3", weeks: [8, 8] },
  { kind: "phase", key: "interviews", id: "iv2", label: "Interviews 2", weeks: [9, 9] },
  { kind: "delib", id: "final", label: "Final delib", weeks: [10, 10] },
  { kind: "phase", key: "decisions", weeks: [11, 11] },
];

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
    findMany: vi.fn().mockResolvedValue([]),
  };
  (mockPrisma as any).applicationCycle = {
    findUnique: vi.fn().mockResolvedValue({ timeline: TWO_ROUND_TIMELINE }),
  };
  vi.mocked(hasCycleAccess).mockResolvedValue(true);
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
    expect(applyArgs.configs).toHaveLength(1);
    expect(applyArgs.configs[0].holdRooms).toBe(true);
    expect(applyArgs.configs[0].rooms).toEqual([{ id: "room-1", name: "Pod Appa" }]);
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

describe("interview-config per Interviews round", () => {
  const roundOne = {
    id: "config-1",
    interviewRoundId: "interviews",
    slotDurationMinutes: 45,
    holdRooms: true,
    rooms: [{ id: "room-1", name: "Pod Appa" }],
    interviewStartDate: new Date("2026-05-01T00:00:00.000Z"),
    interviewEndDate: new Date("2026-05-07T00:00:00.000Z"),
    dayStartHour: 9,
    dayEndHour: 18,
    timezone: "America/New_York",
  };

  it("saves a later round's settings under that round", async () => {
    const res = await action({
      request: makeRequest({ ...BASE_BODY, interviewRoundId: "iv2" }),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);

    expect(res.status).toBe(200);
    const call = mockPrisma.interviewConfig.upsert.mock.calls[0][0];
    expect(call.where).toEqual({
      applicationCycleId_interviewRoundId: { applicationCycleId: CYCLE_ID, interviewRoundId: "iv2" },
    });
    expect(call.create.interviewRoundId).toBe("iv2");
  });

  it("saves to the first round when no round is named", async () => {
    await action({ request: makeRequest(BASE_BODY), params: { cycleId: CYCLE_ID }, context: {} } as any);
    expect(mockPrisma.interviewConfig.upsert.mock.calls[0][0].create.interviewRoundId).toBe("interviews");
  });

  it("refuses a round that isn't on the timeline", async () => {
    const res = await action({
      request: makeRequest({ ...BASE_BODY, interviewRoundId: "iv9" }),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);
    expect(res.status).toBe(400);
    expect(mockPrisma.interviewConfig.upsert).not.toHaveBeenCalled();
  });

  it("keeps the other rounds' room holds when one round is saved", async () => {
    mockPrisma.interviewConfig.findMany.mockResolvedValue([roundOne]);

    await action({
      request: makeRequest({ ...BASE_BODY, interviewRoundId: "iv2", holdRooms: false }),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);

    const { configs } = mockApplyRoomHolds.mock.calls[0][0];
    expect(configs).toHaveLength(2);
    expect(configs[0]).toMatchObject({ interviewRoundId: "interviews", holdRooms: true });
    expect(configs[1]).toMatchObject({ holdRooms: false });
  });

  function get(round?: string) {
    const q = round ? `?round=${round}` : "";
    return loader({
      request: new Request(`http://localhost/api/cycles/${CYCLE_ID}/interview-config${q}`),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any).then((r: Response) => r.json());
  }

  it("reads a round's own settings", async () => {
    mockPrisma.interviewConfig.findMany.mockResolvedValue([roundOne]);
    expect(await get()).toMatchObject({ id: "config-1", slotDurationMinutes: 45 });
  });

  it("starts a round with no settings from the latest round's, unsaved", async () => {
    mockPrisma.interviewConfig.findMany.mockResolvedValue([roundOne]);
    expect(await get("iv2")).toMatchObject({ id: null, interviewRoundId: "iv2", slotDurationMinutes: 45 });
  });

  it("reads nothing when no round has settings", async () => {
    expect(await get("iv2")).toBeNull();
  });
});

describe("interview-config audit trail", () => {
  const run = (body: unknown) =>
    action({ request: makeRequest(body), params: { cycleId: CYCLE_ID }, context: {} } as any);

  it("logs a first save as created, with the window and rooms", async () => {
    mockPrisma.room.findMany.mockResolvedValue([{ id: "room-1", name: "Pod Appa" }]);
    mockPrisma.interviewConfig.upsert.mockResolvedValue({ id: "config-1", slotDurationMinutes: 30 });

    await run({ ...BASE_BODY, roomIds: ["room-1"], holdRooms: true });

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "interview.config",
        userId: HIRING_LEAD_ID,
        targetId: "config-1",
        metadata: {
          cycleId: CYCLE_ID,
          interviewRoundId: "interviews",
          created: true,
          before: null,
          after: {
            start: "2026-05-01T00:00:00.000Z",
            end: "2026-05-07T00:00:00.000Z",
            slotDurationMinutes: 30,
          },
          holdRooms: true,
          roomIds: ["room-1"],
        },
      }),
    );
  });

  it("logs the previous window when an existing round is edited", async () => {
    mockPrisma.interviewConfig.findMany.mockResolvedValue([
      {
        id: "config-1",
        interviewRoundId: "interviews",
        slotDurationMinutes: 45,
        interviewStartDate: new Date("2026-04-01T00:00:00.000Z"),
        interviewEndDate: new Date("2026-04-07T00:00:00.000Z"),
        rooms: [],
      },
    ]);

    await run(BASE_BODY);

    const metadata = vi.mocked(logAuditEvent).mock.calls[0][0].metadata as Record<string, unknown>;
    expect(metadata.created).toBe(false);
    expect(metadata.before).toEqual({
      start: "2026-04-01T00:00:00.000Z",
      end: "2026-04-07T00:00:00.000Z",
      slotDurationMinutes: 45,
    });
  });

  it("logs nothing when the room hold conflicts or the round is not on the timeline", async () => {
    mockApplyRoomHolds.mockResolvedValue({ ok: false, conflicts: [] });
    await run(BASE_BODY);
    mockApplyRoomHolds.mockResolvedValue({ ok: true });
    await run({ ...BASE_BODY, interviewRoundId: "iv9" });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
