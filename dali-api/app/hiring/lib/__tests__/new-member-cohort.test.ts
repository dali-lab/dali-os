import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  getNewMemberCohortIds,
  isNewMemberCohort,
} from "~/hiring/lib/new-member-cohort.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("getNewMemberCohortIds", () => {
  it("returns the userIds accepted in the latest General + Fellowship cycles", async () => {
    // Standard, then Fellowship (Promise.all preserves call order).
    mockPrisma.applicationCycle.findFirst
      .mockResolvedValueOnce({ id: "cycle-standard" })
      .mockResolvedValueOnce({ id: "cycle-fellowship" });
    mockPrisma.application.findMany.mockResolvedValue([
      { userId: "u1" },
      { userId: "u2" },
      { userId: "u1" },
    ]);

    const ids = await getNewMemberCohortIds();
    expect(ids).toEqual(new Set(["u1", "u2"]));
    expect(mockPrisma.application.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          applicationCycleId: { in: ["cycle-standard", "cycle-fellowship"] },
        }),
      }),
    );
  });

  it("returns an empty set and skips the applicant query when no cycle has accepts", async () => {
    mockPrisma.applicationCycle.findFirst.mockResolvedValue(null);
    const ids = await getNewMemberCohortIds();
    expect(ids).toEqual(new Set());
    expect(mockPrisma.application.findMany).not.toHaveBeenCalled();
  });
});

describe("isNewMemberCohort", () => {
  it("is true when the user has an accepted application in a latest cohort cycle", async () => {
    mockPrisma.applicationCycle.findFirst.mockResolvedValue({ id: "cycle-standard" });
    mockPrisma.application.findFirst.mockResolvedValue({ id: "app-1" });
    expect(await isNewMemberCohort("u1")).toBe(true);
  });

  it("is false when no cohort cycle exists", async () => {
    mockPrisma.applicationCycle.findFirst.mockResolvedValue(null);
    expect(await isNewMemberCohort("u1")).toBe(false);
    expect(mockPrisma.application.findFirst).not.toHaveBeenCalled();
  });

  it("is false when the user has no accepted application in the cohort cycles", async () => {
    mockPrisma.applicationCycle.findFirst.mockResolvedValue({ id: "cycle-standard" });
    mockPrisma.application.findFirst.mockResolvedValue(null);
    expect(await isNewMemberCohort("u1")).toBe(false);
  });
});
