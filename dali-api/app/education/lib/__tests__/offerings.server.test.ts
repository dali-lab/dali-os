import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));

import { prisma } from "~/lib/db";
import { recomputeOfferingDates } from "~/education/lib/offerings.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

describe("recomputeOfferingDates", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockPrisma.term = { findFirst: vi.fn().mockResolvedValue(null) };
    mockPrisma.educationOffering = { update: vi.fn().mockResolvedValue({}) };
  });

  it("sets all three to null when the offering has no sessions", async () => {
    mockPrisma.educationSession = {
      findMany: vi.fn().mockResolvedValue([]),
    };

    await recomputeOfferingDates("off-1");

    expect(mockPrisma.educationOffering.update).toHaveBeenCalledWith({
      where: { id: "off-1" },
      data: { startsAt: null, endsAt: null, termId: null },
    });
  });

  it("derives startsAt from the first session and endsAt from the last", async () => {
    const first = new Date("2026-09-01T14:00:00Z");
    const second = new Date("2026-09-08T14:00:00Z");
    const third = new Date("2026-09-15T14:00:00Z");
    mockPrisma.educationSession = {
      findMany: vi.fn().mockResolvedValue([
        { datetime: first },
        { datetime: second },
        { datetime: third },
      ]),
    };
    const termId = "term-26f";
    mockPrisma.term.findFirst.mockResolvedValue({ id: termId });

    await recomputeOfferingDates("off-1");

    expect(mockPrisma.educationOffering.update).toHaveBeenCalledWith({
      where: { id: "off-1" },
      data: { startsAt: first, endsAt: third, termId },
    });
  });

  it("sets termId null when no term window matches", async () => {
    const datetime = new Date("2030-01-01T14:00:00Z");
    mockPrisma.educationSession = {
      findMany: vi.fn().mockResolvedValue([{ datetime }]),
    };
    mockPrisma.term.findFirst.mockResolvedValue(null);

    await recomputeOfferingDates("off-1");

    expect(mockPrisma.educationOffering.update).toHaveBeenCalledWith({
      where: { id: "off-1" },
      data: { startsAt: datetime, endsAt: datetime, termId: null },
    });
  });

  it("uses same date for both start and end when there is only one session", async () => {
    const datetime = new Date("2026-10-05T10:00:00Z");
    mockPrisma.educationSession = {
      findMany: vi.fn().mockResolvedValue([{ datetime }]),
    };
    mockPrisma.term.findFirst.mockResolvedValue({ id: "term-26f" });

    await recomputeOfferingDates("off-1");

    const call = mockPrisma.educationOffering.update.mock.calls[0][0];
    expect(call.data.startsAt).toBe(datetime);
    expect(call.data.endsAt).toBe(datetime);
  });
});
