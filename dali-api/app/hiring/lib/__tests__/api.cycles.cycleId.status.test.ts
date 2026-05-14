import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/roles");
vi.mock("~/hiring/lib/cycles");

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";
import { findOtherActiveCycleId } from "~/hiring/lib/cycles";
import { action } from "~/hiring/routes/api.cycles.$cycleId.status";

const mockPrisma = prisma as unknown as {
  interview: { count: ReturnType<typeof vi.fn> };
  domainApplication: { count: ReturnType<typeof vi.fn> };
  applicationCycleStatusUpdate: { create: ReturnType<typeof vi.fn> };
};

const USER_ID = "user-1";
const CYCLE_ID = "cycle-1";

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).interview = { count: vi.fn() };
  (mockPrisma as any).domainApplication = { count: vi.fn() };
  (mockPrisma as any).applicationCycleStatusUpdate = { create: vi.fn().mockResolvedValue({}) };
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: USER_ID } } as any);
  vi.mocked(isHiringLead).mockResolvedValue(true);
  vi.mocked(findOtherActiveCycleId).mockResolvedValue(null);
});

function makeRequest(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/cycles/${CYCLE_ID}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/hiring/cycles/:cycleId/status — UnderReview → Completed guard", () => {
  it("only counts Scheduled interviews as pending (cancelled interviews do not block completion)", async () => {
    mockPrisma.interview.count.mockResolvedValue(0);
    mockPrisma.domainApplication.count.mockResolvedValue(0);

    const res = await action({
      request: makeRequest({ newStatus: "Completed" }),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);

    expect(mockPrisma.interview.count).toHaveBeenCalledWith({
      where: { applicationCycleId: CYCLE_ID, status: "Scheduled" },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.currentStatus).toBe("Completed");
    expect(mockPrisma.applicationCycleStatusUpdate.create).toHaveBeenCalled();
  });

  it("blocks completion when at least one Scheduled interview remains", async () => {
    mockPrisma.interview.count.mockResolvedValue(1);
    mockPrisma.domainApplication.count.mockResolvedValue(0);

    const res = await action({
      request: makeRequest({ newStatus: "Completed" }),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.pendingInterviews).toBe(1);
    expect(mockPrisma.applicationCycleStatusUpdate.create).not.toHaveBeenCalled();
  });

  it("force=true bypasses the pending-interview check", async () => {
    const res = await action({
      request: makeRequest({ newStatus: "Completed", force: true }),
      params: { cycleId: CYCLE_ID },
      context: {},
    } as any);

    expect(mockPrisma.interview.count).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(mockPrisma.applicationCycleStatusUpdate.create).toHaveBeenCalled();
  });
});
