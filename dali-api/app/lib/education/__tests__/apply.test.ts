import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/education/email", () => ({
  sendApplicationSubmittedEmail: vi.fn().mockResolvedValue(undefined),
  sendDecisionEmail: vi.fn().mockResolvedValue(undefined),
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
import { apply } from "~/lib/education/apply";

const mockPrisma = prisma as unknown as {
  educationOffering: { findUnique: ReturnType<typeof vi.fn> };
  educationApplication: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  educationApplicationAnswer: {
    createMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  user: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const future = (offsetMs: number) => new Date(Date.now() + offsetMs);
const past = (offsetMs: number) => new Date(Date.now() - offsetMs);

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma));
  mockPrisma.user.findUnique.mockResolvedValue({
    firstName: "Bo",
    daliEmail: null,
    dartmouthEmail: "bo@dartmouth",
  });
});

describe("apply()", () => {
  it("auto-approves up to capacity when review is not required", async () => {
    mockPrisma.educationOffering.findUnique.mockResolvedValue({
      id: "off-1",
      title: "Workshop",
      status: "Published",
      capacity: 2,
      requiresReview: false,
      registrationOpensAt: past(60_000),
      registrationClosesAt: future(60_000),
      applicationQuestions: [],
    });
    mockPrisma.educationApplication.findUnique.mockResolvedValue(null);
    mockPrisma.educationApplication.count.mockResolvedValue(0);
    mockPrisma.educationApplication.create.mockResolvedValue({
      id: "app-1",
      status: "Approved",
    });

    const outcome = await apply({
      offeringId: "off-1",
      applicantUserId: "u-1",
      answers: {},
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.status).toBe("Approved");
    }
    expect(mockPrisma.educationApplication.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "Approved" }),
    });
  });

  it("waitlists when capacity is full", async () => {
    mockPrisma.educationOffering.findUnique.mockResolvedValue({
      id: "off-1",
      title: "Workshop",
      status: "Published",
      capacity: 2,
      requiresReview: false,
      registrationOpensAt: past(60_000),
      registrationClosesAt: future(60_000),
      applicationQuestions: [],
    });
    mockPrisma.educationApplication.findUnique.mockResolvedValue(null);
    mockPrisma.educationApplication.count.mockResolvedValue(2);
    mockPrisma.educationApplication.create.mockResolvedValue({
      id: "app-1",
      status: "Waitlisted",
    });

    const outcome = await apply({
      offeringId: "off-1",
      applicantUserId: "u-3",
      answers: {},
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result.status).toBe("Waitlisted");
  });

  it("leaves status at Submitted when review is required", async () => {
    mockPrisma.educationOffering.findUnique.mockResolvedValue({
      id: "off-2",
      title: "Miniseries",
      status: "Published",
      capacity: 5,
      requiresReview: true,
      registrationOpensAt: past(60_000),
      registrationClosesAt: future(60_000),
      applicationQuestions: [],
    });
    mockPrisma.educationApplication.findUnique.mockResolvedValue(null);
    mockPrisma.educationApplication.create.mockResolvedValue({
      id: "app-2",
      status: "Submitted",
    });

    const outcome = await apply({
      offeringId: "off-2",
      applicantUserId: "u-1",
      answers: {},
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result.status).toBe("Submitted");
  });

  it("rejects re-apply when the existing application is still active", async () => {
    mockPrisma.educationOffering.findUnique.mockResolvedValue({
      id: "off-1",
      title: "Workshop",
      status: "Published",
      capacity: 2,
      requiresReview: false,
      registrationOpensAt: past(60_000),
      registrationClosesAt: future(60_000),
      applicationQuestions: [],
    });
    mockPrisma.educationApplication.findUnique.mockResolvedValue({
      id: "app-existing",
      status: "Approved",
    });
    mockPrisma.educationApplication.count.mockResolvedValue(0);

    const outcome = await apply({
      offeringId: "off-1",
      applicantUserId: "u-1",
      answers: {},
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result.status).toBe("Approved");
    expect(mockPrisma.educationApplication.create).not.toHaveBeenCalled();
  });

  it("flags missing required answer", async () => {
    mockPrisma.educationOffering.findUnique.mockResolvedValue({
      id: "off-3",
      title: "Series",
      status: "Published",
      capacity: 5,
      requiresReview: true,
      registrationOpensAt: past(60_000),
      registrationClosesAt: future(60_000),
      applicationQuestions: [
        { id: "q-1", prompt: "Why?", position: 0, required: true },
      ],
    });

    const outcome = await apply({
      offeringId: "off-3",
      applicantUserId: "u-1",
      answers: {},
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.kind).toBe("MissingRequiredAnswer");
    }
  });

  it("rejects an unpublished offering", async () => {
    mockPrisma.educationOffering.findUnique.mockResolvedValue({
      id: "off-9",
      title: "Draft",
      status: "Draft",
      capacity: 1,
      requiresReview: false,
      registrationOpensAt: past(60_000),
      registrationClosesAt: future(60_000),
      applicationQuestions: [],
    });

    const outcome = await apply({
      offeringId: "off-9",
      applicantUserId: "u-1",
      answers: {},
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.kind).toBe("OfferingNotPublished");
  });
});
