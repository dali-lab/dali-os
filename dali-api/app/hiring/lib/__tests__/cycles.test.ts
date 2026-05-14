import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { autoCloseIfExpired, getActiveCycle } from "~/hiring/lib/cycles";

const mockPrisma = prisma as unknown as {
  applicationCycle: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  applicationCycleStatusUpdate: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

const CYCLE_ID = "cycle-1";

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).applicationCycle = { findUnique: vi.fn() };
  (mockPrisma as any).applicationCycleStatusUpdate = {
    findFirst: vi.fn(),
    create: vi.fn().mockResolvedValue({}),
  };
  // Default: $transaction runs the callback with the same prisma client.
  (mockPrisma as any).$transaction = vi.fn().mockImplementation(
    (cb: (tx: typeof prisma) => unknown) => cb(prisma),
  );
});

function makeActiveUpdate(opts: {
  cycleId?: string;
  newStatus: "Open" | "UnderReview";
  latestStatus?: "Open" | "UnderReview" | "Completed" | "Draft";
  closeDate?: Date | null;
  name?: string;
}) {
  const cycleId = opts.cycleId ?? CYCLE_ID;
  return {
    id: "upd-1",
    createdAt: new Date(),
    newStatus: opts.newStatus,
    applicationCycleId: cycleId,
    userId: null,
    applicationCycle: {
      id: cycleId,
      name: opts.name ?? "Test Cycle",
      closeDate: opts.closeDate ?? null,
      statusUpdates: [
        { newStatus: opts.latestStatus ?? opts.newStatus },
      ],
    },
  };
}

describe("getActiveCycle()", () => {
  it("returns null when no cycle has ever been Open or UnderReview", async () => {
    mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue(null);

    const result = await getActiveCycle();

    expect(result).toBeNull();
    expect(mockPrisma.applicationCycleStatusUpdate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          newStatus: { in: ["Open", "UnderReview"] },
          applicationCycle: { cycleType: "Standard" },
        },
        orderBy: { createdAt: "desc" },
      }),
    );
  });

  it("returns the cycle with currentStatus=Open when it is Open and not past closeDate", async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue(
      makeActiveUpdate({ newStatus: "Open", closeDate: future }),
    );

    const result = await getActiveCycle();

    expect(result).not.toBeNull();
    expect(result!.id).toBe(CYCLE_ID);
    expect(result!.currentStatus).toBe("Open");
    expect(mockPrisma.applicationCycleStatusUpdate.create).not.toHaveBeenCalled();
  });

  it("returns currentStatus=UnderReview when an Open cycle is past its closeDate, without writing", async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue(
      makeActiveUpdate({ newStatus: "Open", closeDate: past }),
    );

    const result = await getActiveCycle();

    expect(result).not.toBeNull();
    expect(result!.currentStatus).toBe("UnderReview");
    expect(mockPrisma.applicationCycleStatusUpdate.create).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns currentStatus=UnderReview directly for a cycle in UnderReview", async () => {
    mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue(
      makeActiveUpdate({ newStatus: "UnderReview", latestStatus: "UnderReview" }),
    );

    const result = await getActiveCycle();

    expect(result).not.toBeNull();
    expect(result!.currentStatus).toBe("UnderReview");
  });

  it("returns null when the cycle's most recent active update was superseded by a Completed update", async () => {
    // findFirst on active updates returns the old Open/UnderReview row, but
    // the cycle's actual latest status is now Completed.
    mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue(
      makeActiveUpdate({ newStatus: "UnderReview", latestStatus: "Completed" }),
    );

    const result = await getActiveCycle();

    expect(result).toBeNull();
  });
});

describe("autoCloseIfExpired()", () => {
  it("inserts an UnderReview status update when an Open cycle is past its closeDate", async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({
      id: CYCLE_ID,
      closeDate: past,
      statusUpdates: [{ newStatus: "Open" }],
    });
    mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue(null);

    await autoCloseIfExpired(CYCLE_ID);

    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
    expect(mockPrisma.applicationCycleStatusUpdate.create).toHaveBeenCalledWith({
      data: {
        applicationCycleId: CYCLE_ID,
        newStatus: "UnderReview",
        userId: null,
      },
    });
  });

  it("is idempotent: a second call with an existing UnderReview row does not insert again", async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({
      id: CYCLE_ID,
      closeDate: past,
      statusUpdates: [{ newStatus: "Open" }],
    });
    mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({
      id: "existing",
    });

    await autoCloseIfExpired(CYCLE_ID);

    expect(mockPrisma.applicationCycleStatusUpdate.create).not.toHaveBeenCalled();
  });

  it("does nothing when the cycle is not currently Open", async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({
      id: CYCLE_ID,
      closeDate: past,
      statusUpdates: [{ newStatus: "Draft" }],
    });

    await autoCloseIfExpired(CYCLE_ID);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.applicationCycleStatusUpdate.create).not.toHaveBeenCalled();
  });

  it("does nothing when closeDate is unset", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({
      id: CYCLE_ID,
      closeDate: null,
      statusUpdates: [{ newStatus: "Open" }],
    });

    await autoCloseIfExpired(CYCLE_ID);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("does nothing when closeDate is still in the future", async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({
      id: CYCLE_ID,
      closeDate: future,
      statusUpdates: [{ newStatus: "Open" }],
    });

    await autoCloseIfExpired(CYCLE_ID);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("does nothing when the cycle does not exist", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue(null);

    await autoCloseIfExpired(CYCLE_ID);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
