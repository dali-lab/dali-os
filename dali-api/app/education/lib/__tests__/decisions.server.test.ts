import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/education/lib/notifications.server", () => ({
  notifyApplicationStatus: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { decideApplication, withdrawApplication } from "~/education/lib/decisions.server";
import { notifyApplicationStatus } from "~/education/lib/notifications.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
> & {
  $transaction: ReturnType<typeof vi.fn>;
  $queryRaw: ReturnType<typeof vi.fn>;
};

function appRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "app-1",
    status: "Submitted",
    waitlistRank: null,
    offeringId: "off-1",
    offering: { capacity: 2 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockPrisma.$transaction.mockImplementation(async (fn: unknown) =>
    typeof fn === "function"
      ? (fn as (tx: unknown) => Promise<unknown>)(mockPrisma)
      : Promise.all(fn as Promise<unknown>[]),
  );
  mockPrisma.$queryRaw.mockResolvedValue([]);
  mockPrisma.educationApplication.count.mockResolvedValue(0);
  mockPrisma.educationApplication.findFirst.mockResolvedValue(null);
  mockPrisma.educationApplication.update.mockResolvedValue({});
  mockPrisma.educationApplication.updateMany.mockResolvedValue({ count: 0 });
});

describe("decideApplication", () => {
  it("approves within capacity and stamps the reviewer", async () => {
    mockPrisma.educationApplication.findUnique.mockResolvedValue(appRow());
    mockPrisma.educationApplication.count.mockResolvedValue(1);

    const res = await decideApplication({
      applicationId: "app-1",
      offeringId: "off-1",
      status: "Approved",
      actorId: "core-1",
    });

    expect(res).toMatchObject({ ok: true, status: "Approved" });
    expect(mockPrisma.educationApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "app-1" },
        data: expect.objectContaining({
          status: "Approved",
          reviewedBy: "core-1",
        }),
      }),
    );
    expect(notifyApplicationStatus).toHaveBeenCalledWith("app-1");
  });

  it("hard-blocks approval at capacity", async () => {
    mockPrisma.educationApplication.findUnique.mockResolvedValue(appRow());
    mockPrisma.educationApplication.count.mockResolvedValue(2); // full (cap 2)

    const res = await decideApplication({
      applicationId: "app-1",
      offeringId: "off-1",
      status: "Approved",
      actorId: "core-1",
    });

    expect(res).toMatchObject({ status: 400 });
    expect(mockPrisma.educationApplication.update).not.toHaveBeenCalled();
    expect(notifyApplicationStatus).not.toHaveBeenCalled();
  });

  it("assigns the next FIFO rank when waitlisting", async () => {
    mockPrisma.educationApplication.findUnique.mockResolvedValue(appRow());
    mockPrisma.educationApplication.findFirst.mockResolvedValue({ waitlistRank: 3 });

    const res = await decideApplication({
      applicationId: "app-1",
      offeringId: "off-1",
      status: "Waitlisted",
      actorId: "core-1",
    });

    expect(res).toMatchObject({ ok: true, status: "Waitlisted" });
    expect(mockPrisma.educationApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "Waitlisted", waitlistRank: 4 }),
      }),
    );
  });

  it("promotes the front of the waitlist when an approved seat frees up", async () => {
    mockPrisma.educationApplication.findUnique.mockResolvedValue(
      appRow({ status: "Approved" }),
    );
    // Inside promoteFromWaitlist: seat count post-withdrawal, then the queue head.
    mockPrisma.educationApplication.count.mockResolvedValue(1);
    mockPrisma.educationApplication.findFirst.mockResolvedValue({
      id: "app-2",
      waitlistRank: 1,
    });

    const res = await decideApplication({
      applicationId: "app-1",
      offeringId: "off-1",
      status: "Withdrawn",
      actorId: "user-1",
    });

    expect(res).toMatchObject({ ok: true, promotedApplicationId: "app-2" });
    expect(mockPrisma.educationApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "app-2" },
        data: { status: "Approved", waitlistRank: null },
      }),
    );
    expect(notifyApplicationStatus).toHaveBeenCalledWith("app-2", { promoted: true });
  });

  it("compacts ranks behind a departing waitlister", async () => {
    mockPrisma.educationApplication.findUnique.mockResolvedValue(
      appRow({ status: "Waitlisted", waitlistRank: 2 }),
    );

    await decideApplication({
      applicationId: "app-1",
      offeringId: "off-1",
      status: "Rejected",
      actorId: "core-1",
    });

    expect(mockPrisma.educationApplication.updateMany).toHaveBeenCalledWith({
      where: {
        offeringId: "off-1",
        status: "Waitlisted",
        waitlistRank: { gt: 2 },
      },
      data: { waitlistRank: { decrement: 1 } },
    });
  });

  it("refuses to act on an application from another offering", async () => {
    mockPrisma.educationApplication.findUnique.mockResolvedValue(appRow());

    const res = await decideApplication({
      applicationId: "app-1",
      offeringId: "other-offering",
      status: "Approved",
      actorId: "core-1",
    });

    expect(res).toMatchObject({ status: 404 });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(notifyApplicationStatus).not.toHaveBeenCalled();
  });

  it("no-ops when the status is unchanged", async () => {
    mockPrisma.educationApplication.findUnique.mockResolvedValue(
      appRow({ status: "Approved" }),
    );

    const res = await decideApplication({
      applicationId: "app-1",
      offeringId: "off-1",
      status: "Approved",
      actorId: "core-1",
    });

    expect(res).toMatchObject({ ok: true });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("withdrawApplication", () => {
  it("refuses to withdraw an already-closed application", async () => {
    mockPrisma.educationApplication.findUnique.mockResolvedValue({
      id: "app-1",
      status: "Rejected",
    });

    const res = await withdrawApplication({ userId: "user-1", offeringId: "off-1" });

    expect(res).toMatchObject({ status: 400 });
  });
});
