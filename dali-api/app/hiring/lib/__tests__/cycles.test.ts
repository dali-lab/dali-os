import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  autoCloseIfExpired,
  getActiveCycleById,
  getActiveCycles,
  getOpenCycles,
} from "~/hiring/lib/cycles";

const mockPrisma = prisma as unknown as {
  applicationCycle: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
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
  (mockPrisma as any).applicationCycle = { findUnique: vi.fn(), findMany: vi.fn() };
  (mockPrisma as any).applicationCycleStatusUpdate = {
    findFirst: vi.fn(),
    create: vi.fn().mockResolvedValue({}),
  };
  // Default: $transaction runs the callback with the same prisma client.
  (mockPrisma as any).$transaction = vi.fn().mockImplementation(
    (cb: (tx: typeof prisma) => unknown) => cb(prisma),
  );
});

function cycleRow(opts: {
  id?: string;
  latestStatus: "Open" | "UnderReview" | "Completed" | "Draft";
  closeDate?: Date | null;
  applicants?: "Students" | "Interns" | "LabMembers";
  domainCloses?: (Date | null)[];
}) {
  return {
    id: opts.id ?? CYCLE_ID,
    name: "Fall 2026",
    applicants: opts.applicants ?? "Students",
    closeDate: opts.closeDate ?? null,
    domains: (opts.domainCloses ?? []).map((closeDate) => ({ closeDate })),
    statusUpdates: [{ newStatus: opts.latestStatus }],
  };
}

const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);

describe("getActiveCycles()", () => {
  it("returns [] when no cycle has ever been Open or UnderReview", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([]);
    expect(await getActiveCycles()).toEqual([]);
  });

  it("returns every active cycle, not just one", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      cycleRow({ id: "a", latestStatus: "Open" }),
      cycleRow({ id: "b", latestStatus: "UnderReview" }),
    ]);
    const res = await getActiveCycles();
    expect(res.map((c) => [c.id, c.currentStatus])).toEqual([
      ["a", "Open"],
      ["b", "UnderReview"],
    ]);
  });

  it("derives UnderReview for an Open cycle past its closeDate, without writing", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      cycleRow({ latestStatus: "Open", closeDate: new Date(Date.now() - 1000) }),
    ]);
    const res = await getActiveCycles();
    expect(res[0].currentStatus).toBe("UnderReview");
    expect(mockPrisma.applicationCycleStatusUpdate.create).not.toHaveBeenCalled();
  });

  it("keeps an Open cycle Open past its own closeDate while a ready domain's later close hasn't passed", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      cycleRow({ latestStatus: "Open", closeDate: PAST, domainCloses: [null, FUTURE] }),
    ]);
    expect((await getActiveCycles())[0].currentStatus).toBe("Open");
  });

  it("derives UnderReview once every ready domain's close has passed", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      cycleRow({ latestStatus: "Open", closeDate: PAST, domainCloses: [null, new Date(Date.now() - 1000)] }),
    ]);
    expect((await getActiveCycles())[0].currentStatus).toBe("UnderReview");
  });

  it("reads only ready domains' close dates", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([]);
    await getActiveCycles();
    expect(mockPrisma.applicationCycle.findMany.mock.calls[0][0].include.domains).toEqual({
      where: { isReady: true },
      select: { closeDate: true },
    });
  });

  it("drops a cycle whose latest status moved past active (Completed)", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      cycleRow({ latestStatus: "Completed" }),
    ]);
    expect(await getActiveCycles()).toEqual([]);
  });

  it("filters by applicant group when asked", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([]);
    await getActiveCycles({ applicants: "Interns" });
    expect(mockPrisma.applicationCycle.findMany.mock.calls[0][0].where.applicants).toBe("Interns");
  });
});

describe("getOpenCycles()", () => {
  it("keeps only cycles still taking applications", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      cycleRow({ id: "open", latestStatus: "Open" }),
      cycleRow({ id: "closed-by-date", latestStatus: "Open", closeDate: new Date(Date.now() - 1000) }),
      cycleRow({ id: "review", latestStatus: "UnderReview" }),
    ]);
    expect((await getOpenCycles()).map((c) => c.id)).toEqual(["open"]);
  });

  it("keeps a cycle whose only open domain closes after the cycle's own close", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      cycleRow({ id: "engs-open", latestStatus: "Open", closeDate: PAST, domainCloses: [null, null, FUTURE] }),
    ]);
    expect((await getOpenCycles()).map((c) => c.id)).toEqual(["engs-open"]);
  });
});

describe("getActiveCycleById()", () => {
  it("returns the cycle with its derived status when active", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue(cycleRow({ latestStatus: "Open" }));
    expect((await getActiveCycleById(CYCLE_ID))?.currentStatus).toBe("Open");
  });

  it("stays Open past the cycle's closeDate while a domain is still open", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue(
      cycleRow({ latestStatus: "Open", closeDate: PAST, domainCloses: [null, FUTURE] }),
    );
    expect((await getActiveCycleById(CYCLE_ID))?.currentStatus).toBe("Open");
  });

  it("returns null for a Draft or missing cycle", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValueOnce(cycleRow({ latestStatus: "Draft" }));
    expect(await getActiveCycleById(CYCLE_ID)).toBeNull();
    mockPrisma.applicationCycle.findUnique.mockResolvedValueOnce(null);
    expect(await getActiveCycleById(CYCLE_ID)).toBeNull();
  });
});

describe("autoCloseIfExpired()", () => {
  it("inserts an UnderReview status update when an Open cycle is past its closeDate", async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({
      id: CYCLE_ID,
      closeDate: past,
      domains: [],
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
      domains: [],
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
      domains: [],
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
      domains: [],
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
      domains: [],
      statusUpdates: [{ newStatus: "Open" }],
    });

    await autoCloseIfExpired(CYCLE_ID);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("does nothing past the cycle's closeDate while a ready domain is still open", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue(
      cycleRow({ latestStatus: "Open", closeDate: PAST, domainCloses: [null, FUTURE] }),
    );

    await autoCloseIfExpired(CYCLE_ID);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.applicationCycleStatusUpdate.create).not.toHaveBeenCalled();
  });

  it("closes once the last ready domain's close has passed", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue(
      cycleRow({ latestStatus: "Open", closeDate: PAST, domainCloses: [null, new Date(Date.now() - 1000)] }),
    );
    mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue(null);

    await autoCloseIfExpired(CYCLE_ID);

    expect(mockPrisma.applicationCycleStatusUpdate.create).toHaveBeenCalledOnce();
  });

  it("does nothing when the cycle does not exist", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue(null);

    await autoCloseIfExpired(CYCLE_ID);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
