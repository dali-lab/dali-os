import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { parseLevel } from "~/admin/lib/eligibility";
import {
  addOrUpdateEligibility,
  removeEligibility,
} from "~/admin/lib/eligibility.server";

const mockPrisma = prisma as unknown as {
  domainEligibility: {
    upsert: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).domainEligibility = {
    upsert: vi.fn().mockResolvedValue({ id: "e1" }),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
});

describe("parseLevel", () => {
  it("accepts the three valid levels", () => {
    expect(parseLevel("P1")).toBe("P1");
    expect(parseLevel("P2")).toBe("P2");
    expect(parseLevel("P3")).toBe("P3");
  });

  it("rejects unknown values, numbers, and missing input", () => {
    expect(parseLevel("P0")).toBeNull();
    expect(parseLevel("p1")).toBeNull();
    expect(parseLevel(null)).toBeNull();
    expect(parseLevel(undefined)).toBeNull();
    expect(parseLevel(2)).toBeNull();
  });
});

describe("addOrUpdateEligibility", () => {
  it("upserts on (userId, domainId) and stamps promotedBy with the actor", async () => {
    await addOrUpdateEligibility({
      userId: "u1",
      domainId: "d1",
      level: "P2",
      actorId: "actor-1",
    });
    expect(mockPrisma.domainEligibility.upsert).toHaveBeenCalledTimes(1);
    const args = mockPrisma.domainEligibility.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ userId_domainId: { userId: "u1", domainId: "d1" } });
    expect(args.update.level).toBe("P2");
    expect(args.update.promotedBy).toBe("actor-1");
    expect(args.update.promotedAt).toBeInstanceOf(Date);
    expect(args.create).toMatchObject({
      userId: "u1",
      domainId: "d1",
      level: "P2",
      promotedBy: "actor-1",
    });
  });
});

describe("removeEligibility", () => {
  it("deletes by row id", async () => {
    await removeEligibility({ id: "e1" });
    expect(mockPrisma.domainEligibility.deleteMany).toHaveBeenCalledWith({
      where: { id: "e1" },
    });
  });
});
