import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  syncCreditForAttendance,
  termForDate,
  revokeManualCredit,
  grantManualCredit,
} from "~/education/lib/ce-credits.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

// The lib takes a TransactionClient; the mock client doubles as one.
const tx = prisma as never;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("syncCreditForAttendance", () => {
  it("grants an idempotent credit on Present", async () => {
    mockPrisma.term.findFirst.mockResolvedValue({ id: "term-26X" });

    await syncCreditForAttendance(tx, {
      userId: "user-1",
      sessionId: "sess-1",
      status: "Present",
      sessionDate: new Date("2026-07-01"),
    });

    expect(mockPrisma.cECredit.upsert).toHaveBeenCalledWith({
      where: { userId_sessionId: { userId: "user-1", sessionId: "sess-1" } },
      create: { userId: "user-1", termId: "term-26X", sessionId: "sess-1" },
      update: {},
    });
  });

  it("revokes the derived row when the mark moves off Present", async () => {
    await syncCreditForAttendance(tx, {
      userId: "user-1",
      sessionId: "sess-1",
      status: "Excused",
      sessionDate: new Date("2026-07-01"),
    });

    expect(mockPrisma.cECredit.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", sessionId: "sess-1" },
    });
    expect(mockPrisma.cECredit.upsert).not.toHaveBeenCalled();
  });

  it("no-ops the grant when no term exists", async () => {
    mockPrisma.term.findFirst.mockResolvedValue(null);

    await syncCreditForAttendance(tx, {
      userId: "user-1",
      sessionId: "sess-1",
      status: "Present",
      sessionDate: new Date("2026-07-01"),
    });

    expect(mockPrisma.cECredit.upsert).not.toHaveBeenCalled();
  });
});

describe("termForDate", () => {
  it("rolls forward to the next term for inter-term-gap dates", async () => {
    // No containing term, then an upcoming one.
    mockPrisma.term.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "term-26F" });

    const term = await termForDate(tx, new Date("2026-08-30"));

    expect(term).toEqual({ id: "term-26F" });
    const secondCall = mockPrisma.term.findFirst.mock.calls[1][0];
    expect(secondCall.where.startDate.gt).toBeInstanceOf(Date);
    expect(secondCall.orderBy).toEqual({ sortKey: "asc" });
  });
});

describe("manual grants", () => {
  it("requires a reason", async () => {
    const res = await grantManualCredit({
      userId: "user-1",
      termId: "term-1",
      reason: "  ",
      actorId: "core-1",
    });
    expect(res).toMatchObject({ status: 400 });
  });

  it("refuses to revoke attendance-derived rows", async () => {
    mockPrisma.cECredit.findUnique.mockResolvedValue({
      id: "credit-1",
      sessionId: "sess-1",
      userId: "user-1",
    });

    const res = await revokeManualCredit({ creditId: "credit-1", actorId: "core-1" });

    expect(res).toMatchObject({ status: 400 });
    expect(mockPrisma.cECredit.delete).not.toHaveBeenCalled();
  });

  it("revokes manual rows", async () => {
    mockPrisma.cECredit.findUnique.mockResolvedValue({
      id: "credit-1",
      sessionId: null,
      userId: "user-1",
    });

    const res = await revokeManualCredit({ creditId: "credit-1", actorId: "core-1" });

    expect(res).toEqual({ ok: true });
    expect(mockPrisma.cECredit.delete).toHaveBeenCalledWith({
      where: { id: "credit-1" },
    });
  });
});
