import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
// promoteToMember delegates eligibility to addOrUpdateEligibility — stub it so
// this test stays focused on the membership upsert behavior.
vi.mock("~/admin/lib/eligibility.server", () => ({
  addOrUpdateEligibility: vi.fn().mockResolvedValue({ id: "e1" }),
}));

import { prisma } from "~/lib/db";
import { promoteToMember } from "~/members/lib/membership.server";
import { addOrUpdateEligibility } from "~/admin/lib/eligibility.server";

const mockPrisma = prisma as unknown as {
  dALIMember: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).dALIMember = {
    findUnique: vi.fn(),
    create: vi.fn().mockResolvedValue({ id: "m1" }),
  };
});

describe("promoteToMember", () => {
  it("creates a DALIMember when none exists", async () => {
    mockPrisma.dALIMember.findUnique.mockResolvedValue(null);
    const res = await promoteToMember({ userId: "u1", actorId: "actor" });
    expect(mockPrisma.dALIMember.create).toHaveBeenCalledWith({
      data: { userId: "u1" },
    });
    expect(res.created).toBe(true);
  });

  it("is idempotent — no create when the member already exists", async () => {
    mockPrisma.dALIMember.findUnique.mockResolvedValue({ id: "m1" });
    const res = await promoteToMember({ userId: "u1", actorId: "actor" });
    expect(mockPrisma.dALIMember.create).not.toHaveBeenCalled();
    expect(res.created).toBe(false);
  });

  it("grants eligibility when a domain + level are given", async () => {
    mockPrisma.dALIMember.findUnique.mockResolvedValue(null);
    await promoteToMember({
      userId: "u1",
      domainId: "d1",
      level: "P1",
      actorId: "actor",
    });
    expect(addOrUpdateEligibility).toHaveBeenCalledWith({
      userId: "u1",
      domainId: "d1",
      level: "P1",
      actorId: "actor",
    });
  });

  it("skips eligibility when no domain/level given", async () => {
    mockPrisma.dALIMember.findUnique.mockResolvedValue({ id: "m1" });
    await promoteToMember({ userId: "u1", actorId: "actor" });
    expect(addOrUpdateEligibility).not.toHaveBeenCalled();
  });
});
