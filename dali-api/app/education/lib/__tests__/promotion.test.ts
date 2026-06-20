import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    educationOffering: { findUnique: vi.fn() },
    educationApplication: {
      count: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "~/lib/db";
import { promoteFromWaitlist } from "../promotion.server";

const p = prisma as unknown as {
  educationOffering: { findUnique: ReturnType<typeof vi.fn> };
  educationApplication: {
    count: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("promoteFromWaitlist", () => {
  it("returns null fields when offering has no remaining capacity", async () => {
    p.educationOffering.findUnique.mockResolvedValue({ id: "o1", capacity: 5 });
    p.educationApplication.count.mockResolvedValue(5);

    const result = await promoteFromWaitlist("o1");

    expect(result).toEqual({ promotedApplicationId: null, promotedUserId: null });
    expect(p.educationApplication.update).not.toHaveBeenCalled();
  });

  it("returns null when no waitlisted applicants remain", async () => {
    p.educationOffering.findUnique.mockResolvedValue({ id: "o1", capacity: 5 });
    p.educationApplication.count.mockResolvedValue(4);
    p.educationApplication.findFirst.mockResolvedValue(null);

    const result = await promoteFromWaitlist("o1");

    expect(result).toEqual({ promotedApplicationId: null, promotedUserId: null });
    expect(p.educationApplication.update).not.toHaveBeenCalled();
  });

  it("promotes the FIFO-oldest waitlisted applicant when a seat is free", async () => {
    p.educationOffering.findUnique.mockResolvedValue({ id: "o1", capacity: 5 });
    p.educationApplication.count.mockResolvedValue(4);
    p.educationApplication.findFirst.mockResolvedValue({ id: "a1", applicantUserId: "u1" });
    p.educationApplication.update.mockResolvedValue({ id: "a1" });

    const result = await promoteFromWaitlist("o1");

    expect(p.educationApplication.findFirst).toHaveBeenCalledWith({
      where: { offeringId: "o1", status: "Waitlisted" },
      orderBy: [
        { waitlistRank: { sort: "asc", nulls: "last" } },
        { submittedAt: "asc" },
      ],
      select: { id: true, applicantUserId: true },
    });
    expect(p.educationApplication.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: expect.objectContaining({ status: "Approved" }),
    });
    expect(result).toEqual({ promotedApplicationId: "a1", promotedUserId: "u1" });
  });

  it("returns null when the offering doesn't exist", async () => {
    p.educationOffering.findUnique.mockResolvedValue(null);

    const result = await promoteFromWaitlist("missing");

    expect(result).toEqual({ promotedApplicationId: null, promotedUserId: null });
  });
});
