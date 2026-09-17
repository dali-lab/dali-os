import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/gmail", () => ({ sendEmail: vi.fn() }));
vi.mock("~/lib/gmail-integration", () => ({
  getSender: vi.fn().mockResolvedValue(null),
  noteSenderHealth: vi.fn(),
}));

import { prisma } from "~/lib/db";
import {
  certificateEligibility,
  closeOutOffering,
  reopenOffering,
} from "~/education/lib/certificates.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
> & {
  $transaction: ReturnType<typeof vi.fn>;
  $queryRaw: ReturnType<typeof vi.fn>;
};

describe("certificateEligibility", () => {
  it("passes a miniseries exactly at the 80% boundary", () => {
    expect(
      certificateEligibility({ type: "Miniseries", totalSessions: 5, present: 4, excused: 0 }),
    ).toBe(true);
    expect(
      certificateEligibility({ type: "Miniseries", totalSessions: 5, present: 3, excused: 0 }),
    ).toBe(false);
  });

  it("counts excused toward completion", () => {
    expect(
      certificateEligibility({ type: "Miniseries", totalSessions: 5, present: 3, excused: 1 }),
    ).toBe(true);
  });

  it("workshops need a single Present mark", () => {
    expect(
      certificateEligibility({ type: "Workshop", totalSessions: 1, present: 1, excused: 0 }),
    ).toBe(true);
    expect(
      certificateEligibility({ type: "Workshop", totalSessions: 1, present: 0, excused: 1 }),
    ).toBe(false);
  });

  it("no sessions → not eligible", () => {
    expect(
      certificateEligibility({ type: "Workshop", totalSessions: 0, present: 0, excused: 0 }),
    ).toBe(false);
  });

  it("uses a non-default threshold when provided", () => {
    // 3/6 = 50%, which is below 80% but passes a 50% threshold.
    expect(
      certificateEligibility({
        type: "Miniseries",
        totalSessions: 6,
        present: 3,
        excused: 0,
        threshold: 0.5,
      }),
    ).toBe(true);
    // 2/6 ≈ 33%, still below 50%.
    expect(
      certificateEligibility({
        type: "Miniseries",
        totalSessions: 6,
        present: 2,
        excused: 0,
        threshold: 0.5,
      }),
    ).toBe(false);
  });

  it("defaults to 80% when threshold is omitted", () => {
    // Matches the existing boundary test — explicit check that omitting threshold
    // is identical to passing 0.8.
    expect(
      certificateEligibility({ type: "Miniseries", totalSessions: 5, present: 4, excused: 0 }),
    ).toBe(
      certificateEligibility({
        type: "Miniseries",
        totalSessions: 5,
        present: 4,
        excused: 0,
        threshold: 0.8,
      }),
    );
  });
});

