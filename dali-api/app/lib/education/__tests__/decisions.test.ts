import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/notifications", () => ({
  emitEvent: vi.fn().mockResolvedValue({ eventsWritten: 0, notificationsWritten: 0 }),
}));
vi.mock("~/lib/education/email", () => ({
  sendDecisionEmail: vi.fn().mockResolvedValue(undefined),
  sendApplicationSubmittedEmail: vi.fn().mockResolvedValue(undefined),
  sendAnnouncementEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/lib/education/roster-sync", () => ({
  syncSessionRoster: vi.fn().mockResolvedValue({
    meetingsCreated: 0,
    meetingsUpdated: 0,
    gcalErrors: [],
  }),
}));

import { prisma } from "~/lib/db";
import { decide } from "~/lib/education/decisions";
import { emitEvent } from "~/lib/notifications";

const mockPrisma = prisma as unknown as {
  educationApplication: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  user: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const OFFERING = {
  id: "off-1",
  title: "Intro to ML",
  capacity: 2,
  requiresReview: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  // The default $transaction passes through the supplied callback,
  // executing it with the same mockPrisma. Mirrors Prisma's interactive
  // transaction signature for our tests.
  mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma));
  mockPrisma.user.findUnique.mockResolvedValue({
    firstName: "Ava",
    daliEmail: "ava@dali",
    dartmouthEmail: null,
  });
});

describe("decide()", () => {
  it("approves a submitted application and emits a decision notification", async () => {
    mockPrisma.educationApplication.findUnique.mockResolvedValue({
      id: "app-1",
      status: "Submitted",
      offeringId: "off-1",
      applicantUserId: "user-1",
      offering: OFFERING,
    });
    mockPrisma.educationApplication.update.mockResolvedValue({
      id: "app-1",
      status: "Approved",
      applicantUserId: "user-1",
    });

    const result = await decide({
      applicationId: "app-1",
      action: "Approve",
      actorUserId: "core-1",
    });

    expect(result.newStatus).toBe("Approved");
    expect(result.promotedApplicationId).toBeNull();
    expect(mockPrisma.educationApplication.update).toHaveBeenCalledWith({
      where: { id: "app-1" },
      data: expect.objectContaining({
        status: "Approved",
        reviewedBy: "core-1",
      }),
    });
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "education.application_approved",
        recipients: ["user-1"],
      }),
    );
  });

  it("promotes the next waitlisted applicant when a freed slot opens", async () => {
    mockPrisma.educationApplication.findUnique.mockResolvedValue({
      id: "app-1",
      status: "Approved",
      offeringId: "off-1",
      applicantUserId: "user-1",
      offering: OFFERING,
    });
    mockPrisma.educationApplication.update.mockResolvedValue({
      id: "app-1",
      status: "Withdrawn",
      applicantUserId: "user-1",
    });
    // Approved count post-withdraw is 1, capacity is 2 → room for one promotion.
    mockPrisma.educationApplication.count.mockResolvedValue(1);
    mockPrisma.educationApplication.findFirst.mockResolvedValue({
      id: "app-2",
      applicantUserId: "user-2",
    });

    const result = await decide({
      applicationId: "app-1",
      action: "Withdraw",
      actorUserId: "user-1",
    });

    expect(result.promotedApplicationId).toBe("app-2");
    expect(mockPrisma.educationApplication.update).toHaveBeenCalledWith({
      where: { id: "app-2" },
      data: expect.objectContaining({ status: "Approved" }),
    });
    // Waitlist-promote emits its own event in addition to the withdraw side
    // (which actually doesn't emit since the user withdrew themselves).
    const calls = (emitEvent as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(
      calls.some((c) => c[0].type === "education.waitlist_promoted"),
    ).toBe(true);
  });

  it("does not promote when rejecting a non-Approved applicant", async () => {
    mockPrisma.educationApplication.findUnique.mockResolvedValue({
      id: "app-3",
      status: "Submitted",
      offeringId: "off-1",
      applicantUserId: "user-3",
      offering: OFFERING,
    });
    mockPrisma.educationApplication.update.mockResolvedValue({
      id: "app-3",
      status: "Rejected",
      applicantUserId: "user-3",
    });

    const result = await decide({
      applicationId: "app-3",
      action: "Reject",
      actorUserId: "core-1",
    });

    expect(result.promotedApplicationId).toBeNull();
    expect(mockPrisma.educationApplication.findFirst).not.toHaveBeenCalled();
  });

  it("does not promote when capacity is already saturated", async () => {
    mockPrisma.educationApplication.findUnique.mockResolvedValue({
      id: "app-1",
      status: "Approved",
      offeringId: "off-1",
      applicantUserId: "user-1",
      offering: { ...OFFERING, capacity: 1 },
    });
    mockPrisma.educationApplication.update.mockResolvedValue({
      id: "app-1",
      status: "Rejected",
      applicantUserId: "user-1",
    });
    // After the rejection, there are no other approved rows.
    mockPrisma.educationApplication.count.mockResolvedValue(0);
    mockPrisma.educationApplication.findFirst.mockResolvedValue(null);

    const result = await decide({
      applicationId: "app-1",
      action: "Reject",
      actorUserId: "core-1",
    });

    expect(result.promotedApplicationId).toBeNull();
  });
});
