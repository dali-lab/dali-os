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
  dALIMember: { findFirst: ReturnType<typeof vi.fn> };
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
  (mockPrisma as any).dALIMember = {
    findFirst: vi.fn().mockResolvedValue({ id: "m1" }),
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
