import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/cors", () => ({
  handlePreflight: () => null,
  withCors: (_req: Request, res: Response) => res,
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { action } from "~/hiring/routes/api.cycles.$cycleId.my-availability";

const USER_ID = "user-1";
const CYCLE_ID = "cycle-1";

const mockPrisma = prisma as unknown as {
  dALIMember: { findUnique: ReturnType<typeof vi.fn> };
  cycleInterviewer: { findMany: ReturnType<typeof vi.fn> };
  interviewerAvailability: {
    findMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
  };
  interviewConfig: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).dALIMember = { findUnique: vi.fn().mockResolvedValue({ id: "m1" }),
  };
  (mockPrisma as any).cycleInterviewer = {
    findMany: vi.fn().mockResolvedValue([{ id: "ci-1" }]),
  };
  (mockPrisma as any).interviewerAvailability = {
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  };
  (mockPrisma as any).interviewConfig = {
    findUnique: vi.fn().mockResolvedValue(null),
  };
  (mockPrisma as any).$transaction = vi.fn(async (cb: any) => cb(mockPrisma));
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID },
  } as any);
});

function makeRequest(body: unknown) {
  return new Request(`http://localhost/api/cycles/${CYCLE_ID}/my-availability`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /api/hiring/cycles/:cycleId/my-availability — input validation", () => {
  it("rejects oversized blocks arrays before touching the database", async () => {
    const blocks = Array.from({ length: 501 }, (_, i) => ({
      startTime: `2026-05-01T0${i % 10}:00:00.000Z`,
      endTime: `2026-05-01T0${i % 10}:30:00.000Z`,
    }));
    const res = await action({
      request: makeRequest({ blocks }),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);
    expect(res.status).toBe(400);
    expect(mockPrisma.interviewerAvailability.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.interviewerAvailability.createMany).not.toHaveBeenCalled();
  });

  it("rejects malformed datetime strings", async () => {
    const res = await action({
      request: makeRequest({
        blocks: [{ startTime: "not-a-date", endTime: "also-not" }],
      }),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);
    expect(res.status).toBe(400);
    expect(mockPrisma.interviewerAvailability.createMany).not.toHaveBeenCalled();
  });

  it("rejects blocks where endTime is before startTime", async () => {
    const res = await action({
      request: makeRequest({
        blocks: [
          {
            startTime: "2026-05-01T10:00:00.000Z",
            endTime: "2026-05-01T09:00:00.000Z",
          },
        ],
      }),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);
    expect(res.status).toBe(400);
    expect(mockPrisma.interviewerAvailability.createMany).not.toHaveBeenCalled();
  });

  it("accepts a small valid blocks array", async () => {
    const res = await action({
      request: makeRequest({
        blocks: [
          {
            startTime: "2026-05-01T09:00:00.000Z",
            endTime: "2026-05-01T09:30:00.000Z",
          },
        ],
      }),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);
    expect(res.status).toBe(200);
  });

  it("treats missing blocks as the empty array", async () => {
    const res = await action({
      request: makeRequest({}),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);
    expect(res.status).toBe(200);
  });
});

describe("PUT /api/hiring/cycles/:cycleId/my-availability — window clip", () => {
  // Regression: the window bounds were derived by reading the stored
  // UTC-midnight date through the config timezone, which shifted the whole
  // window back a day. Every block an interviewer submitted then fell outside
  // it and was silently discarded — availability saved as empty.
  it("keeps blocks on the configured start day (ET config, no day-shift)", async () => {
    (mockPrisma as any).interviewConfig.findUnique = vi.fn().mockResolvedValue({
      // Stored as UTC midnight; stands for the calendar date 2026-06-01.
      interviewStartDate: new Date("2026-06-01T00:00:00.000Z"),
      interviewEndDate: new Date("2026-06-01T00:00:00.000Z"),
      timezone: "America/New_York",
    });

    // 9:00–9:30 AM ET on 2026-06-01 (ET is UTC-4 in June).
    const res = await action({
      request: makeRequest({
        blocks: [
          {
            startTime: "2026-06-01T13:00:00.000Z",
            endTime: "2026-06-01T13:30:00.000Z",
          },
        ],
      }),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);

    expect(res.status).toBe(200);
    expect(mockPrisma.interviewerAvailability.createMany).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.interviewerAvailability.createMany.mock.calls[0][0];
    expect(arg.data).toHaveLength(1);
    expect(arg.data[0].startTime.toISOString()).toBe("2026-06-01T13:00:00.000Z");
  });

  it("still clips blocks genuinely outside the window", async () => {
    (mockPrisma as any).interviewConfig.findUnique = vi.fn().mockResolvedValue({
      interviewStartDate: new Date("2026-06-01T00:00:00.000Z"),
      interviewEndDate: new Date("2026-06-01T00:00:00.000Z"),
      timezone: "America/New_York",
    });

    // 9:00 AM ET on 2026-06-05 — four days past the one-day window.
    const res = await action({
      request: makeRequest({
        blocks: [
          {
            startTime: "2026-06-05T13:00:00.000Z",
            endTime: "2026-06-05T13:30:00.000Z",
          },
        ],
      }),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);

    expect(res.status).toBe(200);
    // Nothing valid to write → createMany is skipped (deleteMany still clears).
    expect(mockPrisma.interviewerAvailability.createMany).not.toHaveBeenCalled();
  });
});
