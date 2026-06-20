import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    educationOffering: { findUnique: vi.fn() },
    educationApplicationQuestion: { findMany: vi.fn() },
    educationApplication: {
      count: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    educationApplicationAnswer: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));

import { prisma } from "~/lib/db";
import { submitApplication } from "../applications-data";

const p = prisma as unknown as {
  educationOffering: { findUnique: ReturnType<typeof vi.fn> };
  educationApplicationQuestion: { findMany: ReturnType<typeof vi.fn> };
  educationApplication: {
    count: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
  educationApplicationAnswer: {
    deleteMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
  };
};

const openOffering = (overrides: Partial<{
  capacity: number;
  requiresReview: boolean;
}> = {}) => ({
  id: "o1",
  status: "Published" as const,
  capacity: 10,
  requiresReview: false,
  registrationOpensAt: new Date(Date.now() - 24 * 3600_000),
  registrationClosesAt: new Date(Date.now() + 24 * 3600_000),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  p.educationApplication.upsert.mockResolvedValue({ id: "newapp", status: "Submitted" });
  p.educationApplicationQuestion.findMany.mockResolvedValue([]);
});

describe("submitApplication", () => {
  it("auto-approves an RSVP workshop with seats remaining", async () => {
    p.educationOffering.findUnique.mockResolvedValue(openOffering({ requiresReview: false, capacity: 5 }));
    p.educationApplication.count.mockResolvedValue(2);
    p.educationApplication.findUnique.mockResolvedValue(null);

    const result = await submitApplication({ applicantUserId: "u1", offeringId: "o1", answers: [] });

    expect(result.status).toBe("Approved");
    expect(p.educationApplication.upsert).toHaveBeenCalled();
  });

  it("waitlists an RSVP workshop that is full", async () => {
    p.educationOffering.findUnique.mockResolvedValue(openOffering({ requiresReview: false, capacity: 5 }));
    p.educationApplication.count.mockResolvedValue(5);
    p.educationApplication.findUnique.mockResolvedValue(null);

    const result = await submitApplication({ applicantUserId: "u1", offeringId: "o1", answers: [] });

    expect(result.status).toBe("Waitlisted");
  });

  it("leaves a review-required miniseries in Submitted regardless of capacity", async () => {
    p.educationOffering.findUnique.mockResolvedValue(openOffering({ requiresReview: true, capacity: 5 }));
    p.educationApplication.count.mockResolvedValue(0);
    p.educationApplication.findUnique.mockResolvedValue(null);

    const result = await submitApplication({ applicantUserId: "u1", offeringId: "o1", answers: [] });

    expect(result.status).toBe("Submitted");
  });

  it("rejects when registration is closed", async () => {
    p.educationOffering.findUnique.mockResolvedValue({
      ...openOffering(),
      registrationOpensAt: new Date(Date.now() - 48 * 3600_000),
      registrationClosesAt: new Date(Date.now() - 24 * 3600_000),
    });

    await expect(
      submitApplication({ applicantUserId: "u1", offeringId: "o1", answers: [] }),
    ).rejects.toThrow(/closed/);
  });

  it("rejects an unpublished offering", async () => {
    p.educationOffering.findUnique.mockResolvedValue({ ...openOffering(), status: "Draft" });

    await expect(
      submitApplication({ applicantUserId: "u1", offeringId: "o1", answers: [] }),
    ).rejects.toThrow();
  });

  it("rejects when a required question is unanswered", async () => {
    p.educationOffering.findUnique.mockResolvedValue(openOffering());
    p.educationApplicationQuestion.findMany.mockResolvedValue([
      { id: "q1", prompt: "Why?", required: true },
    ]);
    p.educationApplication.count.mockResolvedValue(0);
    p.educationApplication.findUnique.mockResolvedValue(null);

    await expect(
      submitApplication({
        applicantUserId: "u1",
        offeringId: "o1",
        answers: [{ questionId: "q1", content: "" }],
      }),
    ).rejects.toThrow(/requires an answer/);
  });
});
