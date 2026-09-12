import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    dALIMember: {
      updateMany: vi.fn(),
    },
  },
}));

import { prisma } from "~/lib/db";
import {
  runCompleteOnboardingTour,
  COMPLETE_ONBOARDING_TOUR_DEF,
} from "~/mcp/tools/personal/complete-onboarding-tour";

const mockPrisma = prisma as unknown as {
  dALIMember: { updateMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("complete_onboarding_tour", () => {
  it("requires mcp:write scope", () => {
    expect(COMPLETE_ONBOARDING_TOUR_DEF.requiredScope).toBe("mcp:write");
  });

  it("marks the tour completed for the caller's member row", async () => {
    mockPrisma.dALIMember.updateMany.mockResolvedValue({ count: 1 });
    const out = await runCompleteOnboardingTour("u-alice");
    expect(out).toEqual({ ok: true });
    expect(mockPrisma.dALIMember.updateMany).toHaveBeenCalledWith({
      where: { userId: "u-alice", tourCompletedAt: null },
      data: { tourCompletedAt: expect.any(Date) },
    });
  });

  it("is idempotent — no-op when tour is already completed (updateMany count=0)", async () => {
    mockPrisma.dALIMember.updateMany.mockResolvedValue({ count: 0 });
    const out = await runCompleteOnboardingTour("u-alice");
    expect(out).toEqual({ ok: true });
    // updateMany is still called (the where clause filters it out server-side).
    expect(mockPrisma.dALIMember.updateMany).toHaveBeenCalled();
  });
});
