import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/mcp/registry", () => {
  class McpError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.name = "McpError";
      this.status = status;
    }
  }
  class McpNotFoundError extends McpError {
    constructor(message = "Not found") { super(message, 404); this.name = "McpNotFoundError"; }
  }
  class McpForbiddenError extends McpError {
    constructor(message = "Forbidden") { super(message, 403); this.name = "McpForbiddenError"; }
  }
  class McpInvalidError extends McpError {
    constructor(message = "Invalid params") { super(message, 400); this.name = "McpInvalidError"; }
  }
  return { McpError, McpNotFoundError, McpForbiddenError, McpInvalidError };
});

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, hasCycleAccess: vi.fn() };
});
vi.mock("~/hiring/lib/scheduling", () => ({
  generateCandidateSlots: vi.fn().mockReturnValue([]),
  isInterviewerFree: vi.fn().mockReturnValue(false),
}));

import { prisma } from "~/lib/db";
import { hasCycleAccess } from "~/lib/roles";
import { GET_HIRING_CYCLE_TOOL, runGetHiringCycle } from "../get-hiring-cycle";

const mockPrisma = prisma as unknown as {
  applicationCycle: { findUnique: ReturnType<typeof vi.fn> };
  interviewConfig: { findUnique: ReturnType<typeof vi.fn> };
  cycleInterviewer: { findMany: ReturnType<typeof vi.fn> };
  interview: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => vi.clearAllMocks());

const fakeCycle = {
  id: "cy1",
  name: "Fall 2026",
  cycleType: "Standard",
  closeDate: new Date("2026-10-01"),
  createdAt: new Date("2026-09-01"),
  statusUpdates: [{ newStatus: "Open" }],
  domains: [],
};

describe("get_hiring_cycle", () => {
  it("requires mcp:read scope", () => {
    expect(GET_HIRING_CYCLE_TOOL.requiredScope).toBe("mcp:read");
  });

  it("throws forbidden when caller has no cycle access", async () => {
    vi.mocked(hasCycleAccess).mockResolvedValue(false);
    await expect(
      runGetHiringCycle("u1", { cycleId: "cy1" }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("throws 404 when cycle not found", async () => {
    vi.mocked(hasCycleAccess).mockResolvedValue(true);
    mockPrisma.applicationCycle.findUnique.mockResolvedValue(null);
    await expect(
      runGetHiringCycle("u1", { cycleId: "nope" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("returns cycle data with no interview config", async () => {
    vi.mocked(hasCycleAccess).mockResolvedValue(true);
    mockPrisma.applicationCycle.findUnique.mockResolvedValue(fakeCycle);
    mockPrisma.interviewConfig.findUnique.mockResolvedValue(null);

    const result = await runGetHiringCycle("u1", { cycleId: "cy1" }) as any;
    expect(result).toMatchObject({
      id: "cy1",
      status: "Open",
      interviewConfig: null,
      coverage: { configured: false },
    });
  });

  it("returns coverage summary when interview config exists", async () => {
    vi.mocked(hasCycleAccess).mockResolvedValue(true);
    mockPrisma.applicationCycle.findUnique.mockResolvedValue(fakeCycle);
    mockPrisma.interviewConfig.findUnique.mockResolvedValue({
      id: "ic1",
      applicationCycleId: "cy1",
      slotDurationMinutes: 30,
      bufferMinutes: 15,
      dayStartHour: 9,
      dayEndHour: 18,
      interviewStartDate: new Date("2026-10-10"),
      interviewEndDate: new Date("2026-10-20"),
      timezone: "America/New_York",
      rescheduleNoticeHours: 12,
      cancelNoticeHours: 0,
      bookingNoticeHours: 12,
    });
    mockPrisma.cycleInterviewer.findMany.mockResolvedValue([]);
    mockPrisma.interview.findMany.mockResolvedValue([]);

    const result = await runGetHiringCycle("u1", { cycleId: "cy1" }) as any;
    expect(result.coverage).toMatchObject({ configured: true, totalInterviewers: 0 });
    expect(result.interviewConfig).toMatchObject({ slotDurationMinutes: 30 });
  });
});
