import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/education/lib/access.server", () => ({
  isOfferingManager: vi.fn(),
}));
vi.mock("~/education/lib/application-form.server", () => ({
  createOfferingApplicationForm: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { isOfferingManager } from "~/education/lib/access.server";
import { runOfferingAction } from "~/education/lib/offerings.server";

const mockIsManager = isOfferingManager as unknown as ReturnType<typeof vi.fn>;

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
> & { $transaction: ReturnType<typeof vi.fn> };

const FUTURE_A = new Date(Date.now() + 7 * 86_400_000);
const FUTURE_A_END = new Date(FUTURE_A.getTime() + 3_600_000);
const FUTURE_B = new Date(Date.now() + 14 * 86_400_000);
const FUTURE_B_END = new Date(FUTURE_B.getTime() + 3_600_000);

function reorderForm(sessionIds: string[]) {
  const fd = new FormData();
  fd.set("intent", "reorder-sessions");
  fd.set("offeringId", "off-1");
  for (const id of sessionIds) fd.append("sessionIds", id);
  return fd;
}

function sessionRow(
  id: string,
  datetime: Date,
  endsAt: Date | null,
  attendances = 0,
) {
  return { id, datetime, endsAt, _count: { attendances } };
}

describe("runOfferingAction reorder-sessions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockIsManager.mockResolvedValue(true);
    mockPrisma.educationOffering = {
      findUnique: vi.fn().mockResolvedValue({ id: "off-1", sessions: [] }),
      update: vi.fn().mockResolvedValue({}),
    };
    mockPrisma.term = { findFirst: vi.fn().mockResolvedValue(null) };
    mockPrisma.$transaction = vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops));
  });

  it("permutes datetime slots (not sequence) across the submitted order", async () => {
    mockPrisma.educationSession = {
      // First findMany: the reorder validation read; later ones belong to
      // recomputeOfferingDates and only need a well-formed shape.
      findMany: vi
        .fn()
        .mockResolvedValueOnce([
          sessionRow("s-late", FUTURE_B, FUTURE_B_END),
          sessionRow("s-early", FUTURE_A, FUTURE_A_END),
        ])
        .mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
    };

    // Submitted order: the currently-later session first → it takes the
    // earlier slot, the other one takes the later slot.
    const result = await runOfferingAction(reorderForm(["s-late", "s-early"]), "user-1");

    expect(result).toEqual({ ok: true });
    expect(mockPrisma.educationSession.update).toHaveBeenCalledWith({
      where: { id: "s-late" },
      data: { datetime: FUTURE_A, endsAt: FUTURE_A_END },
    });
    expect(mockPrisma.educationSession.update).toHaveBeenCalledWith({
      where: { id: "s-early" },
      data: { datetime: FUTURE_B, endsAt: FUTURE_B_END },
    });
  });

  it("rejects reorders touching past sessions", async () => {
    const past = new Date(Date.now() - 86_400_000);
    mockPrisma.educationSession = {
      findMany: vi
        .fn()
        .mockResolvedValueOnce([
          sessionRow("s-past", past, null),
          sessionRow("s-future", FUTURE_A, null),
        ])
        .mockResolvedValue([]),
      update: vi.fn(),
      findFirst: vi.fn(),
    };

    const result = await runOfferingAction(reorderForm(["s-future", "s-past"]), "user-1");

    expect(result).toMatchObject({ error: expect.stringContaining("future") });
    expect(mockPrisma.educationSession.update).not.toHaveBeenCalled();
  });

  it("rejects reorders touching sessions with attendance", async () => {
    mockPrisma.educationSession = {
      findMany: vi
        .fn()
        .mockResolvedValueOnce([
          sessionRow("s-a", FUTURE_A, null, 3),
          sessionRow("s-b", FUTURE_B, null),
        ])
        .mockResolvedValue([]),
      update: vi.fn(),
      findFirst: vi.fn(),
    };

    const result = await runOfferingAction(reorderForm(["s-b", "s-a"]), "user-1");

    expect(result).toMatchObject({ error: expect.stringContaining("attendance") });
    expect(mockPrisma.educationSession.update).not.toHaveBeenCalled();
  });

  it("rejects ids that don't belong to the offering", async () => {
    mockPrisma.educationSession = {
      // The where clause scopes to offeringId, so a foreign id just comes back
      // missing from the result set.
      findMany: vi.fn().mockResolvedValueOnce([sessionRow("s-a", FUTURE_A, null)]),
      update: vi.fn(),
      findFirst: vi.fn(),
    };

    const result = await runOfferingAction(reorderForm(["s-a", "s-foreign"]), "user-1");

    expect(result).toMatchObject({ error: "Session not found", status: 404 });
  });
});