describe("closeOutOffering", () => {
  const applicant = {
    id: "user-1",
    firstName: "Ada",
    daliEmail: null,
    dartmouthEmail: null,
    personalEmail: null,
    netId: "f00xyz",
  };

  function offeringRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "off-1",
      title: "Test Workshop",
      type: "Workshop",
      closedOutAt: null,
      completionThreshold: 0.8,
      _count: { sessions: 1 },
      applications: [
        {
          id: "app-1",
          attendances: [{ status: "Present" }],
          certificate: null,
          applicant,
        },
        {
          id: "app-2",
          attendances: [{ status: "Absent" }],
          certificate: null,
          applicant: { ...applicant, id: "user-2" },
        },
      ],
      instructors: [{ userId: "instr-1" }],
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    // Teaching-credit grants + the closedOutAt stamp run inside a $transaction
    // under the offering row lock; drive the callback with the mock client.
    mockPrisma.$transaction.mockImplementation(async (fn: unknown) =>
      typeof fn === "function"
        ? (fn as (tx: unknown) => Promise<unknown>)(mockPrisma)
        : Promise.all(fn as Promise<unknown>[]),
    );
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.educationCertificate.create.mockResolvedValue({ id: "cert-1" });
    mockPrisma.educationOffering.update.mockResolvedValue({});
    mockPrisma.cECredit.create.mockResolvedValue({});
    mockPrisma.notification.create.mockResolvedValue({});
    mockPrisma.term.findFirst.mockResolvedValue({ id: "term-1" });
  });

  it("issues to eligible students only and reports counts", async () => {
    mockPrisma.educationOffering.findUnique.mockResolvedValue(offeringRow());

    const result = await closeOutOffering({ offeringId: "off-1", actorId: "core-1" });

    expect(result).toEqual({ ok: true, issued: 1, alreadyIssued: 0, ineligible: 1 });
    expect(mockPrisma.educationCertificate.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.educationCertificate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { applicationId: "app-1", issuedById: "core-1" },
      }),
    );
  });

  it("is idempotent — re-running skips existing certificates", async () => {
    mockPrisma.educationOffering.findUnique.mockResolvedValue(
      offeringRow({
        closedOutAt: new Date(),
        applications: [
          {
            id: "app-1",
            attendances: [{ status: "Present" }],
            certificate: { id: "cert-1" },
            applicant,
          },
        ],
      }),
    );

    const result = await closeOutOffering({ offeringId: "off-1", actorId: "core-1" });

    expect(result).toEqual({ ok: true, issued: 0, alreadyIssued: 1, ineligible: 0 });
    expect(mockPrisma.educationCertificate.create).not.toHaveBeenCalled();
    // Instructor CE credits only granted on the FIRST close-out.
    expect(mockPrisma.cECredit.create).not.toHaveBeenCalled();
  });

  it("grants instructor CE credits on first close-out only", async () => {
    mockPrisma.educationOffering.findUnique.mockResolvedValue(offeringRow());

    await closeOutOffering({ offeringId: "off-1", actorId: "core-1" });

    expect(mockPrisma.cECredit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "instr-1",
          reason: "Taught Test Workshop",
        }),
      }),
    );
  });

  it("refuses to close out before the offering has finished", async () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    mockPrisma.educationOffering.findUnique.mockResolvedValue(
      offeringRow({ endsAt: future }),
    );

    const result = await closeOutOffering({ offeringId: "off-1", actorId: "core-1" });

    expect(result).toMatchObject({ status: 409 });
    expect(mockPrisma.educationCertificate.create).not.toHaveBeenCalled();
  });

  it("closes out early when allowEarly is set", async () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    mockPrisma.educationOffering.findUnique.mockResolvedValue(
      offeringRow({ endsAt: future }),
    );

    const result = await closeOutOffering({
      offeringId: "off-1",
      actorId: "core-1",
      allowEarly: true,
    });

    expect(result).toEqual({ ok: true, issued: 1, alreadyIssued: 0, ineligible: 1 });
  });

  it("closes out a finished offering without allowEarly", async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    mockPrisma.educationOffering.findUnique.mockResolvedValue(
      offeringRow({ endsAt: past }),
    );

    const result = await closeOutOffering({ offeringId: "off-1", actorId: "core-1" });

    expect(result).toEqual({ ok: true, issued: 1, alreadyIssued: 0, ineligible: 1 });
  });
});

describe("reopenOffering", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("clears closedOutAt/closedOutById", async () => {
    mockPrisma.educationOffering.findUnique.mockResolvedValue({
      id: "off-1",
      closedOutAt: new Date(),
    });
    mockPrisma.educationOffering.update.mockResolvedValue({});

    const result = await reopenOffering({ offeringId: "off-1", actorId: "core-1" });

    expect(result).toEqual({ ok: true });
    expect(mockPrisma.educationOffering.update).toHaveBeenCalledWith({
      where: { id: "off-1" },
      data: { closedOutAt: null, closedOutById: null },
    });
  });

  it("is a no-op when the offering was never closed out", async () => {
    mockPrisma.educationOffering.findUnique.mockResolvedValue({
      id: "off-1",
      closedOutAt: null,
    });

    const result = await reopenOffering({ offeringId: "off-1", actorId: "core-1" });

    expect(result).toEqual({ ok: true });
    expect(mockPrisma.educationOffering.update).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing offering", async () => {
    mockPrisma.educationOffering.findUnique.mockResolvedValue(null);

    const result = await reopenOffering({ offeringId: "gone", actorId: "core-1" });

    expect(result).toMatchObject({ status: 404 });
    expect(mockPrisma.educationOffering.update).not.toHaveBeenCalled();
  });
});
