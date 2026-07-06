import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { submitApplication } from "~/education/lib/apply.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
> & {
  $transaction: ReturnType<typeof vi.fn>;
  $queryRaw: ReturnType<typeof vi.fn>;
};

const HOUR = 60 * 60 * 1000;
const now = Date.now();

function offeringRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "off-1",
    status: "Published",
    requiresReview: false,
    capacity: 2,
    registrationOpensAt: new Date(now - HOUR),
    registrationClosesAt: new Date(now + HOUR),
    ...overrides,
  };
}

const QUESTIONS = [
  { key: "q1", type: "text", required: true, data: { label: "Why?" } },
];

function formRow() {
  return {
    applicationForm: {
      id: "form-1",
      name: "Test — Application",
      versions: [{ id: "ver-1", questions: QUESTIONS, intro: null }],
    },
  };
}

beforeEach(() => {
  // resetAllMocks (not clearAllMocks): tests that return early leave unread
  // mockResolvedValueOnce values queued, which clearAllMocks would keep.
  vi.resetAllMocks();
  // Interactive transaction: run the callback against the same mock client.
  mockPrisma.$transaction.mockImplementation(async (fn: unknown) =>
    typeof fn === "function"
      ? (fn as (tx: unknown) => Promise<unknown>)(mockPrisma)
      : Promise.all(fn as Promise<unknown>[]),
  );
  mockPrisma.$queryRaw.mockResolvedValue([]);
  mockPrisma.formSubmission.create.mockResolvedValue({ id: "sub-1" });
  mockPrisma.educationApplication.create.mockResolvedValue({ id: "app-1" });
  mockPrisma.educationApplication.findUnique.mockResolvedValue(null);
  mockPrisma.educationApplication.count.mockResolvedValue(0);
  mockPrisma.educationApplication.findFirst.mockResolvedValue(null);
});

function primeOfferingAndForm(offering: Record<string, unknown>) {
  // submitApplication reads the offering row first, then
  // loadOfferingApplicationForm re-queries for the bound form.
  mockPrisma.educationOffering.findUnique
    .mockResolvedValueOnce(offering)
    .mockResolvedValueOnce(formRow());
}

describe("submitApplication", () => {
  it("auto-approves an RSVP under capacity", async () => {
    primeOfferingAndForm(offeringRow());
    mockPrisma.educationApplication.count.mockResolvedValue(1); // 1 of 2 seats

    const res = await submitApplication({
      offeringId: "off-1",
      userId: "user-1",
      answers: { q1: "hi" },
    });

    expect(res).toEqual({ ok: true, status: "Approved" });
    expect(mockPrisma.educationApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "Approved", waitlistRank: null }),
      }),
    );
  });

  it("waitlists past capacity with the next FIFO rank", async () => {
    primeOfferingAndForm(offeringRow());
    mockPrisma.educationApplication.count.mockResolvedValue(2); // full
    mockPrisma.educationApplication.findFirst.mockResolvedValue({ waitlistRank: 4 });

    const res = await submitApplication({
      offeringId: "off-1",
      userId: "user-1",
      answers: { q1: "hi" },
    });

    expect(res).toEqual({ ok: true, status: "Waitlisted" });
    expect(mockPrisma.educationApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "Waitlisted", waitlistRank: 5 }),
      }),
    );
  });

  it("leaves review-required applications as Submitted", async () => {
    primeOfferingAndForm(offeringRow({ requiresReview: true }));

    const res = await submitApplication({
      offeringId: "off-1",
      userId: "user-1",
      answers: { q1: "hi" },
    });

    expect(res).toEqual({ ok: true, status: "Submitted" });
    // The seat count must not even be consulted for review-required offerings.
    expect(mockPrisma.educationApplication.count).not.toHaveBeenCalled();
  });

  it("rejects when the registration window is closed", async () => {
    primeOfferingAndForm(
      offeringRow({ registrationClosesAt: new Date(now - HOUR / 2) }),
    );

    const res = await submitApplication({
      offeringId: "off-1",
      userId: "user-1",
      answers: { q1: "hi" },
    });

    expect(res).toMatchObject({ status: 400 });
    expect(mockPrisma.educationApplication.create).not.toHaveBeenCalled();
  });

  it("rejects unpublished offerings", async () => {
    primeOfferingAndForm(offeringRow({ status: "Draft" }));

    const res = await submitApplication({
      offeringId: "off-1",
      userId: "user-1",
      answers: { q1: "hi" },
    });

    expect(res).toMatchObject({ status: 400 });
  });

  it("rejects a second application once decided", async () => {
    primeOfferingAndForm(offeringRow());
    mockPrisma.educationApplication.findUnique.mockResolvedValue({
      id: "app-1",
      status: "Approved",
      formSubmissionId: "sub-1",
    });

    const res = await submitApplication({
      offeringId: "off-1",
      userId: "user-1",
      answers: { q1: "hi" },
    });

    expect(res).toMatchObject({ status: 409 });
  });

  it("enforces required questions", async () => {
    primeOfferingAndForm(offeringRow());

    const res = await submitApplication({
      offeringId: "off-1",
      userId: "user-1",
      answers: {},
    });

    expect(res).toMatchObject({ status: 400 });
    expect(String((res as { error: string }).error)).toContain("required");
  });

  it("re-applies a withdrawn applicant through the decision branch", async () => {
    primeOfferingAndForm(offeringRow());
    mockPrisma.educationApplication.findUnique.mockResolvedValue({
      id: "app-1",
      status: "Withdrawn",
      formSubmissionId: "sub-1",
    });
    mockPrisma.educationApplication.count.mockResolvedValue(0);

    const res = await submitApplication({
      offeringId: "off-1",
      userId: "user-1",
      answers: { q1: "hi" },
    });

    expect(res).toEqual({ ok: true, status: "Approved" });
    expect(mockPrisma.educationApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "app-1" },
        data: expect.objectContaining({ status: "Approved" }),
      }),
    );
  });
});
