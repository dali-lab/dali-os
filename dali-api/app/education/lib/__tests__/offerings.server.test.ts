import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));

import { prisma } from "~/lib/db";
import { recomputeOfferingDates } from "~/education/lib/offerings.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
> & { $transaction: ReturnType<typeof vi.fn> };

// A session row as the function selects it (id/sequence/datetime/endsAt).
function session(
  id: string,
  sequence: number,
  datetime: Date,
  endsAt: Date | null = null,
) {
  return { id, sequence, datetime, endsAt };
}

describe("recomputeOfferingDates", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockPrisma.term = { findFirst: vi.fn().mockResolvedValue(null) };
    mockPrisma.educationOffering = { update: vi.fn().mockResolvedValue({}) };
    // Renumbering runs its per-row updates through $transaction(array).
    mockPrisma.$transaction = vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops));
  });

  it("sets all three to null when the offering has no sessions", async () => {
    mockPrisma.educationSession = {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
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
        session("s1", 1, first),
        session("s2", 2, second),
        session("s3", 3, third),
      ]),
      update: vi.fn().mockResolvedValue({}),
    };
    const termId = "term-26f";
    mockPrisma.term.findFirst.mockResolvedValue({ id: termId });

    await recomputeOfferingDates("off-1");

    expect(mockPrisma.educationOffering.update).toHaveBeenCalledWith({
      where: { id: "off-1" },
      data: { startsAt: first, endsAt: third, termId },
    });
    // Sequences already match chronological order, so nothing is renumbered.
    expect(mockPrisma.educationSession.update).not.toHaveBeenCalled();
  });

  it("uses the last session's endsAt for the offering end when it is set", async () => {
    const start = new Date("2026-09-01T14:00:00Z");
    const end = new Date("2026-09-01T15:30:00Z");
    mockPrisma.educationSession = {
      findMany: vi.fn().mockResolvedValue([session("s1", 1, start, end)]),
      update: vi.fn().mockResolvedValue({}),
    };
    mockPrisma.term.findFirst.mockResolvedValue({ id: "term-26f" });

    await recomputeOfferingDates("off-1");

    const call = mockPrisma.educationOffering.update.mock.calls[0][0];
    expect(call.data.startsAt).toBe(start);
    expect(call.data.endsAt).toBe(end);
  });

  it("renumbers sessions so sequence follows chronological order", async () => {
    // Ordered by datetime asc (as the query returns them) but with sequences
    // that drifted out of order — the Mon/Mon/Tue/Tue mislabeling case.
    const d1 = new Date("2026-09-07T14:00:00Z");
    const d2 = new Date("2026-09-09T14:00:00Z");
    const d3 = new Date("2026-09-14T14:00:00Z");
    mockPrisma.educationSession = {
      findMany: vi.fn().mockResolvedValue([
        session("mon1", 1, d1),
        session("wed1", 3, d2),
        session("mon2", 2, d3),
      ]),
      update: vi.fn().mockResolvedValue({}),
    };

    await recomputeOfferingDates("off-1");

    // Only the two drifted rows are rewritten (position 2 → seq 2, position 3 → seq 3).
    expect(mockPrisma.educationSession.update).toHaveBeenCalledWith({
      where: { id: "wed1" },
      data: { sequence: 2 },
    });
    expect(mockPrisma.educationSession.update).toHaveBeenCalledWith({
      where: { id: "mon2" },
      data: { sequence: 3 },
    });
    expect(mockPrisma.educationSession.update).toHaveBeenCalledTimes(2);
  });

  it("sets termId null when no term window matches", async () => {
    const datetime = new Date("2030-01-01T14:00:00Z");
    mockPrisma.educationSession = {
      findMany: vi.fn().mockResolvedValue([session("s1", 1, datetime)]),
      update: vi.fn().mockResolvedValue({}),
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
      findMany: vi.fn().mockResolvedValue([session("s1", 1, datetime)]),
      update: vi.fn().mockResolvedValue({}),
    };
    mockPrisma.term.findFirst.mockResolvedValue({ id: "term-26f" });

    await recomputeOfferingDates("off-1");

    const call = mockPrisma.educationOffering.update.mock.calls[0][0];
    expect(call.data.startsAt).toBe(datetime);
    expect(call.data.endsAt).toBe(datetime);
  });
});
